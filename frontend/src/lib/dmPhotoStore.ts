/**
 * Rogan Live — DM Photo Store
 *
 * Stores received/sent photo data in the browser's IndexedDB.
 * Photos NEVER leave the device via HTTP — they are relayed P2P over the
 * DM WebSocket and stored here. The server only holds a stub message record
 * (type="photo", content="[Photo]") for ordering and unread counts.
 */

const DB_NAME = 'rogan_dm_photos';
const STORE = 'photos';
const DB_VERSION = 1;

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Persist a data-URL keyed by DM message ID. */
export async function savePhoto(messageId: string, dataUrl: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(dataUrl, messageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a data-URL by message ID. Returns null if not found (e.g. other device). */
export async function getPhoto(messageId: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(messageId);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a photo (e.g. after message is deleted). */
export async function deletePhoto(messageId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(messageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
