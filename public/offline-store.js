(function () {
  const DB_NAME = 'eqlog-http';
  const DB_VERSION = 2;
  const SETTINGS_STORE = 'settings';
  const QUEUE_STORE = 'syncQueue';
  const CACHE_STORE = 'cachedApi';

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
        if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { autoIncrement: true });
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function read(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function write(storeName, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const request = transaction.objectStore(storeName).put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function remove(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const request = transaction.objectStore(storeName).delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function readAllQueueItems() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(QUEUE_STORE, 'readonly');
      const request = transaction.objectStore(QUEUE_STORE).openCursor();
      const items = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(items);
          return;
        }

        items.push({ id: cursor.key, ...cursor.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function addQueueItem(item) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(QUEUE_STORE, 'readwrite');
      const request = transaction.objectStore(QUEUE_STORE).add({
        ...item,
        createdAt: new Date().toISOString(),
      });

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function replayQueue() {
    const items = await readAllQueueItems();
    const synced = [];

    for (const item of items) {
      const response = await fetch(item.url, {
        method: item.method || 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 401) {
        const error = new Error('Sign in again to sync offline scans.');
        error.statusCode = 401;
        throw error;
      }

      if (!response.ok) throw new Error(payload.error || `Sync failed with HTTP ${response.status}`);

      await remove(QUEUE_STORE, item.id);
      synced.push({ item, payload });
    }

    return synced;
  }

  window.EQLogOffline = {
    getSetting: (key) => read(SETTINGS_STORE, key),
    setSetting: (key, value) => write(SETTINGS_STORE, key, value),
    getCached: (key) => read(CACHE_STORE, key),
    setCached: (key, value) => write(CACHE_STORE, key, value),
    queueRequest: addQueueItem,
    getQueue: readAllQueueItems,
    replayQueue,
  };
}());
