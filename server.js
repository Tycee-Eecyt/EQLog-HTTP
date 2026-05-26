require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const { MongoClient } = require('mongodb');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'eqlog';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

let mongoClient;
let db;
let usersCollection;
let locationsCollection;

function formatMongoSetupError(error) {
  if (error?.code === 'ENOTFOUND' || error?.message?.includes('querySrv ENOTFOUND')) {
    return 'MongoDB host was not found. Re-copy the public mongodb+srv connection string from MongoDB Atlas: Connect > Drivers. Do not use a private endpoint hostname unless this server can resolve it.';
  }

  if (error?.message?.includes('bad auth') || error?.codeName === 'AuthenticationFailed') {
    return 'MongoDB authentication failed. Check the database username and password in MONGODB_URI.';
  }

  return error?.message || 'MongoDB connection failed.';
}

async function getDb() {
  if (!MONGODB_URI) {
    const error = new Error('MONGODB_URI is not configured.');
    error.statusCode = 500;
    throw error;
  }

  if (!mongoClient) {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      db = mongoClient.db(MONGODB_DB);
    } catch (error) {
      mongoClient = null;
      const setupError = new Error(formatMongoSetupError(error));
      setupError.statusCode = 500;
      throw setupError;
    }
  }

  return db;
}

async function getUsersCollection() {
  if (!usersCollection) {
    usersCollection = (await getDb()).collection('users');
    await usersCollection.createIndex({ usernameKey: 1 }, { unique: true });
  }

  return usersCollection;
}

async function getLocationsCollection() {
  if (!locationsCollection) {
    locationsCollection = (await getDb()).collection('parked_locations');
    await locationsCollection.createIndex({ owner: 1, serverKey: 1, characterKey: 1 }, { unique: true });
    await locationsCollection.createIndex({ owner: 1, enteredAt: -1 });
    await locationsCollection.createIndex({ visibility: 1, enteredAt: -1 });
  }

  return locationsCollection;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isBotCharacter(character) {
  return /^safe/i.test(String(character || '').trim());
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 310000, 32, 'sha256').toString('hex');
  return { salt, hash, iterations: 310000, digest: 'sha256' };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;

  const candidate = crypto.pbkdf2Sync(
    String(password),
    user.passwordSalt,
    user.passwordIterations || 310000,
    32,
    user.passwordDigest || 'sha256',
  );
  const stored = Buffer.from(user.passwordHash, 'hex');

  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(candidate, stored);
}

function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
  };
}

async function findUserByUsername(username) {
  const collection = await getUsersCollection();
  return collection.findOne({ usernameKey: normalizeKey(username) });
}

async function findUserById(id) {
  if (!ObjectId.isValid(id)) return null;
  const collection = await getUsersCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

async function createUser(username, password) {
  const cleanUsername = String(username || '').trim();
  const cleanPassword = String(password || '');

  if (cleanUsername.length < 3 || cleanUsername.length > 40) {
    const error = new Error('Username must be between 3 and 40 characters.');
    error.statusCode = 400;
    throw error;
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
    const error = new Error('Username can only contain letters, numbers, underscores, periods, and hyphens.');
    error.statusCode = 400;
    throw error;
  }

  if (cleanPassword.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.statusCode = 400;
    throw error;
  }

  const collection = await getUsersCollection();
  const passwordData = createPasswordHash(cleanPassword);

  try {
    const result = await collection.insertOne({
      username: cleanUsername,
      usernameKey: normalizeKey(cleanUsername),
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      passwordIterations: passwordData.iterations,
      passwordDigest: passwordData.digest,
      createdAt: new Date(),
    });

    return {
      _id: result.insertedId,
      username: cleanUsername,
    };
  } catch (error) {
    if (error.code === 11000) {
      const duplicate = new Error('That username is already registered.');
      duplicate.statusCode = 409;
      throw duplicate;
    }

    throw error;
  }
}

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await findUserByUsername(username);

    if (!user || !verifyPassword(password, user)) {
      return done(null, false, { message: 'Invalid username or password.' });
    }

    return done(null, publicUser(user));
  } catch (error) {
    return done(error);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await findUserById(id);
    done(null, user ? publicUser(user) : false);
  } catch (error) {
    done(error);
  }
});

function toClientRecord(record) {
  return {
    character: record.character,
    server: record.server,
    zone: record.zone,
    visibility: record.visibility || (isBotCharacter(record.character) ? 'public' : 'private'),
    isBot: isBotCharacter(record.character),
    enteredAt: record.enteredAt instanceof Date ? record.enteredAt.toISOString() : new Date(record.enteredAt).toISOString(),
    enteredAtRaw: record.enteredAtRaw || '',
    timeZone: record.timeZone || '',
    sourceFile: record.sourceFile || '',
    sourceLine: record.sourceLine || '',
    scannedAt: record.scannedAt instanceof Date ? record.scannedAt.toISOString() : new Date(record.scannedAt).toISOString(),
  };
}

async function getParkedLocations(owner) {
  const collection = await getLocationsCollection();
  const records = await collection
    .find({
      $or: [
        { visibility: 'public' },
        { owner, visibility: 'private' },
        { owner, visibility: { $exists: false }, characterKey: { $not: /^safe/ } },
      ],
    })
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
  const isBot = isBotCharacter(character);
  const recordOwner = isBot ? 'public' : owner;
  const visibility = isBot ? 'public' : 'private';

  const previous = await collection.findOne({ owner: recordOwner, characterKey, serverKey });
  const shouldUpdate = !previous || enteredAt.getTime() > new Date(previous.enteredAt).getTime();

  if (shouldUpdate) {
    await collection.updateOne(
      { owner: recordOwner, characterKey, serverKey },
      {
        $set: {
          owner: recordOwner,
          scannedBy: owner,
          visibility,
          character,
          characterKey,
          server,
          serverKey,
          zone,
          enteredAt,
          enteredAtRaw: entry.enteredAtRaw || '',
          timeZone: entry.timeZone || '',
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
    enteredAtRaw: entry.enteredAtRaw || '',
    timeZone: entry.timeZone || '',
    visibility,
    isBot,
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
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
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

app.get('/register', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/');
    return;
  }

  res.sendFile(path.join(PUBLIC_DIR, 'register.html'));
});

app.post('/register', async (req, res, next) => {
  try {
    const user = await createUser(req.body.username, req.body.password);
    req.login(publicUser(user), (error) => {
      if (error) return next(error);
      res.redirect('/');
    });
  } catch (error) {
    const message = encodeURIComponent(error.message || 'Registration failed.');
    res.redirect(`/register?error=${message}`);
  }
});

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
    res.json({ records: await getParkedLocations(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/import-zone-entries', requireAuth, async (req, res, next) => {
  try {
    const scan = await importZoneEntries(req.user.id, req.body.entries, {
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

  if (status >= 500) console.error(error);

  if (wantsJson(req)) {
    res.status(status).json({ error: error.message || 'Unexpected server error.' });
    return;
  }

  res.status(status).send(error.message || 'Unexpected server error.');
});

process.on('SIGTERM', async () => {
  if (mongoClient) await mongoClient.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`EQLog HTTP listening at http://localhost:${PORT}`);
  if (!process.env.SESSION_SECRET) {
    console.log('SESSION_SECRET is not set. Sessions will reset whenever the server restarts.');
  }
});
