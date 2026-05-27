const form = document.querySelector('#inventory-form');
const picker = document.querySelector('#inventory-picker');
const chooseButton = document.querySelector('#choose-inventory-folder');
const scanButton = document.querySelector('#scan-inventory-button');
const selectedFolder = document.querySelector('#selected-inventory-folder');
const statusBox = document.querySelector('#inventory-status');
const refreshButton = document.querySelector('#refresh-inventory');
const currentUser = document.querySelector('#current-user');
const inventoryFiles = document.querySelector('#inventory-files');

const counters = {
  files: document.querySelector('#inventory-file-count'),
  rows: document.querySelector('#inventory-row-count'),
  characters: document.querySelector('#inventory-character-count'),
  lastScan: document.querySelector('#inventory-last-scan'),
};

let selectedFiles = [];
let selectedFolderName = '';
let selectedDirectoryHandle = null;
let scanning = false;

function supportsDirectoryPicker() {
  return 'showDirectoryPicker' in window && 'indexedDB' in window;
}

const DB_NAME = 'eqlog-http';
const DB_VERSION = 2;
const STORE_NAME = 'settings';
const ROOT_FOLDER_KEY = 'everquest-root-directory-handle';
const INVENTORY_CACHE_KEY = 'inventory';
const ME_CACHE_KEY = 'me';

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

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
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

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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

async function fetchCachedJson(url, cacheKey, fallbackValue) {
  try {
    const payload = await fetchJson(url);
    await window.EQLogOffline?.setCached(cacheKey, payload);
    return payload;
  } catch (error) {
    const cached = await window.EQLogOffline?.getCached(cacheKey);
    if (cached) {
      setStatus('Offline mode: showing the last saved inventory from this device.');
      return cached;
    }
    if (!navigator.onLine) return fallbackValue;
    throw error;
  }
}

function isNetworkError(error) {
  return !navigator.onLine || error instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(error.message || '');
}

async function loadCurrentUser() {
  const payload = await fetchCachedJson('/api/me', ME_CACHE_KEY, { user: { username: 'Offline' } });
  currentUser.textContent = payload.user?.username || 'Offline';
}

function getFolderName(files) {
  const firstPath = files[0]?.webkitRelativePath || '';
  return firstPath ? firstPath.split('/')[0] : 'Selected folder';
}

function isInventoryFile(file) {
  return /^[^-\\/:]+-Inventory.*\.txt$/i.test(file.name);
}

function inferCharacter(fileName) {
  const baseName = String(fileName || '').split(/[\/]/).pop() || '';
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

function detectDelimiter(line) {
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) return ',';
  return null;
}

function parseInventoryText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);

  if (!delimiter) {
    return {
      headers: ['Line'],
      rows: lines.map((line) => ({ Line: line })),
    };
  }

  const headers = makeUniqueHeaders(parseDelimitedLine(lines[0], delimiter));
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
  });

  return { headers, rows };
}

function updateButtons() {
  scanButton.disabled = scanning || (!selectedDirectoryHandle && selectedFiles.length === 0);
  chooseButton.disabled = scanning;
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

async function ensureDirectoryPermission(directoryHandle) {
  const options = { mode: 'read' };
  if ((await directoryHandle.queryPermission(options)) === 'granted') return true;
  return (await directoryHandle.requestPermission(options)) === 'granted';
}

async function loadSavedDirectoryHandle() {
  if (!supportsDirectoryPicker()) return;

  try {
    const handle = await getStoredValue(ROOT_FOLDER_KEY);
    if (!handle) return;

    selectedDirectoryHandle = handle;
    selectedFolderName = handle.name;
    selectedFiles = [];
    selectedFolder.textContent = `${handle.name}: saved on this device. Click Scan Character-Inventory Files to reuse it.`;
    updateButtons();
    setStatus('Saved EverQuest root folder loaded. Your browser may ask for permission when scanning.');
  } catch (error) {
    setStatus(`Could not load saved root folder permission: ${error.message}`, true);
  }
}

function renderInventory(files) {
  const rowCount = files.reduce((total, file) => total + Number(file.rowCount || file.rows?.length || 0), 0);
  const characters = new Set(files.map((file) => file.character).filter(Boolean));
  const lastScan = files.reduce((latest, file) => {
    const scannedAt = Date.parse(file.scannedAt);
    return Number.isNaN(scannedAt) || scannedAt <= latest ? latest : scannedAt;
  }, 0);

  counters.files.textContent = files.length;
  counters.rows.textContent = rowCount;
  counters.characters.textContent = characters.size;
  counters.lastScan.textContent = lastScan ? formatDate(new Date(lastScan).toISOString()) : '-';

  if (!files.length) {
    inventoryFiles.innerHTML = '<p class="empty">No inventory files saved yet.</p>';
    return;
  }

  inventoryFiles.innerHTML = files.map((file, index) => {
    const headers = file.headers || [];
    const rows = file.rows || [];
    const visibleRows = rows.slice(0, 500);
    const table = headers.length
      ? `<div class="table-wrap inventory-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${visibleRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No rows parsed from this file.</p>';

    const truncated = rows.length > visibleRows.length
      ? `<p class="hint">Showing first ${visibleRows.length} of ${rows.length} rows.</p>`
      : '';

    return `
      <details class="inventory-file" ${index === 0 ? 'open' : ''}>
        <summary>
          <span><strong>${escapeHtml(file.character || 'Unknown character')}</strong> ${escapeHtml(file.fileName)}</span>
          <span>${Number(file.rowCount || rows.length)} rows &middot; ${escapeHtml(formatDate(file.scannedAt))}</span>
        </summary>
        ${table}
        ${truncated}
      </details>
    `;
  }).join('');
}

async function refreshInventory() {
  const payload = await fetchCachedJson('/api/inventory', INVENTORY_CACHE_KEY, { files: [] });
  renderInventory(payload.files || []);
}

async function syncQueuedScans({ silent = false } = {}) {
  if (!navigator.onLine || !window.EQLogOffline) return;

  const queuedItems = await window.EQLogOffline.getQueue();
  if (!queuedItems.length) return;

  try {
    const synced = await window.EQLogOffline.replayQueue();
    const latestInventory = [...synced].reverse().find((result) => result.item.url === '/api/import-inventory-files');
    if (latestInventory?.payload) {
      renderInventory(latestInventory.payload.files || []);
      await window.EQLogOffline.setCached(INVENTORY_CACHE_KEY, { files: latestInventory.payload.files || [] });
    }
    if (!silent) setStatus(`Synced ${synced.length} offline scan request(s) to MongoDB.`);
  } catch (error) {
    if (!silent) setStatus(error.message, true);
  }
}

chooseButton.addEventListener('click', async () => {
  if (!supportsDirectoryPicker()) {
    picker.click();
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: 'eq-inventory-folder',
      mode: 'read',
      startIn: 'documents',
    });

    selectedDirectoryHandle = handle;
    selectedFolderName = handle.name;
    selectedFiles = [];
    await setStoredValue(ROOT_FOLDER_KEY, handle);
    selectedFiles = await getInventoryFilesFromDirectory(handle);

    selectedFolder.textContent = selectedFiles.length
      ? `${selectedFolderName}: ${selectedFiles.length} Character-Inventory file(s) ready. Folder saved on this device.`
      : `${selectedFolderName}: no Character-Inventory*.txt files found. Folder saved on this device.`;

    updateButtons();
    setStatus(selectedFiles.length ? 'Folder selected. Click Scan Character-Inventory Files.' : 'Choose your root EverQuest folder containing Character-Inventory files.', selectedFiles.length === 0);
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message, true);
  }
});

picker.addEventListener('change', () => {
  const files = Array.from(picker.files || []);
  selectedDirectoryHandle = null;
  selectedFolderName = getFolderName(files);
  selectedFiles = files.filter(isInventoryFile).map((file) => ({
    file,
    sourceFile: file.webkitRelativePath || file.name,
  }));

  selectedFolder.textContent = selectedFiles.length
    ? `${selectedFolderName}: ${selectedFiles.length} Character-Inventory file(s) ready. Other files will be ignored.`
    : `${selectedFolderName || 'Selected folder'}: no Character-Inventory*.txt files found.`;

  updateButtons();
  setStatus(selectedFiles.length ? 'Folder selected. Click Scan Character-Inventory Files.' : 'Choose your root EverQuest folder containing Character-Inventory files.', selectedFiles.length === 0);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedDirectoryHandle && !selectedFiles.length) {
    setStatus('Choose inventory files first.', true);
    return;
  }

  scanning = true;
  updateButtons();
  setStatus(`Parsing ${selectedFiles.length} Character-Inventory file(s)...`);

  try {
    if (selectedDirectoryHandle) {
      const hasPermission = await ensureDirectoryPermission(selectedDirectoryHandle);
      if (!hasPermission) throw new Error('Browser permission is required to read the saved EverQuest root folder.');
      selectedFiles = await getInventoryFilesFromDirectory(selectedDirectoryHandle);
      selectedFolderName = selectedDirectoryHandle.name;
    }

    if (!selectedFiles.length) {
      throw new Error('No Character-Inventory*.txt files were found in the selected folder.');
    }

    const files = [];

    for (const item of selectedFiles) {
      const { file, sourceFile } = item;
      const text = await file.text();
      const parsed = parseInventoryText(text);

      files.push({
        fileName: sourceFile,
        character: inferCharacter(file.name),
        headers: parsed.headers,
        rows: parsed.rows,
      });
    }

    const requestBody = { files };
    let result;

    try {
      result = await fetchJson('/api/import-inventory-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      if (!isNetworkError(error) || !window.EQLogOffline) throw error;

      const queuedFiles = files.map((file) => ({
        ...file,
        rowCount: file.rows.length,
        scannedAt: new Date().toISOString(),
        queued: true,
      }));
      await window.EQLogOffline.queueRequest({
        url: '/api/import-inventory-files',
        method: 'POST',
        body: requestBody,
      });
      await window.EQLogOffline.setCached(INVENTORY_CACHE_KEY, { files: queuedFiles });
      renderInventory(queuedFiles);
      setStatus(`Offline mode: parsed ${files.length} Character-Inventory file(s) and queued the upload. It will sync to MongoDB when internet access returns.`);
      return;
    }

    renderInventory(result.files || []);
    await window.EQLogOffline?.setCached(INVENTORY_CACHE_KEY, { files: result.files || [] });
    setStatus(`Scanned ${result.scannedFiles} Character-Inventory file(s). Updated ${result.changed}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    scanning = false;
    updateButtons();
  }
});

refreshButton.addEventListener('click', async () => {
  try {
    await syncQueuedScans({ silent: true });
    await refreshInventory();
    setStatus('Loaded saved inventory files.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

window.addEventListener('online', () => {
  syncQueuedScans();
});

syncQueuedScans({ silent: true }).finally(() => {
  refreshInventory().catch((error) => setStatus(error.message, true));
});

loadCurrentUser().catch((error) => setStatus(error.message, true));
loadSavedDirectoryHandle();
updateButtons();
