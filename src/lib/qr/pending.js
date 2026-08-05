/**
 * Pending plan — a scanned plan this device cannot open yet.
 *
 * The pivot of the QR design: an employee gets their printed sheet and scans it
 * before they have ever been paired. Rather than telling them to come back with
 * the paper, Cadence keeps the envelope and applies it the moment a key arrives.
 * That is what lets pairing happen days or weeks later without a reprint.
 *
 * What is stored is the base64url envelope — ciphertext. Without the key it is
 * meaningless, so localStorage is an appropriate home for it (unlike the key
 * itself, which lives non-extractably in IndexedDB — see keystore.js).
 */

const STORAGE_KEY = 'hma-cadence:pending-plan';

export function savePendingPlan(encoded, keyIdHex) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ encoded, keyIdHex, savedAt: new Date().toISOString() }),
    );
  } catch {
    // A full or disabled store just means the employee re-scans after pairing.
  }
}

export function readPendingPlan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingPlan() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
