require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
} = require('discord.js');
const {
  inferClass,
  getClassConfig,
  formatClass,
  sortBots,
} = require('./roster-config');

const token = process.env.DISCORD_TOKEN;
const botsUrl = process.env.EQLOG_BOTS_URL || 'http://localhost:3000/api/discord/bots';
const botsToken = process.env.EQLOG_BOTS_TOKEN || process.env.DISCORD_BOT_API_TOKEN;
const rawStatusChannelId = process.env.DISCORD_STATUS_CHANNEL_ID || '';
const autoPostMinutes = Number(process.env.DISCORD_AUTO_POST_MINUTES || 0);
const statusMessageFile = path.join(__dirname, '..', 'data', 'discord-status-message.json');

if (!token) {
  console.error('DISCORD_TOKEN is required to run the Discord bot.');
  process.exit(1);
}

if (!botsToken) {
  console.error('EQLOG_BOTS_TOKEN or DISCORD_BOT_API_TOKEN is required to read Safe bot locations.');
  process.exit(1);
}

function cleanOptionalSnowflake(value, label) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^optional-/i.test(trimmed)) return '';

  if (!/^\d{17,20}$/.test(trimmed)) {
    console.warn(`${label} is set to "${trimmed}", but Discord IDs should be 17-20 digits. Automatic status posts are disabled.`);
    return '';
  }

  return trimmed;
}

const statusChannelId = cleanOptionalSnowflake(rawStatusChannelId, 'DISCORD_STATUS_CHANNEL_ID');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function readStatusMessageState() {
  try {
    return JSON.parse(await fs.readFile(statusMessageFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeStatusMessageState(state) {
  await fs.mkdir(path.dirname(statusMessageFile), { recursive: true });
  await fs.writeFile(statusMessageFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function formatAge(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'unknown';

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'unknown time';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(timestamp));
}

async function fetchSafeBots() {
  let response;
  try {
    response = await fetch(botsUrl, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${botsToken}`,
      },
    });
  } catch (error) {
    throw new Error(`Could not reach EQLog API at ${botsUrl}. Start the web server with npm start or set EQLOG_BOTS_URL to your deployed app URL.`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`EQLog API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return (data.records || []).map((record) => ({
    ...record,
    className: record.className || inferClass(record),
  })).sort(sortBots);
}

async function setSafeBotClass(name, className, server = '') {
  const classUrl = `${botsUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}/class`;
  let response;

  try {
    response = await fetch(classUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${botsToken}`,
      },
      body: JSON.stringify({ className, server }),
    });
  } catch (error) {
    throw new Error(`Could not reach EQLog API at ${classUrl}.`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`EQLog API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  return {
    ...data.record,
    className: data.record?.className || inferClass(data.record || {}),
  };
}

function filterBots(records, className, search) {
  const query = String(search || '').trim().toLowerCase();

  return records.filter((record) => {
    if (className && record.className !== className) return false;
    if (!query) return true;

    return [
      record.character,
      record.server,
      record.zone,
      record.className,
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function compactZone(zone) {
  return String(zone || 'Unknown').replace(/\s+/g, ' ').trim() || 'Unknown';
}

function botDisplayName(record) {
  return record.character || record.name || 'Unknown';
}

function botReadyLabel(record) {
  return record.ready || (record.zone && record.zone !== 'Unknown') ? 'Parked' : 'Unknown';
}

function groupBotsByClass(records) {
  return records.reduce((groups, record) => {
    const className = record.className || inferClass(record);
    if (!groups[className]) groups[className] = [];
    groups[className].push(record);
    return groups;
  }, {});
}

function buildRosterEmbeds(records, title = 'Safe Space Bot Roster') {
  if (!records.length) {
    return [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription('No Safe bots matched that request.')
        .setColor(0xffbf22)
        .setTimestamp(new Date()),
    ];
  }

  const grouped = groupBotsByClass(records);
  const classNames = Object.keys(grouped).sort((a, b) => sortBots({ className: a, character: '' }, { className: b, character: '' }));
  const fields = [];

  classNames.forEach((className) => {
    const config = getClassConfig(className);
    const lines = grouped[className].sort(sortBots).map((record) => (
      `**${botDisplayName(record)}** · ${compactZone(record.zone)} · ${formatAge(record.enteredAt)}`
    ));

    fields.push({
      name: `${config.marker} ${config.label} (${grouped[className].length})`,
      value: lines.join('\n').slice(0, 1024) || 'None',
      inline: false,
    });
  });

  const fieldChunks = [];
  for (let index = 0; index < fields.length; index += 10) {
    fieldChunks.push(fields.slice(index, index + 10));
  }

  return fieldChunks.slice(0, 10).map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setTitle(index === 0 ? title : `${title} (${index + 1})`)
      .setColor(0xffbf22)
      .setDescription('Live parking pulled from EQ log scans. Use /bot for a single character.')
      .setFooter({ text: `${records.length} Safe bot${records.length === 1 ? '' : 's'} shown` })
      .setTimestamp(new Date());

    embed.addFields(chunk);

    return embed;
  });
}

function buildBotDetailEmbed(record) {
  const className = record.className || inferClass(record);
  const config = getClassConfig(className);

  return new EmbedBuilder()
    .setTitle(`${botDisplayName(record)} · ${config.label}`)
    .setColor(config.color)
    .addFields(
      { name: 'Class Source', value: record.classSource === 'manual' ? 'Manual' : 'Inferred', inline: true },
      { name: 'Zone', value: compactZone(record.zone), inline: true },
      { name: 'Server', value: record.server || 'Unknown', inline: true },
      { name: 'Status', value: botReadyLabel(record), inline: true },
      { name: 'Parked', value: `${formatAge(record.enteredAt)} (${formatTimestamp(record.enteredAt)})`, inline: false },
      { name: 'Source', value: record.sourceFile || 'Unknown log file', inline: false },
    )
    .setTimestamp(new Date());
}

function buildQuakeEmbeds(records) {
  const priorityRecords = records.filter((record) => getClassConfig(record.className || inferClass(record)).priority);
  const otherRecords = records.filter((record) => !getClassConfig(record.className || inferClass(record)).priority);
  const ready = records.filter((record) => record.zone && record.zone !== 'Unknown');

  const embed = new EmbedBuilder()
    .setTitle('Safe Space Mobilization')
    .setColor(0xff3333)
    .setDescription('Priority parking snapshot for fast movement.')
    .addFields(
      {
        name: `Priority Classes (${priorityRecords.length})`,
        value: priorityRecords.length
          ? priorityRecords.map((record) => `**${botDisplayName(record)}** · ${formatClass(record.className)} · ${compactZone(record.zone)}`).join('\n').slice(0, 1024)
          : 'None',
        inline: false,
      },
      {
        name: `Other Parked Bots (${otherRecords.length})`,
        value: otherRecords.length
          ? otherRecords.map((record) => `**${botDisplayName(record)}** · ${formatClass(record.className)} · ${compactZone(record.zone)}`).join('\n').slice(0, 1024)
          : 'None',
        inline: false,
      },
    )
    .setFooter({ text: `${ready.length}/${records.length} bots have known parking zones` })
    .setTimestamp(new Date());

  return [embed];
}

async function sendStatusChannelUpdate() {
  if (!statusChannelId) return;

  let channel;
  try {
    channel = await client.channels.fetch(statusChannelId);
  } catch (error) {
    if (error.code === 50001) {
      throw new Error(`Missing access to DISCORD_STATUS_CHANNEL_ID ${statusChannelId}. Invite the bot to that server and grant it View Channel, Send Messages, and Embed Links permissions for the channel.`);
    }

    throw error;
  }

  if (!channel || !channel.isTextBased()) {
    throw new Error(`DISCORD_STATUS_CHANNEL_ID ${statusChannelId} is not a text channel the bot can access.`);
  }

  const records = await fetchSafeBots();
  const payload = { embeds: buildRosterEmbeds(records, 'Safe Bot Parking Update') };
  const state = await readStatusMessageState();
  const savedMessageId = state[statusChannelId];

  if (savedMessageId) {
    try {
      const message = await channel.messages.fetch(savedMessageId);
      await message.edit(payload);
      return { action: 'edited', messageId: savedMessageId };
    } catch (error) {
      if (![10008, 50001, 50013].includes(error.code)) throw error;
    }
  }

  const message = await channel.send(payload);
  await writeStatusMessageState({
    ...state,
    [statusChannelId]: message.id,
  });
  return { action: 'sent', messageId: message.id };
}

client.once('clientReady', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}.`);

  if (statusChannelId) {
    try {
      const result = await sendStatusChannelUpdate();
      console.log(`${result.action === 'edited' ? 'Refreshed' : 'Posted'} Safe bot status message ${result.messageId} in channel ${statusChannelId}.`);
    } catch (error) {
      console.error(error);
    }
  }

  if (statusChannelId && autoPostMinutes > 0) {
    setInterval(async () => {
      try {
        await sendStatusChannelUpdate();
      } catch (error) {
        console.error(error);
      }
    }, autoPostMinutes * 60 * 1000);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  try {
    if (['safebots', 'roster', 'bots'].includes(interaction.commandName)) {
      const className = interaction.options.getString('class');
      const search = interaction.options.getString('search');
      const records = filterBots(await fetchSafeBots(), className, search);
      const title = className ? `Safe Space · ${formatClass(className)} Parking` : 'Safe Space Bot Roster';

      await interaction.editReply({ embeds: buildRosterEmbeds(records, title) });
      return;
    }

    if (interaction.commandName === 'bot') {
      const name = interaction.options.getString('name');
      const query = String(name || '').toLowerCase();
      const record = (await fetchSafeBots()).find((candidate) => (
        botDisplayName(candidate).toLowerCase() === query
        || botDisplayName(candidate).toLowerCase().includes(query)
      ));

      if (!record) {
        await interaction.editReply(`No Safe bot matched "${name}".`);
        return;
      }

      await interaction.editReply({ embeds: [buildBotDetailEmbed(record)] });
      return;
    }

    if (interaction.commandName === 'quake') {
      await interaction.editReply({ embeds: buildQuakeEmbeds(await fetchSafeBots()) });
      return;
    }

    if (interaction.commandName === 'setclass') {
      const name = interaction.options.getString('name');
      const className = interaction.options.getString('class');
      const server = interaction.options.getString('server') || '';
      const record = await setSafeBotClass(name, className, server);
      const classLabel = record.classSource === 'manual'
        ? formatClass(record.className)
        : `${formatClass(record.className)} (inferred)`;

      await interaction.editReply({
        content: `Updated **${botDisplayName(record)}** class to **${classLabel}**.`,
        embeds: [buildBotDetailEmbed(record)],
      });
      return;
    }
  } catch (error) {
    await interaction.editReply(`Could not load Safe bot parking: ${error.message}`);
  }
});

client.login(token);
