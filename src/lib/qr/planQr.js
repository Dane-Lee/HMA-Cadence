/**
 * Compose the two QR payloads an admin hands to an employee.
 *
 * This is the Cadence-Admin half of the handoff: take a validated Tracker plan
 * payload, mint a fresh key, encrypt it into an envelope, and produce the two
 * URLs that get rendered as QR codes. Rendering lives elsewhere — everything
 * here is pure data, so it is testable in Node without a DOM or a canvas.
 *
 *   pairing QR  ->  <base>/#k=<base64url raw key>
 *   plan QR     ->  <base>/#p=<base64url envelope>
 *
 * Those two shapes are fixed by `fragment.js`, which parses `^#(k|p)=([A-Za-z0-9_-]+)$`
 * before React mounts. A fragment never travels in an HTTP request, which is the
 * whole reason the key and the plan ride there rather than in a query string.
 *
 * Capacity is enforced, not warned about: an oversized code either fails to scan
 * or silently truncates, and a plan that half-arrives is worse than one that was
 * never printed. See `MAX_QR_BYTES`.
 */

import {
  encodePlanEnvelope,
  generatePlanKey,
  importPlanKey,
  keyIdFor,
  toBase64Url,
} from './envelope.js';
import { validatePlanPayload } from '../data/planValidation.js';

/**
 * Byte-mode capacity of a version-40 QR at error-correction level H (30%).
 *
 * H is deliberate rather than conservative: these codes are printed on a sheet
 * that goes onto a factory floor, gets folded, and is scanned in bad light off
 * a phone camera. The extra redundancy is the difference between a smudged code
 * that still reads and one that does not.
 *
 * The measured reality is comfortable — a 12-exercise plan deflates to roughly
 * 900 characters — so this ceiling is a guard against a pathological payload,
 * not a routine constraint.
 */
export const MAX_QR_BYTES = 1273;

/** Thrown when a plan cannot be turned into a scannable code. */
export class PlanQrError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PlanQrError';
    this.code = code; // 'invalid_payload' | 'too_large'
    this.detail = detail;
  }
}

/**
 * Strip any fragment or trailing slash so `${base}/#k=…` is well-formed whatever
 * the caller passed in. An admin pasting the deployed URL out of a browser bar
 * will often bring a fragment along with it.
 */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim().replace(/#.*$/, '').replace(/\/+$/, '');
  if (!trimmed) throw new PlanQrError('invalid_payload', 'A base URL is required.');
  return trimmed;
}

/**
 * payload -> { pairUrl, planUrl, … }
 *
 * `iv` is injectable for reproducible tests only; production callers must let it
 * default, exactly as in `encodePlanEnvelope`.
 *
 * The key is returned raw so the caller can render it. That is unavoidable — the
 * pairing QR *is* the key — and it is why this must run on the admin's own
 * machine and never on a server.
 */
export async function buildPlanQr(payload, { baseUrl, iv } = {}) {
  const base = normalizeBaseUrl(baseUrl);

  const errors = validatePlanPayload(payload);
  if (errors.length) {
    throw new PlanQrError('invalid_payload', 'Cadence would reject this plan.', errors);
  }

  const rawKey = generatePlanKey();
  const keyId = await keyIdFor(rawKey);
  const key = await importPlanKey(rawKey, { extractable: true });
  const envelope = await encodePlanEnvelope(payload, { key, keyId, iv });

  const planUrl = `${base}/#p=${envelope}`;
  const pairUrl = `${base}/#k=${toBase64Url(rawKey)}`;

  // The QR encodes the whole URL, so the base counts against capacity too — a
  // long host can push an otherwise-fine plan over the edge, which is exactly
  // the kind of thing that would only show up on the printed sheet.
  const planBytes = new TextEncoder().encode(planUrl).length;
  if (planBytes > MAX_QR_BYTES) {
    throw new PlanQrError(
      'too_large',
      `This plan needs ${planBytes} bytes and the limit is ${MAX_QR_BYTES}. ` +
        'Shorten the plan (fewer exercises, or trim instruction text) and try again.',
      { planBytes, limit: MAX_QR_BYTES, exercises: payload.exercises?.length ?? 0 },
    );
  }

  return {
    planUrl,
    pairUrl,
    envelope,
    keyId,
    keyB64: toBase64Url(rawKey),
    planBytes,
    pairBytes: new TextEncoder().encode(pairUrl).length,
    capacity: MAX_QR_BYTES,
    headroom: MAX_QR_BYTES - planBytes,
  };
}
