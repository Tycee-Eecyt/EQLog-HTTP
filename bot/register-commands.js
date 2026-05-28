require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required to register commands.');
  process.exit(1);
}

const safebotsCommand = new SlashCommandBuilder()
  .setName('safebots')
  .setDescription('Show where the Safe bots are currently parked.')
  .addStringOption((option) => option
    .setName('class')
    .setDescription('Filter by inferred class.')
    .setRequired(false)
    .addChoices(
      { name: 'Cleric', value: 'cleric' },
      { name: 'Wizard', value: 'wizard' },
      { name: 'Warrior', value: 'warrior' },
      { name: 'Mage', value: 'magician' },
      { name: 'Druid', value: 'druid' },
      { name: 'Shaman', value: 'shaman' },
    ))
  .addStringOption((option) => option
    .setName('search')
    .setDescription('Filter by character, server, or zone.')
    .setRequired(false));

const commands = [safebotsCommand.toJSON()];
const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands() {
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} Discord command(s)${guildId ? ` for guild ${guildId}` : ' globally'}.`);
}

registerCommands().catch((error) => {
  console.error(error);
  process.exit(1);
});
