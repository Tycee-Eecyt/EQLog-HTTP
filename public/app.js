const form = document.querySelector('#scan-form');
const folderPicker = document.querySelector('#folder-picker');
const chooseFolderButton = document.querySelector('#choose-folder-button');
const scanButton = document.querySelector('#scan-button');
const autoScanButton = document.querySelector('#auto-scan-button');
const scanIntervalInput = document.querySelector('#scan-interval');
const timezoneInput = document.querySelector('#timezone-input');
const useLocalTimezoneButton = document.querySelector('#use-local-timezone');
const selectedFolder = document.querySelector('#selected-folder');
const refreshButton = document.querySelector('#refresh-button');
const filterButtons = Array.from(document.querySelectorAll('.filter-button'));
const statusBox = document.querySelector('#status');
const body = document.querySelector('#locations-body');
const details = document.querySelector('#scan-details');
const currentUser = document.querySelector('#current-user');

const counters = {
  scannedFiles: document.querySelector('#scanned-files'),
  changed: document.querySelector('#changed-count'),
  unchanged: document.querySelector('#unchanged-count'),
  records: document.querySelector('#record-count'),
};

const MONTHS = new Map([
  ['Jan', 0], ['Feb', 1], ['Mar', 2], ['Apr', 3], ['May', 4], ['Jun', 5],
  ['Jul', 6], ['Aug', 7], ['Sep', 8], ['Oct', 9], ['Nov', 10], ['Dec', 11],
]);

const DB_NAME = 'eqlog-http';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const LOG_FOLDER_KEY = 'logs-directory-handle';
const TIMEZONE_KEY = 'eqlog-timezone';
const AUTO_SCAN_KEY = 'eqlog-auto-scan-enabled';
const SCAN_INTERVAL_KEY = 'eqlog-scan-interval-minutes';
const FAVORITES_KEY = 'eqlog-favorite-characters';

let selectedFiles = [];
let selectedFolderName = '';
let selectedDirectoryHandle = null;
let savedRecords = [];
let activeFilter = 'all';
let favoriteCharacters = loadFavoriteCharacters();
let autoScanTimer = null;
let autoScanActive = false;
let scanInProgress = false;

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
timezoneInput.value = localStorage.getItem(TIMEZONE_KEY) || localTimezone;
scanIntervalInput.value = localStorage.getItem(SCAN_INTERVAL_KEY) || scanIntervalInput.value;

function supportsDirectoryHandles() {
  return 'showDirectoryPicker' in window && 'indexedDB' in window;
}

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
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

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
}

function notifyTimezoneMismatch() {
  const selectedTimezone = timezoneInput.value.trim() || localTimezone;
  if (selectedTimezone === localTimezone) return false;

  setStatus(`Timezone alert: log timezone is set to ${selectedTimezone}, but this device is using ${localTimezone}.`, true);
  return true;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function characterFavoriteKey(record) {
  return `${String(record.server || '').trim().toLowerCase()}::${String(record.character || '').trim().toLowerCase()}`;
}

function loadFavoriteCharacters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteCharacters() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favoriteCharacters).sort()));
}

function isFavorite(record) {
  return favoriteCharacters.has(characterFavoriteKey(record));
}

function setFavorite(record, enabled) {
  const key = characterFavoriteKey(record);
  if (enabled) {
    favoriteCharacters.add(key);
  } else {
    favoriteCharacters.delete(key);
  }
  saveFavoriteCharacters();
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

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timeZone}. Use an IANA timezone like America/New_York.`);
  }

  localStorage.setItem(TIMEZONE_KEY, timeZone);
  return timeZone;
}

function parseEqTimestamp(line, timeZone) {
  const match = line.match(/^\[(\w{3}) (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/);
  if (!match) return null;

  const [, , monthName, day, hour, minute, second, year] = match;
  const month = MONTHS.get(monthName);
  if (month === undefined) return null;

  const date = zonedTimeToUtc(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    timeZone,
  );

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

function isBot(record) {
  return Boolean(record.isBot) || /^safe/i.test(record.character || '');
}

function getFilteredRecords() {
  if (activeFilter === 'favorites') return savedRecords.filter(isFavorite);
  if (activeFilter === 'bots') return savedRecords.filter(isBot);
  if (activeFilter === 'mine') return savedRecords.filter((record) => !isBot(record));
  return savedRecords;
}

function renderRecords(records = savedRecords) {
  savedRecords = records;
  const filteredRecords = getFilteredRecords();
  counters.records.textContent = filteredRecords.length;

  if (!savedRecords.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No saved locations yet.</td></tr>';
    return;
  }

  if (!filteredRecords.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">${activeFilter === 'favorites' ? 'No favorite characters selected yet.' : 'No characters match this filter.'}</td></tr>`;
    return;
  }

  body.innerHTML = filteredRecords.map((record) => {
    const favorite = isFavorite(record);
    return `
    <tr>
      <td>
        <span class="character-cell">
          <button
            type="button"
            class="favorite-button ${favorite ? 'active' : ''}"
            data-favorite-key="${escapeHtml(characterFavoriteKey(record))}"
            aria-pressed="${favorite ? 'true' : 'false'}"
            title="${favorite ? 'Remove from favorites' : 'Add to favorites'}"
          >${favorite ? 'Favorited' : '+ Favorite'}</button>
          <strong>${escapeHtml(record.character)}</strong>
          ${isBot(record) ? '<span class="bot-badge">Bot</span>' : ''}
          ${record.visibility === 'public' ? '<span class="public-badge">Public</span>' : ''}
        </span>
      </td>
      <td>${escapeHtml(record.server)}</td>
      <td>${escapeHtml(record.zone)}</td>
      <td>${escapeHtml(formatDate(record.enteredAt))}</td>
      <td>${escapeHtml(record.sourceFile)}${record.timeZone ? `<br><small>${escapeHtml(record.timeZone)}</small>` : ''}</td>
    </tr>
  `;
  }).join('');
}

function applyScanSummary(scan) {
  counters.scannedFiles.textContent = scan.scannedFiles ?? 0;
  counters.changed.textContent = scan.changed ?? 0;
  counters.unchanged.textContent = scan.unchanged ?? 0;
  renderRecords(scan.records || []);
  details.textContent = JSON.stringify(scan, null, 2);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Authentication required.');
  }
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload;
}

async function loadCurrentUser() {
  const payload = await fetchJson('/api/me');
  currentUser.textContent = payload.user?.username || 'Unknown';
}

async function refreshLocations() {
  const payload = await fetchJson('/api/locations');
  renderRecords(payload.records || []);
}

function handleLine(line, currentLatest, timeZone) {
  const zone = parseZoneEntry(line);
  if (!zone) return currentLatest;

  const timestamp = parseEqTimestamp(line, timeZone);
  if (!timestamp) return currentLatest;

  if (!currentLatest || timestamp.date.getTime() > currentLatest.enteredAtMs) {
    return {
      zone,
      enteredAt: timestamp.date.toISOString(),
      enteredAtMs: timestamp.date.getTime(),
      enteredAtRaw: timestamp.raw,
      timeZone: timestamp.timeZone,
      sourceLine: line,
    };
  }

  return currentLatest;
}

async function findLatestZoneEntry(file, timeZone) {
  if (!file.stream) {
    const text = await file.text();
    return text.split(/\r?\n/).reduce((latest, line) => handleLine(line, latest, timeZone), null);
  }

  const decoder = new TextDecoder();
  const reader = file.stream().getReader();
  let latest = null;
  let buffered = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';

    for (const line of lines) {
      latest = handleLine(line, latest, timeZone);
    }
  }

  buffered += decoder.decode();
  if (buffered) latest = handleLine(buffered, latest, timeZone);
  return latest;
}

function getFolderName(files) {
  const firstPath = files[0]?.webkitRelativePath || '';
  return firstPath ? firstPath.split('/')[0] : 'Selected Logs folder';
}

function hasScannableSelection() {
  return Boolean(selectedDirectoryHandle) || selectedFiles.length > 0;
}

function updateScanButtons() {
  const canScan = hasScannableSelection() && !scanInProgress;
  scanButton.disabled = !canScan;
  autoScanButton.disabled = !hasScannableSelection();
  autoScanButton.textContent = autoScanActive ? 'Stop Auto-Scan' : 'Start Auto-Scan';
}

function getIntervalMs() {
  const minutes = Math.min(60, Math.max(1, Number(scanIntervalInput.value || 5)));
  scanIntervalInput.value = String(minutes);
  localStorage.setItem(SCAN_INTERVAL_KEY, String(minutes));
  return minutes * 60 * 1000;
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

async function ensureDirectoryPermission(directoryHandle) {
  const options = { mode: 'read' };
  if ((await directoryHandle.queryPermission(options)) === 'granted') return true;
  return (await directoryHandle.requestPermission(options)) === 'granted';
}

async function loadSavedDirectoryHandle() {
  if (!supportsDirectoryHandles()) return;

  try {
    const handle = await getStoredValue(LOG_FOLDER_KEY);
    if (!handle) return;

    selectedDirectoryHandle = handle;
    selectedFolderName = handle.name;
    selectedFolder.textContent = `${handle.name}: saved on this device. Click Scan Selected Files to reuse it.`;
    updateScanButtons();
    if (!notifyTimezoneMismatch()) {
      setStatus('Saved Logs folder loaded. Your browser may ask for permission when scanning.');
    }
  } catch (error) {
    setStatus(`Could not load saved folder permission: ${error.message}`, true);
  }
}

chooseFolderButton.addEventListener('click', async () => {
  if (!supportsDirectoryHandles()) {
    folderPicker.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: 'eqlog-folder',
      mode: 'read',
      startIn: 'documents',
    });

    selectedDirectoryHandle = handle;
    selectedFolderName = handle.name;
    selectedFiles = [];
    await setStoredValue(LOG_FOLDER_KEY, handle);

    const logFiles = await getLogFilesFromDirectory(handle);
    selectedFolder.textContent = logFiles.length
      ? `${handle.name}: ${logFiles.length} EQ log file(s) ready. Folder saved on this device.`
      : `${handle.name}: no eqlog_Character_server.txt files found. Folder saved on this device.`;
    if (logFiles.length === 0) selectedDirectoryHandle = null;
    updateScanButtons();
    setStatus(logFiles.length ? 'Folder selected and saved. Click Scan Selected Files.' : 'Choose a folder containing EverQuest log files.', logFiles.length === 0);
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message, true);
  }
});

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter || 'all';
    filterButtons.forEach((candidate) => {
      candidate.classList.toggle('active', candidate === button);
    });
    renderRecords();
  });
});

body.addEventListener('click', (event) => {
  const button = event.target.closest('.favorite-button');
  if (!button) return;

  const key = button.dataset.favoriteKey;
  const record = savedRecords.find((candidate) => characterFavoriteKey(candidate) === key);
  if (!record) return;

  const nextFavoriteState = !isFavorite(record);
  setFavorite(record, nextFavoriteState);
  renderRecords();
  setStatus(`${record.character} ${nextFavoriteState ? 'added to' : 'removed from'} favorites.`);
});

folderPicker.addEventListener('change', () => {
  const files = Array.from(folderPicker.files || []);
  selectedDirectoryHandle = null;
  selectedFolderName = getFolderName(files);
  selectedFiles = files.filter((file) => /^eqlog_.+_.+\.txt$/i.test(file.name));

  selectedFolder.textContent = selectedFiles.length
    ? `${selectedFolderName}: ${selectedFiles.length} EQ log file(s) ready.`
    : `${selectedFolderName || 'Selected folder'}: no eqlog_Character_server.txt files found.`;

  updateScanButtons();
  setStatus(selectedFiles.length ? 'Folder selected. Click Scan Selected Files.' : 'Choose a folder containing EverQuest log files.', selectedFiles.length === 0);
});

async function runScan({ automatic = false } = {}) {
  if (!selectedDirectoryHandle && !selectedFiles.length) {
    setStatus('Choose your EverQuest Logs folder first.', true);
    return;
  }

  if (scanInProgress) return;

  scanInProgress = true;
  updateScanButtons();
  chooseFolderButton.disabled = true;
  setStatus(automatic ? 'Auto-scan running...' : 'Scanning selected log file(s)...');

  const entries = [];
  const errors = [];
  let withoutZoneEntry = 0;

  try {
    const timeZone = getSelectedTimezone();
    let filesToScan = selectedFiles.map((file) => ({
      file,
      sourceFile: file.webkitRelativePath || file.name,
    }));

    if (selectedDirectoryHandle) {
      const hasPermission = await ensureDirectoryPermission(selectedDirectoryHandle);
      if (!hasPermission) throw new Error('Browser permission is required to read the saved Logs folder.');
      filesToScan = await getLogFilesFromDirectory(selectedDirectoryHandle);
      selectedFolderName = selectedDirectoryHandle.name;
    }

    setStatus(`Scanning ${filesToScan.length} selected log file(s)...`);

    for (const item of filesToScan) {
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

    const scan = await fetchJson('/api/import-zone-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        folderName: selectedFolderName,
        scannedFiles: filesToScan.length,
        withoutZoneEntry,
        errors,
        entries,
      }),
    });

    applyScanSummary(scan);
    const suffix = scan.errors?.length ? ` ${scan.errors.length} file error(s); see scan details.` : '';
    const prefix = automatic ? 'Auto-scan complete.' : 'Scan complete.';
    setStatus(`${prefix} Scanned ${scan.scannedFiles} selected log file(s). Updated ${scan.changed}; kept ${scan.unchanged} because saved times were newer.${suffix}`, Boolean(scan.errors?.length));
  } catch (error) {
    setStatus(error.message, true);
    if (automatic) stopAutoScan(`Auto-scan stopped: ${error.message}`);
  } finally {
    scanInProgress = false;
    updateScanButtons();
    chooseFolderButton.disabled = false;
  }
}

function stopAutoScan(message = 'Auto-scan stopped.') {
  if (autoScanTimer) clearInterval(autoScanTimer);
  autoScanTimer = null;
  autoScanActive = false;
  localStorage.setItem(AUTO_SCAN_KEY, 'false');
  updateScanButtons();
  setStatus(message);
}

function startAutoScan() {
  if (!hasScannableSelection()) {
    setStatus('Choose your EverQuest Logs folder before starting auto-scan.', true);
    return;
  }

  if (autoScanTimer) clearInterval(autoScanTimer);
  autoScanActive = true;
  localStorage.setItem(AUTO_SCAN_KEY, 'true');
  autoScanTimer = setInterval(() => {
    runScan({ automatic: true });
  }, getIntervalMs());
  updateScanButtons();
  setStatus(`Auto-scan started. It will run every ${scanIntervalInput.value} minute(s) while this page stays open.`);
  runScan({ automatic: true });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runScan();
});

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

timezoneInput.addEventListener('change', () => {
  try {
    getSelectedTimezone();
    if (!notifyTimezoneMismatch()) {
      setStatus(`Log timezone set to ${timezoneInput.value.trim()}.`);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

useLocalTimezoneButton.addEventListener('click', () => {
  timezoneInput.value = localTimezone;
  localStorage.setItem(TIMEZONE_KEY, localTimezone);
  setStatus(`Log timezone set to local timezone: ${localTimezone}.`);
});

refreshButton.addEventListener('click', async () => {
  try {
    await refreshLocations();
    setStatus('Loaded saved parked locations.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

async function initialize() {
  await Promise.all([
    loadCurrentUser().catch((error) => setStatus(error.message, true)),
    refreshLocations().catch((error) => setStatus(error.message, true)),
    loadSavedDirectoryHandle(),
  ]);

  getIntervalMs();

  if (localStorage.getItem(AUTO_SCAN_KEY) === 'true' && hasScannableSelection()) {
    startAutoScan();
    return;
  }

  notifyTimezoneMismatch();
}

initialize();
