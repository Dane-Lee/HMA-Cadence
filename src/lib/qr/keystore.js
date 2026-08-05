/**
 * Device key store — IndexedDB, non-extractable keys.
 *
 * A paired device holds the AES key its plans are encrypted to. It lives in
 * IndexedDB rather than localStorage for one reason: IndexedDB can hold a real
 * `CryptoKey` object, and a key imported with extractable=false can never be
 * read back as bytes by any script on the device. localStorage can only hold
 * strings, which would mean storing the raw key in a form any injected script
 * could lift.
 *
 * Records are keyed by keyId hex so an incoming envelope can be matched to a key
 * without trial decryption. Normally there is exactly one record — a phone
 * belongs to one employee — but the store is a map so re-pairing after a key
 * rotation doesn't strand plans encrypted to the previous key.
 */
import { importPlanKey, keyIdFor, keyIdToHex, KEY_BYTES, EnvelopeError } from './envelope.js';

const DB_NAME = 'hma-cadence-keys';
const DB_VERSION = 1;
const STORE = 'planKeys';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'keyIdHex' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Import raw key bytes and persist them. Returns the keyId hex so the caller can
 * show it — that string is what an admin compares against the Tracker record to
 * confirm a device paired to the right employee.
 */
export async function storeDeviceKey(rawKey) {
  if (!(rawKey instanceof Uint8Array) || rawKey.length !== KEY_BYTES) {
    throw new EnvelopeError('malformed', `Pairing code must carry ${KEY_BYTES} key bytes.`);
  }
  const key = await importPlanKey(rawKey, { extractable: false });
  const keyIdHex = keyIdToHex(await keyIdFor(rawKey));

  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) =>
      store.put({ keyIdHex, key, pairedAt: new Date().toISOString() }),
    );
  } finally {
    db.close();
  }
  return keyIdHex;
}

/** The CryptoKey matching an envelope's keyId, or null if this device has none. */
export async function getDeviceKey(keyIdHex) {
  const db = await openDb();
  try {
    const rec = await tx(db, 'readonly', (store) => store.get(keyIdHex));
    return rec?.key ?? null;
  } finally {
    db.close();
  }
}

/** True once this device has been paired at least once. Drives the "see your EIS rep" screen. */
export async function hasAnyDeviceKey() {
  const db = await openDb();
  try {
    const count = await tx(db, 'readonly', (store) => store.count());
    return count > 0;
  } finally {
    db.close();
  }
}

/** Unpair this device. Any plan already applied stays; future scans won't open. */
export async function clearDeviceKeys() {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => store.clear());
  } finally {
    db.close();
  }
}
