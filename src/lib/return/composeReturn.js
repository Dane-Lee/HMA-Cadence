/**
 * Turning what the phone holds into an email the employee can send.
 *
 * Sits between the data adapter (which supplies events) and `returnEnvelope.js`
 * (which encrypts and formats). Everything here is pure: given events and an
 * identity, it produces a payload, an envelope, a body and a `mailto:` URL.
 * Opening that URL is the caller's job, so this stays testable in Node.
 */
import { buildReturnEnvelope, formatReturnEmail, generateRecognitionKey } from './returnEnvelope.js';

/**
 * Where reports are sent.
 *
 * **This is a placeholder, and the plan says it should not be.**
 * `PIPELINE-WORKFLOW-PLAN.md` §4.2 has the address "embedded in the client app
 * from the original plan QR" — but plan payload contract v1 carries no such
 * field, so there is nowhere for it to arrive from yet. Adding one is a change
 * to a contract the Tracker also builds against, so it is not made here.
 *
 * Until then the address is passed in by the caller, and this is the fallback.
 * Callers that have a real address should always pass it.
 */
export const DEFAULT_RETURN_ADDRESS = '';

/** Deduplicate events so a repeated day does not inflate the payload. */
function dedupe(events, keyOf) {
  const seen = new Set();
  const out = [];
  for (const event of events ?? []) {
    const key = keyOf(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

/**
 * Events + identity → a return payload ready to encrypt.
 *
 * Deduplicated and date-ordered. Both matter more than they look: the payload
 * is cumulative and resent every week, so the same completion is collected
 * again on every send, and DEFLATE compresses a sorted, repetitive list far
 * better than an arbitrarily ordered one.
 *
 * Empty event lists are omitted rather than sent as `[]` — the contract wants
 * at least one kind present, and an absent key costs fewer bytes than an empty
 * array on a payload that is sent weekly forever.
 */
export function toReturnPayload({ recognitionKey, planId, events, generatedAt } = {}) {
  const completions = dedupe(events?.completions, (e) => `${e.e}|${e.d}`).sort(byDate);
  // One pain report per exercise per day; two taps on a sore shoulder in one
  // session are one fact, not two.
  const pain = dedupe(events?.pain, (e) => `${e.e}|${e.d}|${e.c}`).sort(byDate);
  // Feedback is a standing rating, so the newest per exercise is the only one
  // that means anything.
  const feedback = dedupe([...(events?.feedback ?? [])].sort(byDate).reverse(), (e) => e.e).sort(byDate);

  const payload = {
    recognition_key: recognitionKey,
    generated_at: generatedAt ?? new Date().toISOString(),
  };
  if (planId) payload.plan_id = planId;
  if (completions.length) payload.completions = completions;
  if (pain.length) payload.pain = pain;
  if (feedback.length) payload.feedback = feedback;
  return payload;
}

/** True when there is nothing worth sending yet. */
export function hasNothingToSend(payload) {
  return !payload.completions && !payload.pain && !payload.feedback;
}

/**
 * Build the whole hand-off: encrypted envelope, readable body, and the
 * `mailto:` URL that opens the employee's mail client with it all filled in.
 *
 * The payload rides in the body rather than an attachment deliberately — a
 * `mailto:` cannot attach a file, and asking an employee to save and attach one
 * is where this channel would quietly stop being used.
 */
export async function composeReturnEmail({
  payload,
  key,
  keyId,
  iv,
  to = DEFAULT_RETURN_ADDRESS,
  subject = 'HMA Cadence progress report',
  note,
} = {}) {
  const envelope = await buildReturnEnvelope(payload, { key, keyId, iv });
  const body = formatReturnEmail(envelope, { note });
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    envelope,
    body,
    subject,
    to,
    mailtoUrl: `mailto:${encodeURIComponent(to)}?${query}`,
  };
}

/**
 * Read the device's recognition key, minting and persisting one the first time.
 *
 * **A deliberate divergence from the plan, flagged rather than buried.** §4.2
 * has the admin mint this at first plan issue and the phone receive it. It
 * cannot: plan contract v1 has no field to carry it, and adding one is a change
 * to a contract the Tracker also builds against.
 *
 * So the phone mints its own, and the admin learns it from the first return —
 * which it can match, because it already knows which employee it issued that
 * `keyId` to. Every later return matches on the recognition key directly, which
 * is what makes it survive a re-assessment minting a new plan key.
 *
 * What this costs: an employee who reinstalls the app mints a new recognition
 * key, and the admin re-links it by `keyId` on the next return rather than
 * recognising it immediately. Self-healing, one send late. If the plan contract
 * later carries the key, prefer it over the stored one and this becomes a
 * fallback.
 */
export async function ensureRecognitionKey({ fetchRecognitionKey, saveRecognitionKey }) {
  const existing = await fetchRecognitionKey();
  if (existing) return existing;
  return saveRecognitionKey(generateRecognitionKey());
}
