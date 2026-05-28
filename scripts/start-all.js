require('dotenv').config();

const { spawn } = require('node:child_process');

const children = new Set();
let shuttingDown = false;

function hasDiscordConfig() {
  return Boolean(
    process.env.DISCORD_TOKEN
    && process.env.EQLOG_BOTS_URL
    && (process.env.EQLOG_BOTS_TOKEN || process.env.DISCORD_BOT_API_TOKEN)
    && process.env.START_DISCORD_BOT !== 'false'
  );
}

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.add(child);

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    console.log(`[${name}] exited with ${signal || code}`);
    shutdown(code || 0);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    child.kill('SIGTERM');
  }

  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startProcess('web', process.execPath, ['server.js']);

if (hasDiscordConfig()) {
  setTimeout(() => {
    if (!shuttingDown) startProcess('discord', process.execPath, ['bot/discord-bot.js']);
  }, Number(process.env.DISCORD_START_DELAY_MS || 2000));
} else {
  console.log('[discord] skipped; set DISCORD_TOKEN, EQLOG_BOTS_URL, and EQLOG_BOTS_TOKEN to run the bot with npm start.');
}
