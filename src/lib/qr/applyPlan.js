/**
 * Open a scanned plan envelope and apply it.
 *
 * Shared by the two entry points that can produce a plan: scanning the QR on a
 * printed sheet (/plan), and finishing a pairing that had a plan waiting (/pair).
 *
 * This is only the QR front door. Validation and expansion are the existing,
 * already-tested receiver — `ingestPlan` in the data layer — so a plan that
 * arrives by QR and one pasted into the admin importer travel the same path.
 *
 * Returns a discriminated result rather than throwing, because every failure
 * here is a screen the employee sees, not an exception to surface. Outcomes map
 * one-to-one onto the state table in docs/qr-envelope.md.
 */
import { ingestPlan } from '../queries.js';
import { parsePlanEnvelope, decryptPlanEnvelope, keyIdToHex, EnvelopeError } from './envelope.js';
import { getDeviceKey } from './keystore.js';
import { savePendingPlan, clearPendingPlan } from './pending.js';

/**
 * @returns {Promise<
 *   | { outcome: 'applied', result: object }
 *   | { outcome: 'not_paired', keyIdHex: string }
 *   | { outcome: 'unsupported_version' }
 *   | { outcome: 'decrypt_failed' }
 *   | { outcome: 'invalid', errors?: string[], message?: string }
 * >}
 */
export async function applyPlanEnvelope(encoded) {
  // 1. Split the envelope. Fails here mean the code itself is bad or newer than
  //    this build — nothing to hold on to, so don't record a pending plan.
  let parsed;
  try {
    parsed = parsePlanEnvelope(encoded);
  } catch (err) {
    if (err instanceof EnvelopeError && err.code === 'unsupported_version') {
      return { outcome: 'unsupported_version' };
    }
    return { outcome: 'invalid', message: 'This code could not be read.' };
  }

  // 2. Match it to a key on this device.
  const keyIdHex = keyIdToHex(parsed.keyId);
  let key = null;
  try {
    key = await getDeviceKey(keyIdHex);
  } catch {
    return { outcome: 'invalid', message: 'This device cannot store your plan.' };
  }

  // 3. Not paired, or paired to a different employee — indistinguishable on
  //    purpose, so a stray sheet never reveals whose plan it is. Hold the
  //    ciphertext so pairing later completes without another printout.
  if (!key) {
    savePendingPlan(encoded, keyIdHex);
    return { outcome: 'not_paired', keyIdHex };
  }

  // 4. Decrypt. A failure here is a wrong key or altered bytes.
  let payload;
  try {
    payload = await decryptPlanEnvelope(parsed, key);
  } catch (err) {
    if (err instanceof EnvelopeError && err.code === 'decrypt_failed') {
      return { outcome: 'decrypt_failed' };
    }
    return { outcome: 'invalid', message: 'This plan could not be read.' };
  }

  // 5. Hand off to the existing receiver. Idempotent by plan_id, so a re-scan
  //    updates in place rather than duplicating.
  try {
    const result = await ingestPlan(payload);
    clearPendingPlan();
    return { outcome: 'applied', result };
  } catch (err) {
    if (Array.isArray(err?.errors)) return { outcome: 'invalid', errors: err.errors };
    if (err?.name === 'SchemaVersionError') return { outcome: 'unsupported_version' };
    return { outcome: 'invalid', message: err?.message ?? 'This plan could not be applied.' };
  }
}
