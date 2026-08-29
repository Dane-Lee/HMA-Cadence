/**
 * The send action, one level above the composer.
 *
 * Gathers events, works out whether there is anything new, builds the mail, and
 * records that it went. Kept out of the component so all of it is testable in
 * Node: the only browser-touching step, opening the `mailto:`, is injected.
 */
import { getLatestDeviceKey } from '../qr/keystore.js';
import {
  composeReturnEmail,
  ensureRecognitionKey,
  hasNothingToSend,
  toReturnPayload,
} from './composeReturn.js';

/**
 * Where reports go, from the build.
 *
 * The plan has this arriving in the plan QR (§4.2), but plan contract v1 has no
 * field for it, so it is a build-time setting until that is decided. Unset is a
 * real state and the UI must handle it: an employee-facing app must not open a
 * mail client with no recipient and hope they know who to type.
 */
export function returnAddress() {
  const configured = import.meta.env?.VITE_RETURN_ADDRESS;
  return typeof configured === 'string' ? configured.trim() : '';
}

/** A fingerprint of exactly the events a payload carries. */
export function returnSignature(payload) {
  return JSON.stringify({
    completions: payload.completions ?? [],
    pain: payload.pain ?? [],
    feedback: payload.feedback ?? [],
  });
}

/**
 * Everything the UI needs to decide what to show, without sending anything.
 *
 * `status` is the whole state machine in one value:
 *   'unconfigured' — no return address in this build; sending is impossible
 *   'unpaired'     — no device key, so nothing can be encrypted
 *   'empty'        — nothing recorded yet
 *   'unsent'       — there is activity the practitioner has not seen
 *   'sent'         — everything recorded has already gone
 */
export async function prepareReturn({ employeeId, db }) {
  const [events, sendState, recognitionKey] = await Promise.all([
    db.fetchReturnEvents(employeeId),
    db.fetchReturnSendState(),
    ensureRecognitionKey({
      fetchRecognitionKey: db.fetchRecognitionKey,
      saveRecognitionKey: db.saveRecognitionKey,
    }),
  ]);

  const payload = toReturnPayload({
    recognitionKey,
    planId: events.planId,
    events,
  });
  const signature = returnSignature(payload);

  let status;
  if (!returnAddress()) status = 'unconfigured';
  else if (hasNothingToSend(payload)) status = 'empty';
  else if (signature !== sendState.signature) status = 'unsent';
  else status = 'sent';

  return { payload, signature, status, sentAt: sendState.sentAt };
}

/**
 * Hand a report to the mail client and record that it went.
 *
 * "Sent" here means handed over, not delivered — the employee still has to press
 * send in their mail app, and nothing here can observe that. That is why the
 * payload is cumulative: if this send never actually leaves, the next one
 * carries the same events again and the gap closes itself. Recording the
 * hand-off is what stops the reminder nagging after the employee has done their
 * part; it is not a delivery receipt, and the admin's records are the only
 * proof anything arrived.
 */
export async function sendReturn({ employeeId, db, openUrl }) {
  if (!returnAddress()) return { ok: false, reason: 'unconfigured' };

  const device = await getLatestDeviceKey();
  if (!device) return { ok: false, reason: 'unpaired' };

  const { payload, signature } = await prepareReturn({ employeeId, db });
  if (hasNothingToSend(payload)) return { ok: false, reason: 'empty' };

  const mail = await composeReturnEmail({
    payload,
    key: device.key,
    keyId: device.keyId,
    to: returnAddress(),
  });

  openUrl(mail.mailtoUrl);
  const sendState = await db.markReturnSent({ signature });
  return { ok: true, signature, sentAt: sendState.sentAt, mailtoUrl: mail.mailtoUrl };
}
