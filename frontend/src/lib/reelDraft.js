// IndexedDB stores the actual video bytes; blob URLs cannot survive a refresh.
// Keep clip bytes separate so typing or timeline edits only rewrite small data.
const DB_NAME = 'bauhly-reel-drafts';
const STORE = 'drafts';
let database;
let pending = Promise.resolve();
const savedFiles = new Map();
const savedEnhancedFiles = new Map();

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Local reel storage is blocked by another tab.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; savedFiles.clear(); savedEnhancedFiles.clear(); };
        resolve(db);
      };
    }).catch((error) => { database = null; throw error; });
  }
  return database;
}

// Serialize reads, saves and resets, including across page unmount/remount.
function enqueue(operation) {
  const next = pending.then(operation);
  pending = next.catch(() => {});
  return next;
}

function transaction(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    tx.oncomplete = () => resolve(result?.());
    tx.onabort = () => reject(tx.error || new Error('Local reel storage was interrupted.'));
    tx.onerror = () => reject(tx.error);
    result = action(tx.objectStore(STORE));
  });
}

export function loadReelDraft(owner) {
  return enqueue(async () => {
    const db = await openDatabase();
    return transaction(db, 'readonly', (store) => {
      const clip = store.get(`${owner}:clip`);
      const enhanced = store.get(`${owner}:enhanced`);
      const draft = store.get(`${owner}:draft`);
      return () => {
        if (!clip.result || !draft.result) return null;
        savedFiles.set(owner, clip.result);
        savedEnhancedFiles.set(owner, enhanced.result);
        return { ...draft.result, file: clip.result, enhancedFile: enhanced.result || null };
      };
    });
  });
}

export function saveReelDraft(owner, { file, enhancedFile = null, ...draft }) {
  return enqueue(async () => {
    const db = await openDatabase();
    await transaction(db, 'readwrite', (store) => {
      if (savedFiles.get(owner) !== file) store.put(file, `${owner}:clip`);
      if (enhancedFile) {
        if (savedEnhancedFiles.get(owner) !== enhancedFile) store.put(enhancedFile, `${owner}:enhanced`);
      } else {
        store.delete(`${owner}:enhanced`);
      }
      store.put(draft, `${owner}:draft`);
    });
    savedFiles.set(owner, file);
    savedEnhancedFiles.set(owner, enhancedFile);
  });
}

export function clearReelDraft(owner) {
  return enqueue(async () => {
    const db = await openDatabase();
    await transaction(db, 'readwrite', (store) => {
      store.delete(`${owner}:clip`);
      store.delete(`${owner}:enhanced`);
      store.delete(`${owner}:draft`);
    });
    savedFiles.delete(owner);
    savedEnhancedFiles.delete(owner);
  });
}
