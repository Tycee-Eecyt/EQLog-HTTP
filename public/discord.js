const searchInput = document.querySelector('#discord-search');
const filterButtonsContainer = document.querySelector('#class-filter-buttons');
const body = document.querySelector('#discord-bots-body');
const botCount = document.querySelector('#discord-bot-count');
const zoneCount = document.querySelector('#discord-zone-count');
const readyCount = document.querySelector('#discord-ready-count');
const currentUser = document.querySelector('#current-user');
const characterModal = document.querySelector('#character-modal');
const modalCharacterName = document.querySelector('#modal-character-name');
const modalCharacterDetails = document.querySelector('#modal-character-details');
const modalCloseButton = document.querySelector('#modal-close');
const logsButton = document.querySelector('#discord-logs-button');
const logsScanButton = document.querySelector('#discord-logs-scan-button');
const logsPicker = document.querySelector('#discord-logs-picker');
const logsStatus = document.querySelector('#discord-logs-status');
const autoScanButton = document.querySelector('#discord-auto-scan-button');
const scanIntervalInput = document.querySelector('#discord-scan-interval');
const inventoryButton = document.querySelector('#discord-inventory-button');
const inventoryScanButton = document.querySelector('#discord-inventory-scan-button');
const inventoryPicker = document.querySelector('#discord-inventory-picker');
const inventoryStatus = document.querySelector('#discord-inventory-status');
const timezoneInput = document.querySelector('#discord-timezone');
const useLocalTimezoneButton = document.querySelector('#discord-use-local-timezone');

let bots = [];
let activeClass = 'all';
let selectedLogFiles = [];
let selectedLogFolderName = '';
let selectedLogDirectoryHandle = null;
let selectedInventoryFiles = [];
let selectedInventoryFolderName = '';
let selectedInventoryDirectoryHandle = null;
let scanningLogs = false;
let scanningInventory = false;
let autoScanTimer = null;
let autoScanActive = false;
const REQUIRED_ITEMS = ['Ring of Shadow', 'Thurg Pot', 'CT Pot', 'WC Cap', 'Reaper'];
const ITEM_LABELS = {
  'Ring of Shadow': 'Ring',
  'Thurg Pot': 'Thurg',
  'CT Pot': 'CT',
  'WC Cap': 'WC',
  Reaper: 'Reaper',
};
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DB_NAME = 'eqlog-http';
const DB_VERSION = 2;
const STORE_NAME = 'settings';
const LOG_FOLDER_KEY = 'logs-directory-handle';
const ROOT_FOLDER_KEY = 'everquest-root-directory-handle';
const TIMEZONE_KEY = 'eqlog-timezone';
const AUTO_SCAN_KEY = 'eqlog-auto-scan-enabled';
const SCAN_INTERVAL_KEY = 'eqlog-scan-interval-minutes';
const MONTHS = new Map([
  ['Jan', 0],
  ['Feb', 1],
  ['Mar', 2],
  ['Apr', 3],
  ['May', 4],
  ['Jun', 5],
  ['Jul', 6],
  ['Aug', 7],
  ['Sep', 8],
  ['Oct', 9],
  ['Nov', 10],
  ['Dec', 11],
]);

const CLASS_CONFIG = {
  enchanter: { label: 'Enchanter', abbreviation: 'ENC', category: 'Casters' },
  magician: { label: 'Magician', abbreviation: 'MAG', category: 'Casters' },
  necromancer: { label: 'Necromancer', abbreviation: 'NEC', category: 'Casters' },
  wizard: { label: 'Wizard', abbreviation: 'WIZ', category: 'Casters' },
  cleric: { label: 'Cleric', abbreviation: 'CLR', category: 'Priests' },
  druid: { label: 'Druid', abbreviation: 'DRU', category: 'Priests' },
  shaman: { label: 'Shaman', abbreviation: 'SHM', category: 'Priests' },
  bard: { label: 'Bard', abbreviation: 'BRD', category: 'Melee' },
  monk: { label: 'Monk', abbreviation: 'MNK', category: 'Melee' },
  ranger: { label: 'Ranger', abbreviation: 'RNG', category: 'Melee' },
  rogue: { label: 'Rogue', abbreviation: 'ROG', category: 'Melee' },
  paladin: { label: 'Paladin', abbreviation: 'PAL', category: 'Tanks' },
  'shadow-knight': { label: 'Shadow Knight', abbreviation: 'SHD', category: 'Tanks' },
  warrior: { label: 'Warrior', abbreviation: 'WAR', category: 'Tanks' },
  unknown: { label: 'Unknown', abbreviation: 'UNK', category: 'Other' },
};
const CLASS_ORDER = Object.keys(CLASS_CONFIG);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

function getFolderName(files) {
  const firstPath = files[0]?.webkitRelativePath || '';
  return firstPath ? firstPath.split('/')[0] : 'Selected folder';
}

function supportsDirectoryHandles() {
  return 'showDirectoryPicker' in window && 'indexedDB' in window;
}

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { autoIncrement: true });
      if (!db.objectStoreNames.contains('cachedApi')) db.createObjectStore('cachedApi');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredValue(key) {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function setStoredValue(key, value) {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const request = transaction.objectStore(STORE_NAME).put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

async function ensureDirectoryPermission(directoryHandle) {
  const options = { mode: 'read' };
  if ((await directoryHandle.queryPermission(options)) === 'granted') return true;
  return (await directoryHandle.requestPermission(options)) === 'granted';
}

function parseLogFilename(fileName) {
  const match = fileName.match(/^eqlog_([^_]+)_(.+)\.txt$/i);
  if (!match) return null;
  return { character: match[1], server: match[2] };
}

function getTimezoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  let utcGuess = Date.UTC(year, month, day, hour, minute, second);

  for (let i = 0; i < 3; i += 1) {
    const parts = getTimezoneParts(new Date(utcGuess), timeZone);
    const zonedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offset = zonedAsUtc - utcGuess;
    const nextGuess = Date.UTC(year, month, day, hour, minute, second) - offset;
    if (nextGuess === utcGuess) break;
    utcGuess = nextGuess;
  }

  return new Date(utcGuess);
}

function getSelectedTimezone() {
  const timeZone = timezoneInput.value.trim() || localTimezone;
  new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  timezoneInput.value = timeZone;
  localStorage.setItem(TIMEZONE_KEY, timeZone);
  return timeZone;
}

function getIntervalMs() {
  const minutes = Math.min(60, Math.max(1, Number(scanIntervalInput.value || 5)));
  scanIntervalInput.value = String(minutes);
  localStorage.setItem(SCAN_INTERVAL_KEY, String(minutes));
  return minutes * 60 * 1000;
}

function parseEqTimestamp(line, timeZone) {
  const match = line.match(/^\[(\w{3}) (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/);
  if (!match) return null;

  const [, , monthName, day, hour, minute, second, year] = match;
  const month = MONTHS.get(monthName);
  if (month === undefined) return null;

  const date = zonedTimeToUtc(Number(year), month, Number(day), Number(hour), Number(minute), Number(second), timeZone);

  return Number.isNaN(date.getTime()) ? null : {
    date,
    raw: `${monthName} ${day} ${hour}:${minute}:${second} ${year}`,
    timeZone,
  };
}

function parseZoneEntry(line) {
  const match = line.match(/\] You have entered (.+?)\.$/);
  return match ? match[1].trim() : null;
}

async function findLatestZoneEntry(file, timeZone) {
  const text = await file.text();
  return text.split(/\r?\n/).reduce((latest, line) => {
    const zone = parseZoneEntry(line);
    if (!zone) return latest;

    const timestamp = parseEqTimestamp(line, timeZone);
    if (!timestamp) return latest;

    if (!latest || timestamp.date.getTime() > latest.enteredAtMs) {
      return {
        zone,
        enteredAt: timestamp.date.toISOString(),
        enteredAtMs: timestamp.date.getTime(),
        enteredAtRaw: timestamp.raw,
        timeZone: timestamp.timeZone,
        sourceLine: line,
      };
    }

    return latest;
  }, null);
}

function isInventoryFile(file) {
  return /^[^-\\/:]+-Inventory.*\.txt$/i.test(file.name);
}

function inferInventoryCharacter(fileName) {
  const baseName = String(fileName || '').split(/[\\/]/).pop() || '';
  const match = baseName.match(/^(.+?)-Inventory/i);
  return match ? match[1] : '';
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function makeUniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = header || `Column ${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base} ${count + 1}` : base;
  });
}

function parseInventoryText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : null);
  if (!delimiter) return { headers: ['Line'], rows: lines.map((line) => ({ Line: line })) };

  const headers = makeUniqueHeaders(parseDelimitedLine(lines[0], delimiter));
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });

  return { headers, rows };
}

async function loadCurrentUser() {
  if (!currentUser) return;

  try {
    const data = await fetchJson('/api/me');
    currentUser.textContent = data.user?.username || 'Signed in';
  } catch (error) {
    currentUser.textContent = 'Unknown';
  }
}

function inferClass(record) {
  const name = String(record.character || '').toLowerCase();
  const zone = String(record.zone || '').toLowerCase();

  if (/heal|cleric|clr|rez/.test(name)) return 'cleric';
  if (/wiz|port|evac/.test(name)) return 'wizard';
  if (/war|tank/.test(name)) return 'warrior';
  if (/ench|chanter|enc|mez|clarity/.test(name)) return 'enchanter';
  if (/mage|mag|mod/.test(name)) return 'magician';
  if (/dru|track|snare/.test(name)) return 'druid';
  if (/sham|slow|shm/.test(name)) return 'shaman';
  if (/bard|brd|song/.test(name)) return 'bard';
  if (/monk|mnk|pull/.test(name)) return 'monk';
  if (/ranger|rng/.test(name)) return 'ranger';
  if (/rogue|rog|stab/.test(name)) return 'rogue';
  if (/paladin|pal/.test(name)) return 'paladin';
  if (/sk|shadow/.test(name)) return 'shadow-knight';
  if (/necro|nec/.test(name) || zone.includes('paineel')) return 'necromancer';
  return 'unknown';
}

function formatClass(className) {
  return CLASS_CONFIG[className]?.label || CLASS_CONFIG.unknown.label;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatAge(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Unknown';

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

function decorateBot(record) {
  return {
    ...record,
    className: record.className || inferClass(record),
    classLabel: record.classLabel || formatClass(record.className || inferClass(record)),
    classAbbreviation: record.classAbbreviation || CLASS_CONFIG[record.className || inferClass(record)]?.abbreviation || 'UNK',
    classCategory: record.classCategory || CLASS_CONFIG[record.className || inferClass(record)]?.category || 'Other',
    ready: Boolean(record.ready || (record.zone && record.zone !== 'Unknown')),
  };
}

function renderClassControls() {
  filterButtonsContainer.innerHTML = [
    '<button type="button" class="active" data-class="all">All</button>',
    ...CLASS_ORDER
      .filter((className) => className !== 'unknown')
      .map((className) => `<button type="button" data-class="${escapeHtml(className)}">${escapeHtml(CLASS_CONFIG[className].abbreviation)}</button>`),
  ].join('');
}

function sortBots(a, b) {
  const aClass = CLASS_ORDER.indexOf(a.className);
  const bClass = CLASS_ORDER.indexOf(b.className);
  const aIndex = aClass === -1 ? CLASS_ORDER.length : aClass;
  const bIndex = bClass === -1 ? CLASS_ORDER.length : bClass;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return String(a.character || '').localeCompare(String(b.character || ''));
}

function getFilteredBots() {
  const query = searchInput.value.trim().toLowerCase();

  return bots.filter((record) => {
    if (activeClass !== 'all' && record.className !== activeClass) return false;
    if (!query) return true;

    return [
      record.character,
      record.server,
      record.zone,
      record.className,
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });
}

function renderStats() {
  const uniqueZones = new Set(bots.map((record) => record.zone).filter(Boolean));
  const ready = bots.filter((record) => record.ready).length;

  botCount.textContent = bots.length;
  zoneCount.textContent = uniqueZones.size;
  readyCount.textContent = ready;
}

function renderXpCell(record) {
  if (record.xp === undefined || record.xp === null || record.xp === '') {
    return '<span class="cell-placeholder">Unknown</span>';
  }

  const xp = Math.max(0, Math.min(99, Number(record.xp)));
  if (Number.isNaN(xp)) {
    return '<span class="cell-placeholder">Unknown</span>';
  }

  return `
    <span class="xp-cell">
      <span class="xp-bar"><span style="width: ${xp}%"></span></span>
      <span>${xp}%</span>
    </span>
  `;
}

function renderInventoryChips(record) {
  const knownItems = record.itemStatus || {};
  return REQUIRED_ITEMS.map((item) => {
    const hasItem = knownItems[item] === true;
    const known = Object.prototype.hasOwnProperty.call(knownItems, item);
    const className = known ? (hasItem ? 'has' : 'missing') : 'unknown';
    return `<span class="inventory-chip ${className}" title="${escapeHtml(item)}">${escapeHtml(ITEM_LABELS[item] || item)}</span>`;
  }).join('');
}

function detailValue(value) {
  return value === undefined || value === null || value === '' ? 'Unknown' : value;
}

function renderDetailItem(label, value) {
  return `
    <article>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(detailValue(value))}</strong>
    </article>
  `;
}

function openCharacterModal(record) {
  if (!record || !characterModal) return;

  modalCharacterName.textContent = record.character || 'Unknown';
  modalCharacterDetails.innerHTML = [
    renderDetailItem('Class', `${record.classLabel || formatClass(record.className)} ${record.classAbbreviation || ''}`.trim()),
    renderDetailItem('Level', record.level || 60),
    renderDetailItem('XP', record.xp === undefined || record.xp === null || record.xp === '' ? 'Unknown' : `${record.xp}%`),
    renderDetailItem('Zone', record.zone),
    renderDetailItem('Server', record.server),
    renderDetailItem('Parked', formatAge(record.enteredAt)),
    renderDetailItem('Updated', formatDate(record.enteredAt)),
    renderDetailItem('Class source', record.classSource || 'inferred'),
    renderDetailItem('Ready', record.ready ? 'Ready' : 'Unknown'),
    renderDetailItem('Inventory', REQUIRED_ITEMS.map((item) => `${ITEM_LABELS[item] || item}: ${record.itemStatus?.[item] === true ? 'Yes' : 'Unknown'}`).join(' | ')),
  ].join('');

  if (typeof characterModal.showModal === 'function') {
    characterModal.showModal();
  } else {
    characterModal.setAttribute('open', '');
  }
}

function updateScannerButtons() {
  logsButton.disabled = scanningLogs;
  logsScanButton.disabled = scanningLogs || (!selectedLogDirectoryHandle && selectedLogFiles.length === 0);
  autoScanButton.disabled = !selectedLogDirectoryHandle && selectedLogFiles.length === 0;
  autoScanButton.textContent = autoScanActive ? 'Stop Auto-Scan' : 'Start Auto-Scan';
  inventoryButton.disabled = scanningInventory;
  inventoryScanButton.disabled = scanningInventory || (!selectedInventoryDirectoryHandle && selectedInventoryFiles.length === 0);
}

function renderBots() {
  renderStats();

  const filteredBots = getFilteredBots();
  if (!filteredBots.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No Safe bots match this view.</td></tr>';
    return;
  }

  body.innerHTML = filteredBots.map((record, index) => `
    <tr>
      <td><button type="button" class="safe-name character-detail-button" data-bot-index="${index}">${escapeHtml(record.character)}</button></td>
      <td><span class="class-chip ${escapeHtml(record.className)}" title="${escapeHtml(record.classLabel || formatClass(record.className))}">${escapeHtml(record.classAbbreviation || 'UNK')}</span></td>
      <td><strong class="level-cell">${escapeHtml(record.level || 60)}</strong></td>
      <td><span class="zone-pill">${escapeHtml(record.zone || 'Unknown')}</span></td>
      <td><span class="inventory-list">${renderInventoryChips(record)}</span></td>
      <td>${escapeHtml(formatAge(record.enteredAt) || 'Unknown')}</td>
    </tr>
  `).join('');
}

async function loadBots() {
  body.innerHTML = '<tr><td colspan="6" class="empty">Loading Safe bot roster...</td></tr>';

  try {
    const data = await fetchJson('/api/discord/bots');
    bots = (data.records || []).map(decorateBot).sort(sortBots);
    renderBots();
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function getLogFilesFromDirectory(directoryHandle) {
  const files = [];

  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'file' || !/^eqlog_.+_.+\.txt$/i.test(entry.name)) continue;
    const file = await entry.getFile();
    files.push({ file, sourceFile: `${directoryHandle.name}/${entry.name}` });
  }

  files.sort((a, b) => a.file.name.localeCompare(b.file.name));
  return files;
}

async function getInventoryFilesFromDirectory(directoryHandle) {
  const files = [];

  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'file' || !isInventoryFile(entry)) continue;
    const file = await entry.getFile();
    files.push({ file, sourceFile: `${directoryHandle.name}/${entry.name}` });
  }

  files.sort((a, b) => a.file.name.localeCompare(b.file.name));
  return files;
}

async function loadSavedScannerState() {
  timezoneInput.value = localStorage.getItem(TIMEZONE_KEY) || localTimezone;
  scanIntervalInput.value = localStorage.getItem(SCAN_INTERVAL_KEY) || scanIntervalInput.value;
  getIntervalMs();

  if (!supportsDirectoryHandles()) {
    updateScannerButtons();
    return;
  }

  try {
    const handle = await getStoredValue(LOG_FOLDER_KEY);
    if (handle) {
      selectedLogDirectoryHandle = handle;
      selectedLogFolderName = handle.name;
      logsStatus.textContent = `${handle.name}: saved on this device. Click Scan Logs to reuse it.`;
    }
  } catch (error) {
    logsStatus.textContent = `Could not load saved Logs folder: ${error.message}`;
  }

  try {
    const handle = await getStoredValue(ROOT_FOLDER_KEY);
    if (handle) {
      selectedInventoryDirectoryHandle = handle;
      selectedInventoryFolderName = handle.name;
      inventoryStatus.textContent = `${handle.name}: saved on this device. Click Scan Inventory to reuse it.`;
    }
  } catch (error) {
    inventoryStatus.textContent = `Could not load saved root folder: ${error.message}`;
  }

  updateScannerButtons();
  if (localStorage.getItem(AUTO_SCAN_KEY) === 'true' && (selectedLogDirectoryHandle || selectedLogFiles.length > 0)) {
    startAutoScan();
  }
}

async function scanLogs(items, folderName) {
  const logItems = items.filter((item) => /^eqlog_.+_.+\.txt$/i.test(item.file.name));
  const entries = [];
  const errors = [];
  let withoutZoneEntry = 0;
  const timeZone = getSelectedTimezone();

  logsStatus.textContent = `Scanning ${logItems.length} log file(s)...`;

  for (const item of logItems) {
    const { file, sourceFile } = item;
    const identity = parseLogFilename(file.name);
    if (!identity) continue;

    try {
      const latest = await findLatestZoneEntry(file, timeZone);
      if (!latest) {
        withoutZoneEntry += 1;
        continue;
      }

      entries.push({
        character: identity.character,
        server: identity.server,
        zone: latest.zone,
        enteredAt: latest.enteredAt,
        enteredAtRaw: latest.enteredAtRaw,
        timeZone: latest.timeZone,
        sourceFile,
        sourceLine: latest.sourceLine,
      });
    } catch (error) {
      errors.push({ fileName: sourceFile, message: error.message });
    }
  }

  const scan = await postJson('/api/import-zone-entries', {
    folderName,
    scannedFiles: logItems.length,
    withoutZoneEntry,
    errors,
    entries,
  });

  logsStatus.textContent = `${folderName}: scanned ${scan.scannedFiles}; updated ${scan.changed}; kept ${scan.unchanged}.`;
  await loadBots();
}

async function scanSelectedLogs() {
  if (!selectedLogDirectoryHandle && selectedLogFiles.length === 0) {
    logsStatus.textContent = 'Choose your EverQuest Logs folder first.';
    return;
  }

  if (scanningLogs) return;

  scanningLogs = true;
  updateScannerButtons();

  try {
    let filesToScan = selectedLogFiles;
    let folderName = selectedLogFolderName || 'Selected folder';

    if (selectedLogDirectoryHandle) {
      const hasPermission = await ensureDirectoryPermission(selectedLogDirectoryHandle);
      if (!hasPermission) throw new Error('Browser permission is required to read the saved Logs folder.');
      filesToScan = await getLogFilesFromDirectory(selectedLogDirectoryHandle);
      folderName = selectedLogDirectoryHandle.name;
    }

    if (!filesToScan.length) throw new Error('No eqlog_Character_server.txt files were found in the selected folder.');
    await scanLogs(filesToScan, folderName);
  } catch (error) {
    logsStatus.textContent = error.message;
  } finally {
    scanningLogs = false;
    updateScannerButtons();
  }
}

function stopAutoScan(message = 'Auto-scan stopped.') {
  if (autoScanTimer) clearInterval(autoScanTimer);
  autoScanTimer = null;
  autoScanActive = false;
  localStorage.setItem(AUTO_SCAN_KEY, 'false');
  updateScannerButtons();
  logsStatus.textContent = message;
}

function startAutoScan() {
  if (!selectedLogDirectoryHandle && selectedLogFiles.length === 0) {
    logsStatus.textContent = 'Choose your EverQuest Logs folder before starting auto-scan.';
    return;
  }

  if (autoScanTimer) clearInterval(autoScanTimer);
  autoScanActive = true;
  localStorage.setItem(AUTO_SCAN_KEY, 'true');
  autoScanTimer = setInterval(scanSelectedLogs, getIntervalMs());
  updateScannerButtons();
  logsStatus.textContent = `Auto-scan started. It will run every ${scanIntervalInput.value} minute(s) while this page stays open.`;
  scanSelectedLogs();
}

async function scanInventory(items, folderName) {
  const inventoryFiles = items.filter((item) => isInventoryFile(item.file));
  const parsedFiles = [];

  inventoryStatus.textContent = `Scanning ${inventoryFiles.length} inventory file(s)...`;

  for (const item of inventoryFiles) {
    const { file, sourceFile } = item;
    const parsed = parseInventoryText(await file.text());
    parsedFiles.push({
      fileName: sourceFile,
      character: inferInventoryCharacter(file.name),
      headers: parsed.headers,
      rows: parsed.rows,
    });
  }

  const scan = await postJson('/api/import-inventory-files', { files: parsedFiles });
  inventoryStatus.textContent = `${folderName}: saved ${scan.files?.length || parsedFiles.length} inventory file(s).`;
}

async function scanSelectedInventory() {
  if (!selectedInventoryDirectoryHandle && selectedInventoryFiles.length === 0) {
    inventoryStatus.textContent = 'Choose your root EverQuest folder first.';
    return;
  }

  scanningInventory = true;
  updateScannerButtons();

  try {
    let filesToScan = selectedInventoryFiles;
    let folderName = selectedInventoryFolderName || 'Selected folder';

    if (selectedInventoryDirectoryHandle) {
      const hasPermission = await ensureDirectoryPermission(selectedInventoryDirectoryHandle);
      if (!hasPermission) throw new Error('Browser permission is required to read the saved EverQuest root folder.');
      filesToScan = await getInventoryFilesFromDirectory(selectedInventoryDirectoryHandle);
      folderName = selectedInventoryDirectoryHandle.name;
    }

    if (!filesToScan.length) throw new Error('No Character-Inventory*.txt files were found in the selected folder.');
    await scanInventory(filesToScan, folderName);
  } catch (error) {
    inventoryStatus.textContent = error.message;
  } finally {
    scanningInventory = false;
    updateScannerButtons();
  }
}

searchInput.addEventListener('input', renderBots);

body.addEventListener('click', (event) => {
  const button = event.target.closest('.character-detail-button');
  if (!button) return;

  const record = getFilteredBots()[Number(button.dataset.botIndex)];
  openCharacterModal(record);
});

modalCloseButton.addEventListener('click', () => {
  characterModal.close();
});

characterModal.addEventListener('click', (event) => {
  if (event.target === characterModal) characterModal.close();
});

renderClassControls();
loadCurrentUser();
loadSavedScannerState();

timezoneInput.addEventListener('change', () => {
  try {
    const timeZone = getSelectedTimezone();
    logsStatus.textContent = `Log timezone set to ${timeZone}.`;
  } catch (error) {
    logsStatus.textContent = error.message;
  }
});

useLocalTimezoneButton.addEventListener('click', () => {
  timezoneInput.value = localTimezone;
  localStorage.setItem(TIMEZONE_KEY, localTimezone);
  logsStatus.textContent = `Log timezone set to local timezone: ${localTimezone}.`;
});

logsButton.addEventListener('click', async () => {
  if (!supportsDirectoryHandles()) {
    logsPicker.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: 'eqlog-folder',
      mode: 'read',
      startIn: 'documents',
    });

    selectedLogDirectoryHandle = handle;
    selectedLogFolderName = handle.name;
    selectedLogFiles = [];
    await setStoredValue(LOG_FOLDER_KEY, handle);

    const logFiles = await getLogFilesFromDirectory(handle);
    logsStatus.textContent = logFiles.length
      ? `${handle.name}: ${logFiles.length} EQ log file(s) ready. Folder saved on this device.`
      : `${handle.name}: no eqlog_Character_server.txt files found. Folder saved on this device.`;
    if (logFiles.length === 0) selectedLogDirectoryHandle = null;
    if (logFiles.length === 0 && autoScanActive) stopAutoScan('Auto-scan stopped because the selected folder has no EQ log files.');
    updateScannerButtons();
  } catch (error) {
    if (error.name !== 'AbortError') logsStatus.textContent = error.message;
  }
});

logsScanButton.addEventListener('click', scanSelectedLogs);

autoScanButton.addEventListener('click', () => {
  if (autoScanActive) {
    stopAutoScan();
    return;
  }

  startAutoScan();
});

scanIntervalInput.addEventListener('change', () => {
  getIntervalMs();
  if (autoScanActive) startAutoScan();
});

logsPicker.addEventListener('change', async () => {
  const files = Array.from(logsPicker.files || []);
  selectedLogDirectoryHandle = null;
  selectedLogFolderName = getFolderName(files);
  selectedLogFiles = files
    .filter((file) => /^eqlog_.+_.+\.txt$/i.test(file.name))
    .map((file) => ({ file, sourceFile: file.webkitRelativePath || file.name }));

  logsStatus.textContent = selectedLogFiles.length
    ? `${selectedLogFolderName}: ${selectedLogFiles.length} EQ log file(s) ready.`
    : `${selectedLogFolderName || 'Selected folder'}: no eqlog_Character_server.txt files found.`;
  if (selectedLogFiles.length === 0 && autoScanActive) stopAutoScan('Auto-scan stopped because the selected folder has no EQ log files.');
  logsPicker.value = '';
  updateScannerButtons();
});

inventoryButton.addEventListener('click', async () => {
  if (!supportsDirectoryHandles()) {
    inventoryPicker.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: 'eq-inventory-folder',
      mode: 'read',
      startIn: 'documents',
    });

    selectedInventoryDirectoryHandle = handle;
    selectedInventoryFolderName = handle.name;
    selectedInventoryFiles = [];
    await setStoredValue(ROOT_FOLDER_KEY, handle);

    const inventoryFiles = await getInventoryFilesFromDirectory(handle);
    inventoryStatus.textContent = inventoryFiles.length
      ? `${handle.name}: ${inventoryFiles.length} Character-Inventory file(s) ready. Folder saved on this device.`
      : `${handle.name}: no Character-Inventory*.txt files found. Folder saved on this device.`;
    if (inventoryFiles.length === 0) selectedInventoryDirectoryHandle = null;
    updateScannerButtons();
  } catch (error) {
    if (error.name !== 'AbortError') inventoryStatus.textContent = error.message;
  }
});

inventoryScanButton.addEventListener('click', scanSelectedInventory);

inventoryPicker.addEventListener('change', async () => {
  const files = Array.from(inventoryPicker.files || []);
  selectedInventoryDirectoryHandle = null;
  selectedInventoryFolderName = getFolderName(files);
  selectedInventoryFiles = files
    .filter(isInventoryFile)
    .map((file) => ({ file, sourceFile: file.webkitRelativePath || file.name }));

  inventoryStatus.textContent = selectedInventoryFiles.length
    ? `${selectedInventoryFolderName}: ${selectedInventoryFiles.length} Character-Inventory file(s) ready.`
    : `${selectedInventoryFolderName || 'Selected folder'}: no Character-Inventory*.txt files found.`;
  inventoryPicker.value = '';
  updateScannerButtons();
});

filterButtonsContainer.addEventListener('click', (event) => {
  const button = event.target.closest('[data-class]');
  if (!button) return;

  activeClass = button.dataset.class;
  filterButtonsContainer.querySelectorAll('[data-class]').forEach((candidate) => {
    candidate.classList.toggle('active', candidate === button);
  });
  renderBots();
});

loadBots();
