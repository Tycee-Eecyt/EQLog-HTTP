# EQLog HTTP

Hosted webpage for scanning an EverQuest log folder and tracking the latest zone entered by each character.

The browser reads your local EQ log files. The server stores only the latest parked-location records in MongoDB. Normal characters are private to the signed-in account. Characters whose names start with `Safe` are treated as bots and are shared with every signed-in user.

## Local Setup

Install dependencies:

```powershell
npm install
```

Create `.env` from `.env.example` and set:

```text
MONGODB_URI=your MongoDB Atlas connection string
MONGODB_DB=eqlog
SESSION_SECRET=a long random string
COOKIE_SECURE=false
DISCORD_BOT_API_TOKEN=optional long random token for Discord bot reads
DISCORD_TOKEN=optional Discord bot token
DISCORD_CLIENT_ID=optional Discord application client id
DISCORD_GUILD_ID=optional Discord test server id
DISCORD_STATUS_CHANNEL_ID=optional Discord channel id for automatic posts
DISCORD_AUTO_POST_MINUTES=0
EQLOG_BOTS_URL=http://localhost:3000/api/discord/bots
EQLOG_BOTS_TOKEN=same value as DISCORD_BOT_API_TOKEN
```

Run:

```powershell
npm start
```

`npm start` runs the web server and, when Discord bot environment variables are present, starts the Discord bot in the same terminal for easier local testing. To run only the web server, use:

```powershell
npm run start:web
```

Open:

```text
http://localhost:3000
```

Create an account from `/register`, then sign in from `/login`. Usernames and salted password hashes are stored in the MongoDB `users` collection.

## Render Setup

1. Push this project to GitHub.
2. Create a MongoDB Atlas cluster.
3. Create a database user and copy the application connection string.
4. In MongoDB Atlas Network Access, allow Render to connect. The simple option is `0.0.0.0/0`; a stricter setup requires static outbound IPs.
5. In Render, create a new Web Service from the GitHub repo.
6. Use:

```text
Build Command: npm install
Start Command: npm start
```

7. Add Render environment variables:

```text
NODE_VERSION=20
MONGODB_URI=mongodb+srv://...
MONGODB_DB=eqlog
SESSION_SECRET=<long random value>
COOKIE_SECURE=false
DISCORD_BOT_API_TOKEN=<long random value>
```

You can also use `render.yaml` as a Blueprint and fill in the secret values in Render.

## Authentication

Authentication uses Passport Local Strategy backed by MongoDB:

- `users` collection stores usernames and PBKDF2 salted password hashes.
- Private `parked_locations` records are scoped by authenticated user id.
- Public bot records are shared by all users.
- No `AUTH_USERNAME`, `AUTH_PASSWORD`, or `NODE_ENV` variable is required.

Registration is currently open to anyone who can reach `/register`. If the app is public and you only want personal access, keep the Render URL private or add an invite-code / admin approval step later.

## Usage

1. Register or log in.
2. Click `Choose Logs Folder`.
3. Select your EverQuest `Logs` folder in File Explorer.
4. Click `Scan Selected Files`.
5. The app reads `eqlog_*.txt` files, finds lines like `You have entered <zone>.`, and stores the most recent zone timestamp per character.
6. Existing character locations are only updated when the newly scanned zone-entry time is newer than the saved parked time.

## Timezone Handling

Set `Log timezone` to the timezone used by the computer that writes the EverQuest logs, for example `America/New_York`. The selected timezone is saved in browser localStorage. Log timestamps are parsed as wall-clock time in that timezone and then sent to the server as UTC, with the raw log timestamp and timezone stored alongside the record.

For shared bots, this keeps `newer timestamp wins` consistent when users scan from different regions. If the EQ client writes logs using your local PC clock, use that PC's timezone.

## Auto-Scan

Use `Auto-scan interval` to scan every 1 to 60 minutes. `Start Auto-Scan` runs one scan immediately and then repeats at the selected interval.

The browser page must remain open for auto-scan to run. If the browser tab is closed, suspended, or the saved folder permission is revoked, scans stop. For always-on background scanning, a Chrome extension or small local desktop/tray app would be a better architecture.


## Inventory Files

Use the `Inventory` page to manually scan EverQuest inventory output files without cluttering the parked-location page. The inventory scanner:

- Looks for `Character-Inventory*.txt` files. EverQuest usually writes these inventory files to the root EverQuest folder by default, not the `Logs` folder.
- Parses tab-delimited or comma-delimited tables when headers are present.
- In Chrome/Edge, uses direct folder access and reads only matching inventory files before upload. In fallback browsers, the folder picker may show browser-level upload wording, but the app still filters before sending data. Stores parsed rows in MongoDB under the signed-in account.
- Does not run on the parked-location auto-scan interval.
- Shows saved inventory files as expandable tables on `/inventory`.
## Saved Folder

On browsers that support the File System Access API, such as Microsoft Edge and Google Chrome, the selected Logs folder is remembered on this device through IndexedDB. When you reopen the page, click `Scan Selected Files` or `Start Auto-Scan` and the browser may ask you to confirm permission before reading the saved folder again.

Cookies and localStorage cannot store real folder access permissions. If your browser does not support saved directory handles, the app falls back to the normal folder picker and you will need to select the folder again after reloading the page.

## Visibility And Filters

Names starting with `Safe` are treated as bots:

- Bots are stored as public records and shared with every signed-in user.
- Non-bot characters are private to the account that scanned them.
- `All Characters` shows your private characters plus public bots.
- `My Characters` shows only your non-bot characters.
- `Bots` shows public shared bots.

## Discord Dashboard

Open `/discord` after signing in to view the Safe bot dashboard. It shows only public bot records, meaning characters whose names start with `Safe`, and highlights where each bot was last parked.

Discord apps can read the same bot-only data from:

```text
GET /api/discord/bots
Authorization: Bearer <DISCORD_BOT_API_TOKEN>
```

If `DISCORD_BOT_API_TOKEN` is not configured, the endpoint still works for signed-in browser sessions but rejects bearer-token access.

## Discord Bot

The included Discord bot adds Safe Space roster commands that post the Safe bot parking list into the Discord channel where the command is used.

Create a Discord application at the Discord Developer Portal, add a bot user, copy its token, then invite it to your server with the `applications.commands` and `bot` scopes. The bot only needs permission to send messages and embed links.

Set these values in `.env`:

```text
DISCORD_TOKEN=<Discord bot token>
DISCORD_CLIENT_ID=<Discord application client id>
DISCORD_GUILD_ID=<server id for fast command registration>
DISCORD_BOT_API_TOKEN=<long random API token>
EQLOG_BOTS_TOKEN=<same value as DISCORD_BOT_API_TOKEN>
EQLOG_BOTS_URL=https://your-eqlog-site.com/api/discord/bots
```

Register the command:

```powershell
npm run discord:register
```

Run the bot:

```powershell
npm run discord:bot
```

Use `/safebots` or `/roster` in a Discord channel. Optional filters are available for class and search text. `/bots` lists one class, `/bot` shows a single Safe bot detail card, `/setclass` manually assigns a class to a Safe bot, and `/quake` posts a priority parking snapshot for quick mobilization.

Classes are inferred from Safe bot names by default. To override an inferred class, run:

```text
/setclass name:Safecoth class:Wizard
```

Choose `Unknown` in `/setclass` to clear the manual override and return to name-based inference.

In production, you can still run the web app and Discord bot as separate processes. For example, use `npm run start:web` for the Render web service, then add a Render Background Worker with start command `npm run start:bot` using the same Discord and EQLog API environment variables. If you use `npm start` on a service with Discord env vars present, it starts both processes together.

For automatic channel posts, set:

```text
DISCORD_STATUS_CHANNEL_ID=<channel id>
DISCORD_AUTO_POST_MINUTES=60
```

When `DISCORD_STATUS_CHANNEL_ID` is set, the bot posts one status message when it starts. If `DISCORD_AUTO_POST_MINUTES` is greater than `0`, the bot refreshes that same message instead of posting a new message each time. The saved message id is stored locally in `data/discord-status-message.json`.
