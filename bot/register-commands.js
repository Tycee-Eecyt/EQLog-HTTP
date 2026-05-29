require('dotenv').config();

const {
  ChannelType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const { CLASS_ORDER, getClassConfig } = require('./roster-config');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

function cleanRequiredSnowflake(value, label) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^your-/i.test(trimmed) || /^optional-/i.test(trimmed)) {
    console.error(`${label} must be set to a numeric Discord ID, not placeholder text.`);
    process.exit(1);
  }

  if (!/^\d{17,20}$/.test(trimmed)) {
    console.error(`${label} must be a numeric Discord ID, usually 17-20 digits.`);
    process.exit(1);
  }

  return trimmed;
}

function cleanOptionalSnowflake(value, label) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^your-/i.test(trimmed) || /^optional-/i.test(trimmed)) return '';

  if (!/^\d{17,20}$/.test(trimmed)) {
    console.error(`${label} must be blank or a numeric Discord ID, usually 17-20 digits.`);
    process.exit(1);
  }

  return trimmed;
}

if (!token || /^your-/i.test(token)) {
  console.error('DISCORD_TOKEN is required to register commands.');
  process.exit(1);
}

const cleanClientId = cleanRequiredSnowflake(clientId, 'DISCORD_CLIENT_ID');
const cleanGuildId = cleanOptionalSnowflake(guildId, 'DISCORD_GUILD_ID');

const classChoices = CLASS_ORDER
  .filter((className) => className !== 'unknown')
  .map((className) => ({ name: getClassConfig(className).label, value: className }));

function addClassAndSearchOptions(command) {
  return command
  .addStringOption((option) => option
    .setName('class')
    .setDescription('Filter by class.')
    .setRequired(false)
    .addChoices(...classChoices))
  .addStringOption((option) => option
    .setName('search')
    .setDescription('Filter by character, server, or zone.')
    .setRequired(false));
}

const safebotsCommand = addClassAndSearchOptions(new SlashCommandBuilder()
  .setName('safebots')
  .setDescription('Show where the Safe bots are currently parked.'));

const rosterCommand = addClassAndSearchOptions(new SlashCommandBuilder()
  .setName('roster')
  .setDescription('Show the Safe Space bot roster.'));

const botCommand = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Show parking details for one Safe bot.')
  .addStringOption((option) => option
    .setName('name')
    .setDescription('Safe bot name.')
    .setRequired(true));

const botsCommand = new SlashCommandBuilder()
  .setName('bots')
  .setDescription('List Safe bots of a specific class.')
  .addStringOption((option) => option
    .setName('class')
    .setDescription('Class to list.')
    .setRequired(true)
    .addChoices(...classChoices));

const quakeCommand = new SlashCommandBuilder()
  .setName('quake')
  .setDescription('Post a Safe bot parking readiness summary.');

const setClassCommand = new SlashCommandBuilder()
  .setName('setclass')
  .setDescription('Set the class used for one Safe bot.')
  .addStringOption((option) => option
    .setName('name')
    .setDescription('Safe bot name.')
    .setRequired(true))
  .addStringOption((option) => option
    .setName('class')
    .setDescription('Class to assign. Use Unknown to clear the manual class.')
    .setRequired(true)
    .addChoices(
      ...classChoices,
      { name: 'Unknown', value: 'unknown' },
    ))
  .addStringOption((option) => option
    .setName('server')
    .setDescription('Optional server if multiple records have the same bot name.')
    .setRequired(false));

const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the automatic Safe bot roster update for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) => option
    .setName('channel')
    .setDescription('Channel where the bot should post and refresh the roster. Defaults to this channel.')
    .setRequired(false)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

const commands = [
  safebotsCommand,
  rosterCommand,
  botCommand,
  botsCommand,
  quakeCommand,
  setClassCommand,
  setupCommand,
].map((command) => command.toJSON());
const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
  const route = cleanGuildId
    ? Routes.applicationGuildCommands(cleanClientId, cleanGuildId)
    : Routes.applicationCommands(cleanClientId);

  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} Discord command(s)${cleanGuildId ? ` for guild ${cleanGuildId}` : ' globally'}.`);
}

registerCommands().catch((error) => {
  console.error(error);
  process.exit(1);
});
