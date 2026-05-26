const form = document.querySelector('#scan-form');
const folderPicker = document.querySelector('#folder-picker');
const chooseFolderButton = document.querySelector('#choose-folder-button');
const scanButton = document.querySelector('#scan-button');
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

let selectedFiles = [];
let selectedFolderName = '';
let selectedDirectoryHandle = null;
let savedRecords = [];
let activeFilter = 'all';

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

function parseLogFilename(fileName) {
  const match = fileName.match(/^eqlog_([^_]+)_(.+)\.txt$/i);
  if (!match) return null;
  return { character: match[1], server: match[2] };
}

function parseEqTimestamp(line) {
  const match = line.match(/^\[(\w{3}) (\w{3})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/);
  if (!match) return null;

  const [, , monthName, day, hour, minute, second, year] = match;
  const month = MONTHS.get(monthName);
  if (month === undefined) return null;

  const date = new Date(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function parseZoneEntry(line) {
  const match = line.match(/\] You have entered (.+?)\.$/);
  return match ? match[1].trim() : null;
}

function isBot(record) {
  return /^safe/i.test(record.character || '');
}

function getFilteredRecords() {
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
    body.innerHTML = '<tr><td colspan="5" class="empty">No characters match this filter.</td></tr>';
    return;
  }

  body.innerHTML = filteredRecords.map((record) => `
    <tr>
      <td>
        <span class="character-cell">
          <strong>${escapeHtml(record.character)}</strong>
          ${isBot(record) ? '<span class="bot-badge">Bot</span>' : ''}
        </span>
      </td>
      <td>${escapeHtml(record.server)}</td>
      <td>${escapeHtml(record.zone)}</td>
      <td>${escapeHtml(formatDate(record.enteredAt))}</td>
      <td>${escapeHtml(record.sourceFile)}</td>
    </tr>
  `).join('');
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

function handleLine(line, currentLatest) {
  const zone = parseZoneEntry(line);
  if (!zone) return currentLatest;

  const enteredAt = parseEqTimestamp(line);
  if (!enteredAt) return currentLatest;

  if (!currentLatest || enteredAt.getTime() > currentLatest.enteredAtMs) {
    return {
      zone,
      enteredAt: enteredAt.toISOString(),
      enteredAtMs: enteredAt.getTime(),
      sourceLine: line,
    };
  }

  return currentLatest;
}

async function findLatestZoneEntry(file) {
  if (!file.stream) {
    const text = await file.text();
    return text.split(/\r?\n/).reduce((latest, line) => handleLine(line, latest), null);
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
      latest = handleLine(line, latest);
    }
  }

  buffered += decoder.decode();
  if (buffered) latest = handleLine(buffered, latest);
  return latest;
}

function getFolderName(files) {
  const firstPath = files[0]?.webkitRelativePath || '';
  return firstPath ? firstPath.split('/')[0] : 'Selected Logs folder';
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
    scanButton.disabled = false;
    setStatus('Saved Logs folder loaded. Your browser may ask for permission when scanning.');
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
    scanButton.disabled = logFiles.length === 0;
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

folderPicker.addEventListener('change', () => {
  const files = Array.from(folderPicker.files || []);
  selectedDirectoryHandle = null;
  selectedFolderName = getFolderName(files);
  selectedFiles = files.filter((file) => /^eqlog_.+_.+\.txt$/i.test(file.name));

  selectedFolder.textContent = selectedFiles.length
    ? `${selectedFolderName}: ${selectedFiles.length} EQ log file(s) ready.`
    : `${selectedFolderName || 'Selected folder'}: no eqlog_Character_server.txt files found.`;

  scanButton.disabled = selectedFiles.length === 0;
  setStatus(selectedFiles.length ? 'Folder selected. Click Scan Selected Files.' : 'Choose a folder containing EverQuest log files.', selectedFiles.length === 0);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedDirectoryHandle && !selectedFiles.length) {
    setStatus('Choose your EverQuest Logs folder first.', true);
    return;
  }

  scanButton.disabled = true;
  chooseFolderButton.disabled = true;
  setStatus('Scanning selected log file(s)...');

  const entries = [];
  const errors = [];
  let withoutZoneEntry = 0;

  try {
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
        const latest = await findLatestZoneEntry(file);
        if (!latest) {
          withoutZoneEntry += 1;
          continue;
        }

        entries.push({
          character: identity.character,
          server: identity.server,
          zone: latest.zone,
          enteredAt: latest.enteredAt,
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
    setStatus(`Scanned ${scan.scannedFiles} selected log file(s). Updated ${scan.changed}; kept ${scan.unchanged} because saved times were newer.${suffix}`, Boolean(scan.errors?.length));
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    scanButton.disabled = !selectedDirectoryHandle && selectedFiles.length === 0;
    chooseFolderButton.disabled = false;
  }
});

refreshButton.addEventListener('click', async () => {
  try {
    await refreshLocations();
    setStatus('Loaded saved parked locations.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

loadCurrentUser().catch((error) => setStatus(error.message, true));
refreshLocations().catch((error) => setStatus(error.message, true));
loadSavedDirectoryHandle();
