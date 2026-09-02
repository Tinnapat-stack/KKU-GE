// Sheet-file layer. Browser storage stays the source of truth; this writes a CSV
// copy to a file the user picks on their machine.
//
// Automatic writing needs the File System Access API, which exists only on desktop
// Chrome and Edge. Everywhere else (Firefox, Safari, all mobile) the download and
// import buttons cover the same need.
//
// Writes are debounced, so a burst of edits costs one write. Because an async write
// cannot be guaranteed to finish while a tab is closing, correctness rests on a
// dirty flag in localStorage rather than on the unload handler: the flag is set
// before a sync is scheduled and cleared only once the write lands, so an
// interrupted write is retried at the next login.

import { getData, markDirty, clearDirty, isDirty } from './storage.js';
import { serializeAccount, parseCSV } from './csv.js';

const DB_NAME = 'psw_filesync';
const STORE = 'handles';
const SYNC_DELAY_MS = 300;

let syncTimer = null;
let statusListener = null;
let activeAccountId = null;
let connected = false; // whether the active account has a usable file handle

export function isSupported() {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function onStatus(fn) {
  statusListener = fn;
}

function emit(status) {
  if (statusListener) statusListener(status);
}

/* ---------- Handle store (IndexedDB, because handles cannot be JSON-serialized) ---------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRun(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      })
  );
}

export async function getStoredHandle(accountId) {
  if (!isSupported()) return null;
  try {
    return (await idbRun('readonly', (store) => store.get(accountId))) || null;
  } catch {
    return null;
  }
}

export async function forgetHandle(accountId) {
  try {
    await idbRun('readwrite', (store) => store.delete(accountId));
  } catch {
    /* nothing to clean up */
  }
}

/* ---------- Permissions ---------- */

// Returns 'granted', 'prompt' or 'denied'.
export async function checkPermission(handle) {
  if (!handle || !handle.queryPermission) return 'denied';
  return handle.queryPermission({ mode: 'readwrite' });
}

// Must be called from a user gesture (click), or the browser rejects it.
export async function requestPermission(handle) {
  if (!handle || !handle.requestPermission) return 'denied';
  return handle.requestPermission({ mode: 'readwrite' });
}

/* ---------- Connect / write ---------- */

const safeFileName = (username) => (username || 'wallet').replace(/[\\/:*?"<>|]/g, '_');

export async function connectFile(accountId, username) {
  if (!isSupported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับการเขียนไฟล์อัตโนมัติ');

  const handle = await window.showSaveFilePicker({
    suggestedName: `p-smart-wallet-${safeFileName(username)}.csv`,
    types: [{ description: 'CSV (Excel / Google Sheets)', accept: { 'text/csv': ['.csv'] } }],
  });

  await idbRun('readwrite', (store) => store.put(handle, accountId));
  connected = true;
  activeAccountId = accountId;
  await writeAccount(accountId, handle);
  return handle;
}

async function writeAccount(accountId, handle) {
  const writable = await handle.createWritable();
  await writable.write(serializeAccount(getData(accountId)));
  await writable.close();
  clearDirty(accountId);
}

// Called after every mutation. Marks the account dirty first so an interrupted
// write is picked up next time the app opens.
export function scheduleSync(accountId) {
  activeAccountId = accountId;
  markDirty(accountId);
  if (!isSupported() || !connected) return;

  emit('syncing');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => flush(accountId), SYNC_DELAY_MS);
}

// Writes straight away, skipping the debounce. Used when the page is being hidden
// and when the user switches wallets or logs out.
export async function flush(accountId = activeAccountId) {
  clearTimeout(syncTimer);
  if (!accountId || !isSupported() || !connected) return;

  try {
    const handle = await getStoredHandle(accountId);
    if (!handle) {
      connected = false;
      emit('off');
      return;
    }
    if ((await checkPermission(handle)) !== 'granted') {
      emit('pending');
      return;
    }
    await writeAccount(accountId, handle);
    emit('synced');
  } catch {
    emit('error');
  }
}

// Called on login and after a wallet switch. Reports the account's file state and
// retries any write an earlier session left unfinished.
export async function refreshConnection(accountId) {
  activeAccountId = accountId;

  if (!isSupported()) {
    connected = false;
    emit('unsupported');
    return 'unsupported';
  }

  const handle = await getStoredHandle(accountId);
  connected = !!handle;
  if (!handle) {
    emit('off');
    return 'off';
  }

  if ((await checkPermission(handle)) !== 'granted') {
    emit('pending');
    return 'pending';
  }

  if (isDirty(accountId)) {
    await flush(accountId);
  } else {
    emit('synced');
  }
  return 'granted';
}

// visibilitychange is the reliable lifecycle hook. beforeunload never fires on
// mobile Safari and often not on Android Chrome.
export function installLifecycleHooks() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', () => flush());
}

/* ---------- Fallback: download and import ---------- */

export function downloadCSV(accountId, username) {
  const blob = new Blob([serializeAccount(getData(accountId))], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `p-smart-wallet-${safeFileName(username)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  clearDirty(accountId);
}

// Opens a file picker and returns the parsed contents, or null if cancelled.
export function pickAndParseCSV() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(parseCSV(await file.text()));
      } catch (err) {
        reject(err);
      }
    });
    input.click();
  });
}
