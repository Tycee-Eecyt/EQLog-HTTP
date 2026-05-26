# EQLog HTTP

Hosted webpage for scanning an EverQuest log folder and tracking the latest zone entered by each character.

The browser reads your local EQ log files. The server stores only the latest parked-location records in MongoDB, scoped to the signed-in username.

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
AUTH_USERNAME=your username
AUTH_PASSWORD=your password
```

Run:

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

If `AUTH_USERNAME` and `AUTH_PASSWORD` are missing in local development only, the fallback login is:

```text
admin / password
```

Production requires explicit auth environment variables.

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
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
MONGODB_DB=eqlog
SESSION_SECRET=<long random value>
AUTH_USERNAME=<your login>
AUTH_PASSWORD=<your password>
```

You can also use `render.yaml` as a Blueprint and fill in the secret values in Render.

## Usage

1. Log in.
2. Click `Choose Logs Folder`.
3. Select your EverQuest `Logs` folder in File Explorer.
4. Click `Scan Selected Files`.
5. The app reads `eqlog_*.txt` files, finds lines like `You have entered <zone>.`, and stores the most recent zone timestamp per character.
6. Existing character locations are only updated when the newly scanned zone-entry time is newer than the saved parked time.

## Saved Folder

On browsers that support the File System Access API, such as Microsoft Edge and Google Chrome, the selected Logs folder is remembered on this device through IndexedDB. When you reopen the page, click `Scan Selected Files` and the browser may ask you to confirm permission before reading the saved folder again.

Cookies and localStorage cannot store real folder access permissions. If your browser does not support saved directory handles, the app falls back to the normal folder picker and you will need to select the folder again after reloading the page.

## Filters

Names starting with `Safe` are treated as bots. Use the table filter to show all characters, my characters, or bots.
