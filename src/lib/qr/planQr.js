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
 * Byte-mode capacity of a version-40 QR, by error-correction level
 * (ISO/IEC 18004). Version 40 is the largest QR there is, so these are hard
 * ceilings — there is no bigger code to escalate to.
 */
export const CAPACITY_BY_ECC = { L: 2953, M: 2331, Q: 1663, H: 1273 };

/**
 * Error-correction level for the plan QR.
 *
 * **This single constant decides whether a real plan fits at all.** Measured
 * against genuine Tracker content (real exercise names, real instruction text,
 * real .webp filenames) an 11-exercise plan encodes to 1977 bytes:
 *
 *   L (7%)  cap 2953 — 11 exercises fit
 *   M (15%) cap 2331 — 11 exercises fit, ~354 bytes spare
 *   Q (25%) cap 1663 — 7 exercises
 *   H (30%) cap 1273 — 3 exercises
 *
 * Earlier estimates on both machines (960 bytes for 12) were measured against
 * synthetic payloads that repeated the same instruction string, which DEFLATE
 * collapses to almost nothing. Real plans do not compress like that.
 *
 * M is the working default: a full 11-exercise plan fits with headroom, and 15%
 * damage recovery is still substantial for a sheet handed over in person. H is
 * what you want for a code that will be folded, smudged and scanned in bad
 * light on a factory floor — but at H the payload must be slimmed first, which
 * reopens decision E12.
 *
 * **Re-measured 2026-08-28, after the Tracker's selection logic was rewritten to
 * produce smaller, individualised plans.** The hope was that shorter plans would
 * make a higher error-correction level affordable. They do not. Simulating 20,000
 * realistic score sheets through the new logic gives a mean plan of 10 exercises
 * (~1874 bytes):
 *
 *   L cap 2953 — 100%  of plans fit
 *   M cap 2331 — 100%  of plans fit
 *   Q cap 1663 —   6.2% of plans fit
 *   H cap 1273 —   0.2% of plans fit
 *
 * So M is not a temporary compromise pending shorter plans; it is required.
 * Anything above Q needs the payload slimmed, not the plan.
 */
export const PLAN_ECC_LEVEL = 'M';

export const MAX_QR_BYTES = CAPACITY_BY_ECC[PLAN_ECC_LEVEL];

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
 * default, exactly as in `encodePlanEnvelope`. `rawKey` is the same kind of
 * injection, added 2026-09-06 for one caller: the test that renders the
 * committed sample sheet. Without it every `npm test` minted a new key, the
 * sample's two QR codes changed bytes, and the committed file went dirty on
 * every machine that ran the suite -- including the STATUS.md regeneration.
 * A fixed key for a sample that opens nothing anywhere is not a secret.
 *
 * The key is returned raw so the caller can render it. That is unavoidable — the
 * pairing QR *is* the key — and it is why this must run on the admin's own
 * machine and never on a server.
 */
export async function buildPlanQr(payload, { baseUrl, iv, rawKey: injectedKey } = {}) {
  const base = normalizeBaseUrl(baseUrl);

  const errors = validatePlanPayload(payload);
  if (errors.length) {
    throw new PlanQrError('invalid_payload', 'Cadence would reject this plan.', errors);
  }

  const rawKey = injectedKey ?? generatePlanKey();
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
