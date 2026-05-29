require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
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
const mongodbUri = process.env.MONGODB_URI || '';
const mongodbDb = process.env.MONGODB_DB || 'eqlog';
const STATUS_MESSAGE_TITLE = 'Safe Bot Parking Update';

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
let mongoClient;
let mongoConnected = false;
let statusMessagesCollection;
let guildSettingsCollection;

async function getMongoDb() {
  if (!mongodbUri) return null;
  if (!mongoClient) mongoClient = new MongoClient(mongodbUri);
  if (!mongoConnected) {
    await mongoClient.connect();
    mongoConnected = true;
  }
  return mongoClient.db(mongodbDb);
}

async function getStatusMessagesCollection() {
  if (statusMessagesCollection) return statusMessagesCollection;

  const db = await getMongoDb();
  if (!db) return null;

  statusMessagesCollection = db.collection('discord_status_messages');
  return statusMessagesCollection;
}

async function getGuildSettingsCollection() {
  if (guildSettingsCollection) return guildSettingsCollection;

  const db = await getMongoDb();
  if (!db) return null;

  guildSettingsCollection = db.collection('discord_guild_settings');
  return guildSettingsCollection;
}

async function saveGuildStatusChannel(guild, channel, configuredBy) {
  const collection = await getGuildSettingsCollection();
  if (!collection) {
    throw new Error('MONGODB_URI is required to save Discord setup from slash commands.');
  }

  await collection.updateOne(
    { _id: guild.id },
    {
      $set: {
        guildId: guild.id,
        guildName: guild.name || '',
        statusChannelId: channel.id,
        statusChannelName: channel.name || '',
        configuredBy,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

async function getConfiguredStatusChannelIds() {
  const channelIds = new Set();
  if (statusChannelId) channelIds.add(statusChannelId);

  try {
    const collection = await getGuildSettingsCollection();
    if (collection) {
      const records = await collection.find({ statusChannelId: { $type: 'string' } }).toArray();
      records.forEach((record) => {
        if (/^\d{17,20}$/.test(record.statusChannelId)) channelIds.add(record.statusChannelId);
      });
    }
  } catch (error) {
    console.warn(`Could not load configured Discord status channels: ${error.message}`);
  }

  return Array.from(channelIds);
}

async function readStoredStatusMessageId(channelId) {
  try {
    const collection = await getStatusMessagesCollection();
    if (collection) {
      const record = await collection.findOne({ _id: channelId });
      if (record?.messageId) return String(record.messageId);
    }
  } catch (error) {
    console.warn(`Could not read Discord status message id from MongoDB: ${error.message}`);
  }

  const state = await readStatusMessageState();
  return state[channelId] || '';
}

async function writeStoredStatusMessageId(channelId, messageId) {
  try {
    const collection = await getStatusMessagesCollection();
    if (collection) {
      await collection.updateOne(
        { _id: channelId },
        {
          $set: {
            channelId,
            messageId,
            title: STATUS_MESSAGE_TITLE,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
  } catch (error) {
    console.warn(`Could not save Discord status message id to MongoDB: ${error.message}`);
  }

  const state = await readStatusMessageState();
  await writeStatusMessageState({
    ...state,
    [channelId]: messageId,
  });
}

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

async function findExistingStatusMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 50 });
  return Array.from(messages.values())
    .filter((message) => (
      message.author?.id === client.user.id
      && message.embeds?.some((embed) => embed.title === STATUS_MESSAGE_TITLE)
    ))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] || null;
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

async function sendStatusChannelUpdate(channelId) {
  if (!channelId) return null;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    if (error.code === 50001) {
      throw new Error(`Missing access to Discord status channel ${channelId}. Invite the bot to that server and grant it View Channel, Send Messages, Embed Links, and Read Message History permissions for the channel.`);
    }

    throw error;
  }

  if (!channel || !channel.isTextBased()) {
    throw new Error(`Discord status channel ${channelId} is not a text channel the bot can access.`);
  }

  const records = await fetchSafeBots();
  const payload = { embeds: buildRosterEmbeds(records, STATUS_MESSAGE_TITLE) };
  const savedMessageId = await readStoredStatusMessageId(channelId);

  if (savedMessageId) {
    try {
      const message = await channel.messages.fetch(savedMessageId);
      await message.edit(payload);
      return { action: 'edited', messageId: savedMessageId };
    } catch (error) {
      if (![10008, 50001, 50013].includes(error.code)) throw error;
    }
  }

  const existingMessage = await findExistingStatusMessage(channel);
  if (existingMessage) {
    await existingMessage.edit(payload);
    await writeStoredStatusMessageId(channelId, existingMessage.id);
    return { action: 'edited', messageId: existingMessage.id };
  }

  const message = await channel.send(payload);
  await writeStoredStatusMessageId(channelId, message.id);
  return { action: 'sent', messageId: message.id };
}

async function sendAllStatusChannelUpdates() {
  const channelIds = await getConfiguredStatusChannelIds();
  const results = [];

  for (const channelId of channelIds) {
    try {
      const result = await sendStatusChannelUpdate(channelId);
      if (result) {
        console.log(`${result.action === 'edited' ? 'Refreshed' : 'Posted'} Safe bot status message ${result.messageId} in channel ${channelId}.`);
        results.push({ channelId, ...result });
      }
    } catch (error) {
      console.error(error);
      results.push({ channelId, error });
    }
  }

  return results;
}

client.once('clientReady', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}.`);

  try {
    await sendAllStatusChannelUpdates();
  } catch (error) {
    console.error(error);
  }

  if (autoPostMinutes > 0) {
    setInterval(async () => {
      try {
        await sendAllStatusChannelUpdates();
      } catch (error) {
        console.error(error);
      }
    }, autoPostMinutes * 60 * 1000);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply({ ephemeral: interaction.commandName === 'setup' });

  try {
    if (interaction.commandName === 'setup') {
      if (!interaction.guild) {
        await interaction.editReply('Run this command inside a Discord server.');
        return;
      }

      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.editReply('You need Manage Server permission to configure the roster channel.');
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel || channel.guildId !== interaction.guildId || !channel.isTextBased()) {
        await interaction.editReply('Choose a text channel from this server.');
        return;
      }

      const botMember = await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(botMember);
      const requiredPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
      ];
      const missing = requiredPermissions.filter((permission) => !permissions?.has(permission));
      if (missing.length) {
        await interaction.editReply('I need View Channel, Send Messages, Embed Links, and Read Message History permissions in that channel.');
        return;
      }

      await saveGuildStatusChannel(interaction.guild, channel, interaction.user.id);
      const result = await sendStatusChannelUpdate(channel.id);
      await interaction.editReply(`Safe bot roster updates are configured for ${channel}. ${result?.action === 'edited' ? 'Updated' : 'Posted'} the roster message.`);
      return;
    }

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
