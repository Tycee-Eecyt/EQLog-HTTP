require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'eqlog';
const SESSION_SECRET = process.env.SESSION_SECRET;
const AUTH_USERNAME = process.env.AUTH_USERNAME || process.env.LOGIN_USERNAME;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || process.env.LOGIN_PASSWORD;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION) {
  const missing = [];
  if (!MONGODB_URI) missing.push('MONGODB_URI');
  if (!SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!AUTH_USERNAME) missing.push('AUTH_USERNAME');
  if (!AUTH_PASSWORD) missing.push('AUTH_PASSWORD');

  if (missing.length) {
    throw new Error(`Missing required production environment variable(s): ${missing.join(', ')}`);
  }
}

const configuredUser = {
  id: AUTH_USERNAME || 'admin',
  username: AUTH_USERNAME || 'admin',
  password: AUTH_PASSWORD || 'password',
};

let mongoClient;
let locationsCollection;

async function getLocationsCollection() {
  if (!MONGODB_URI) {
    const error = new Error('MONGODB_URI is not configured.');
    error.statusCode = 500;
    throw error;
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
  }

  if (!locationsCollection) {
    locationsCollection = mongoClient.db(MONGODB_DB).collection('parked_locations');
    await locationsCollection.createIndex({ owner: 1, serverKey: 1, characterKey: 1 }, { unique: true });
    await locationsCollection.createIndex({ owner: 1, enteredAt: -1 });
  }

  return locationsCollection;
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

passport.use(new LocalStrategy((username, password, done) => {
  const validUsername = safeCompare(username, configuredUser.username);
  const validPassword = safeCompare(password, configuredUser.password);

  if (!validUsername || !validPassword) {
    return done(null, false, { message: 'Invalid username or password.' });
  }

  return done(null, { id: configuredUser.id, username: configuredUser.username });
}));

passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => {
  if (safeCompare(username, configuredUser.username)) {
    done(null, { id: configuredUser.id, username: configuredUser.username });
    return;
  }

  done(null, false);
});

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function toClientRecord(record) {
  return {
    character: record.character,
    server: record.server,
    zone: record.zone,
    enteredAt: record.enteredAt instanceof Date ? record.enteredAt.toISOString() : new Date(record.enteredAt).toISOString(),
    sourceFile: record.sourceFile || '',
    sourceLine: record.sourceLine || '',
    scannedAt: record.scannedAt instanceof Date ? record.scannedAt.toISOString() : new Date(record.scannedAt).toISOString(),
  };
}

async function getParkedLocations(owner) {
  const collection = await getLocationsCollection();
  const records = await collection
    .find({ owner })
    .sort({ enteredAt: -1, serverKey: 1, characterKey: 1 })
    .toArray();

  return records.map(toClientRecord);
}

function validateZoneEntry(entry) {
  const enteredAtMs = Date.parse(entry.enteredAt);
  if (!entry.character || !entry.server || !entry.zone || Number.isNaN(enteredAtMs)) {
    const error = new Error('Imported zone entries must include character, server, zone, and a valid enteredAt value.');
    error.statusCode = 400;
    throw error;
  }

  return new Date(enteredAtMs);
}

async function applyLatestEntry(owner, entry) {
  const collection = await getLocationsCollection();
  const enteredAt = validateZoneEntry(entry);
  const character = String(entry.character).trim();
  const server = String(entry.server).trim();
  const zone = String(entry.zone).trim();
  const characterKey = normalizeKey(character);
  const serverKey = normalizeKey(server);

  const previous = await collection.findOne({ owner, characterKey, serverKey });
  const shouldUpdate = !previous || enteredAt.getTime() > new Date(previous.enteredAt).getTime();

  if (shouldUpdate) {
    await collection.updateOne(
      { owner, characterKey, serverKey },
      {
        $set: {
          owner,
          character,
          characterKey,
          server,
          serverKey,
          zone,
          enteredAt,
          sourceFile: entry.sourceFile || '',
          sourceLine: entry.sourceLine || '',
          scannedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  return {
    fileName: entry.sourceFile || '',
    character,
    server,
    zone,
    enteredAt: enteredAt.toISOString(),
    status: shouldUpdate ? 'updated' : 'kept-existing',
    previousEnteredAt: previous?.enteredAt ? new Date(previous.enteredAt).toISOString() : null,
  };
}

async function importZoneEntries(owner, entries, metadata = {}) {
  if (!Array.isArray(entries)) {
    const error = new Error('entries must be an array.');
    error.statusCode = 400;
    throw error;
  }

  const results = [];

  for (const entry of entries) {
    results.push(await applyLatestEntry(owner, entry));
  }

  return {
    folder: metadata.folderName || 'Browser-selected folder',
    scannedFiles: Number(metadata.scannedFiles || entries.length),
    changed: results.filter((result) => result.status === 'updated').length,
    unchanged: results.filter((result) => result.status === 'kept-existing').length,
    withoutZoneEntry: Number(metadata.withoutZoneEntry || 0),
    results,
    errors: Array.isArray(metadata.errors) ? metadata.errors : [],
    records: await getParkedLocations(owner),
  };
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.headers.accept?.includes('application/json');
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();

  if (wantsJson(req)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  res.redirect('/login');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  name: 'eqlog.sid',
  secret: SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/');
    return;
  }

  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login?error=1',
}));

app.post('/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy(() => {
      res.clearCookie('eqlog.sid');
      res.redirect('/login');
    });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username } });
});

app.get('/api/locations', requireAuth, async (req, res, next) => {
  try {
    res.json({ records: await getParkedLocations(req.user.username) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/import-zone-entries', requireAuth, async (req, res, next) => {
  try {
    const scan = await importZoneEntries(req.user.username, req.body.entries, {
      folderName: req.body.folderName,
      scannedFiles: req.body.scannedFiles,
      withoutZoneEntry: req.body.withoutZoneEntry,
      errors: req.body.errors,
    });
    res.json(scan);
  } catch (error) {
    next(error);
  }
});

app.get('/index.html', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res) => {
  if (wantsJson(req)) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }

  res.status(404).send('Not found');
});

app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  const message = status >= 500 && IS_PRODUCTION ? 'Unexpected server error.' : error.message;

  if (status >= 500) console.error(error);

  if (wantsJson(req)) {
    res.status(status).json({ error: message });
    return;
  }

  res.status(status).send(message);
});

process.on('SIGTERM', async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`EQLog HTTP listening at http://localhost:${PORT}`);
  if (!IS_PRODUCTION && (!AUTH_USERNAME || !AUTH_PASSWORD)) {
    console.log('Development login fallback is admin / password. Set AUTH_USERNAME and AUTH_PASSWORD to override.');
  }
});
