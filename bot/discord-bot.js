require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
} = require('discord.js');

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

function inferClass(record) {
  const name = String(record.character || '').toLowerCase();
  const zone = String(record.zone || '').toLowerCase();

  if (/heal|cleric|clr|rez/.test(name)) return 'cleric';
  if (/wiz|port|evac/.test(name)) return 'wizard';
  if (/war|tank/.test(name)) return 'warrior';
  if (/mage|mag|mod/.test(name)) return 'magician';
  if (/dru|track|snare/.test(name)) return 'druid';
  if (/sham|slow|shm/.test(name)) return 'shaman';
  if (/ranger|rng/.test(name)) return 'ranger';
  if (/paladin|pal/.test(name)) return 'paladin';
  if (/sk|shadow/.test(name)) return 'shadow-knight';
  if (/necro|nec/.test(name) || zone.includes('paineel')) return 'necromancer';
  return 'unknown';
}

function formatClass(className) {
  return className
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
    className: inferClass(record),
  }));
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

function buildBotEmbeds(records, title = 'Safe Bot Parking') {
  if (!records.length) {
    return [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription('No Safe bots matched that request.')
        .setColor(0xffbf22)
        .setTimestamp(new Date()),
    ];
  }

  const chunks = [];
  for (let index = 0; index < records.length; index += 25) {
    chunks.push(records.slice(index, index + 25));
  }

  return chunks.slice(0, 10).map((chunk, index) => {
    const embed = new EmbedBuilder()
      .setTitle(index === 0 ? title : `${title} (${index + 1})`)
      .setColor(0xffbf22)
      .setFooter({ text: `${records.length} Safe bot${records.length === 1 ? '' : 's'} shown` })
      .setTimestamp(new Date());

    chunk.forEach((record) => {
      embed.addFields({
        name: `${record.character || 'Unknown'} · ${formatClass(record.className)}`,
        value: [
          `Zone: ${record.zone || 'Unknown'}`,
          `Server: ${record.server || 'Unknown'}`,
          `Parked: ${formatAge(record.enteredAt)} (${formatTimestamp(record.enteredAt)})`,
        ].join('\n'),
        inline: true,
      });
    });

    return embed;
  });
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
  const payload = { embeds: buildBotEmbeds(records, 'Safe Bot Parking Update') };
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
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'safebots') return;

  await interaction.deferReply();

  try {
    const className = interaction.options.getString('class');
    const search = interaction.options.getString('search');
    const records = filterBots(await fetchSafeBots(), className, search);
    const title = className ? `Safe Bot Parking · ${formatClass(className)}` : 'Safe Bot Parking';

    await interaction.editReply({ embeds: buildBotEmbeds(records, title) });
  } catch (error) {
    await interaction.editReply(`Could not load Safe bot parking: ${error.message}`);
  }
});

client.login(token);
