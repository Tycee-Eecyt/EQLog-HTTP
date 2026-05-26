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
```

Run:

```powershell
npm start
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

## Auto-Scan

Use `Auto-scan interval` to scan every 1 to 60 minutes. `Start Auto-Scan` runs one scan immediately and then repeats at the selected interval.

The browser page must remain open for auto-scan to run. If the browser tab is closed, suspended, or the saved folder permission is revoked, scans stop. For always-on background scanning, a Chrome extension or small local desktop/tray app would be a better architecture.

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
