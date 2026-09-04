/**
 * Open the progress reports pasted into the admin's return box.
 *
 * This is the receiving end of the estate's second air gap. An employee's phone
 * has no route to this machine — no cloud, by design — so a report travels as an
 * encrypted block inside an email the employee sends, and the admin pastes that
 * email in here.
 *
 * WHY IT IS A LIBRARY AND NOT PAGE CODE. Every hard case lives in the parsing,
 * not the rendering: a reply chain repeating the same block, a forwarded mail
 * with two people's reports in it, a truncated paste, a report from a plan this
 * machine never issued. Those are all testable, and none of them are testable
 * through a React component.
 *
 * WHAT IT WILL NOT DO. It never throws for one bad block. A paste can legitimately
 * carry several reports and one being unreadable must not discard the others —
 * the admin would have no way to tell which, and would re-ask every employee.
 * Each block comes back with its own outcome instead.
 */
import { importPlanKey, fromBase64Url } from '../qr/envelope.js';
import { extractReturnEnvelopes, openReturnEnvelope, returnKeyId } from './returnEnvelope.js';

/** Outcomes for a single pasted block. */
export const RETURN_OUTCOME = {
  OPENED: 'opened',
  UNKNOWN_KEY: 'unknown_key',
  UNREADABLE: 'unreadable',
  NOT_A_RETURN: 'not_a_return',
  MALFORMED: 'malformed',
};

/**
 * @param {string} text  the pasted email, headers and quoting included
 * @param {object} deps  data-layer functions, injected so this stays testable
 */
export async function openPastedReturns(text, { fetchIssuedPlanKey, bindRecognitionKey } = {}) {
  const blocks = extractReturnEnvelopes(text);
  const results = [];

  for (const block of blocks) {
    results.push(await openOne(block, { fetchIssuedPlanKey, bindRecognitionKey }));
  }

  return {
    found: blocks.length,
    results,
    opened: results.filter((r) => r.outcome === RETURN_OUTCOME.OPENED),
  };
}

async function openOne(envelope, { fetchIssuedPlanKey, bindRecognitionKey }) {
  let keyId;
  try {
    keyId = returnKeyId(envelope);
  } catch (err) {
    // The block is not a well-formed envelope at all. Distinct from "we cannot
    // decrypt it": there is nothing here to look a key up by.
    return { outcome: RETURN_OUTCOME.MALFORMED, envelope, error: err.message };
  }

  const issued = await fetchIssuedPlanKey(keyId);
  if (!issued) {
    /* Actionable, and a different problem from a decryption failure. This
     * machine never issued that plan -- most likely it was issued from the other
     * machine, or from a browser profile that has since been cleared. Saying
     * "unreadable" here would send the admin looking for a corrupted email. */
    return { outcome: RETURN_OUTCOME.UNKNOWN_KEY, keyId, envelope };
  }

  let payload;
  try {
    const key = await importPlanKey(fromBase64Url(issued.keyB64));
    payload = await openReturnEnvelope(envelope, key);
  } catch (err) {
    if (err.name === 'ReturnValidationError' || err.name === 'ReturnVersionError') {
      /* It decrypted, so the key is right and this really is from that employee
       * -- but the contents are not a return we understand. Almost always a
       * version skew between the phone's app and this one. */
      return {
        outcome: RETURN_OUTCOME.NOT_A_RETURN,
        keyId,
        issued,
        error: err.message,
        errors: err.errors,
      };
    }
    return { outcome: RETURN_OUTCOME.UNREADABLE, keyId, issued, error: err.message };
  }

  /* Bind the recognition key on the way past.
   *
   * The first return is matched by keyId, because the admin knows who it issued
   * that key to. Binding here is what lets every later return match on the
   * recognition key directly, which is what survives a re-assessment minting a
   * new plan key. A reinstall mints a new recognition key and re-links on the
   * next return -- self-healing, one send late. */
  let record = issued;
  if (payload.recognition_key && typeof bindRecognitionKey === 'function') {
    record = (await bindRecognitionKey({
      keyId,
      recognitionKey: payload.recognition_key,
    })) ?? issued;
  }

  return { outcome: RETURN_OUTCOME.OPENED, keyId, issued: record, payload };
}

/**
 * A short human summary of one report, for the admin's list.
 *
 * Counts rather than contents: the point of the paste box is to tell the admin
 * whether a report arrived and roughly what is in it, not to be a review screen.
 * Pain is surfaced separately because it is the one thing that should not wait.
 */
export function summariseReturn(payload) {
  if (!payload) return null;
  return {
    planId: payload.plan_id ?? null,
    generatedAt: payload.generated_at ?? null,
    completions: payload.completions?.length ?? 0,
    pain: payload.pain?.length ?? 0,
    feedback: payload.feedback?.length ?? 0,
  };
}
