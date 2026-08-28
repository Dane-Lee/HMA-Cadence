/**
 * The return channel: an employee's phone → an email → Cadence-Admin's clipboard.
 *
 * Composing and parsing only. No DOM, no mail client, no storage — the same
 * split as `planQr.js`, so all of this is testable in Node.
 *
 * The envelope format is `envelope.js` unchanged. Those functions are named
 * `…PlanEnvelope` but are generic AES-GCM + DEFLATE + keyId framing with nothing
 * plan-specific in them, and renaming them would be a shared-contract change
 * across two machines for cosmetic gain. Reused as-is, deliberately.
 *
 * Why the return can use the plan's own key: `importPlanKey` grants both
 * `encrypt` and `decrypt`, and the phone's keystore already holds the key from
 * pairing. So the phone encrypts with what it has, and the admin opens it by
 * `keyId` without trial-decrypting against every employee. No second key
 * ceremony, and nothing new to print.
 */
import {
  EnvelopeError,
  KEY_ID_BYTES,
  encodePlanEnvelope,
  parsePlanEnvelope,
  decryptPlanEnvelope,
} from '../qr/envelope.js';
import {
  RECOGNITION_KEY_BYTES,
  RETURN_KIND,
  ReturnValidationError,
  ReturnVersionError,
  SUPPORTED_RETURN_VERSION,
  validateReturnPayload,
} from './returnValidation.js';

export const RETURN_BEGIN = '-----BEGIN HMA REPORT-----';
export const RETURN_END = '-----END HMA REPORT-----';

/** Base64url alphabet. Everything outside it is noise the mail client added. */
const BASE64URL_CHARS = /[^A-Za-z0-9_-]/g;

/*
 * The markers, matched loosely.
 *
 * Mail clients wrap long lines and prefix quoted ones, and they break at
 * whitespace -- so a deeply quoted marker can arrive split at its own spaces.
 * Allowing `[\s>]` wherever the marker has a space costs nothing and is the
 * difference between a forwarded report parsing and silently not existing.
 */
const BEGIN_RE = /-{5}[\s>]*BEGIN[\s>]+HMA[\s>]+REPORT[\s>]*-{5}/g;
const END_RE = /-{5}[\s>]*END[\s>]+HMA[\s>]+REPORT[\s>]*-{5}/g;

/** Every match of `re` in `text`, as {start, end} offsets. */
function spans(re, text) {
  const out = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Short enough to survive a mail client's own wrapping without being re-wrapped. */
const WRAP_COLUMNS = 64;

/**
 * The employee's stable identity on the admin's machine.
 *
 * Minted once, at first plan issue, and carried across every later plan that
 * person receives. It cannot be derived from the plan key: a re-assessment
 * mints a fresh plan key, and a return sent afterwards still has to match the
 * profile that already exists. The plan id changes; this does not.
 */
export function generateRecognitionKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOGNITION_KEY_BYTES));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * payload → validated → encrypted envelope string.
 *
 * `iv` is injectable only so tests are reproducible; production callers let it
 * default, exactly as in `encodePlanEnvelope`.
 */
export async function buildReturnEnvelope(payload, { key, keyId, iv } = {}) {
  const stamped = {
    schema_version: SUPPORTED_RETURN_VERSION,
    kind: RETURN_KIND,
    ...payload,
  };
  const errors = validateReturnPayload(stamped);
  if (errors.length) throw new ReturnValidationError(errors);
  return encodePlanEnvelope(stamped, { key, keyId, iv });
}

/**
 * Reverse of build. Throws `EnvelopeError('decrypt_failed')` on the wrong key,
 * and validates the contract afterwards so a payload that decrypts but is not a
 * return is refused here rather than half-filed by a caller.
 */
export async function openReturnEnvelope(encoded, key) {
  const parsed = parsePlanEnvelope(encoded);
  const payload = await decryptPlanEnvelope(parsed, key);
  if (payload?.schema_version !== undefined && payload.schema_version !== SUPPORTED_RETURN_VERSION) {
    throw new ReturnVersionError(payload.schema_version);
  }
  const errors = validateReturnPayload(payload);
  if (errors.length) throw new ReturnValidationError(errors);
  return payload;
}

/** keyId of an envelope, without decrypting — how the admin finds whose key to try. */
export function returnKeyId(encoded) {
  const { keyId } = parsePlanEnvelope(encoded);
  if (keyId.length !== KEY_ID_BYTES) {
    throw new EnvelopeError('malformed', `keyId must be ${KEY_ID_BYTES} bytes.`);
  }
  return Array.from(keyId, (b) => b.toString(16).padStart(2, '0')).join('');
}

function wrap(text, columns = WRAP_COLUMNS) {
  const lines = [];
  for (let i = 0; i < text.length; i += columns) lines.push(text.slice(i, i + columns));
  return lines.join('\n');
}

/**
 * The email body the phone hands to the mail client.
 *
 * A readable line first, because the employee sees this before sending and a
 * screen of base64 with no explanation is alarming. Then the payload between
 * the two markers.
 */
export function formatReturnEmail(envelope, { note } = {}) {
  return [
    'This is my exercise progress report from HMA Cadence.',
    note ? `\n${note}` : '',
    '\nPlease send this message without editing the block below.\n',
    RETURN_BEGIN,
    wrap(envelope),
    RETURN_END,
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * Find every payload in whatever was pasted — one email or fifty.
 *
 * This is the part that meets real email, so it is deliberately liberal:
 *
 * - **Line wrapping.** Mail clients hard-wrap long lines. The payload arrives
 *   split across many lines and has to be rejoined.
 * - **Quoting.** A forwarded or replied-to report arrives with `>` (or `> > `)
 *   on every line, markers included.
 * - **Stray whitespace** from copying out of a rendered message body.
 *
 * All three are handled the same way: inside a marked block, strip everything
 * that is not a base64url character. Quote marks, spaces, newlines and soft
 * line-break `=` are all outside that alphabet, so one filter covers the lot.
 *
 * Being liberal is safe here specifically because the envelope is authenticated:
 * if this rejoins bytes wrongly, AES-GCM fails to open it and the caller reports
 * an unreadable report. It cannot silently produce a plausible-but-wrong one.
 *
 * Duplicates are dropped. A reply chain repeats the same block on every hop,
 * and cumulative payloads mean the same report legitimately arrives twice.
 */
export function extractReturnEnvelopes(text) {
  if (typeof text !== 'string' || !text) return [];

  const begins = spans(BEGIN_RE, text);
  const ends = spans(END_RE, text);

  const blocks = [];
  let cursor = 0;
  for (const begin of begins) {
    if (begin.start < cursor) continue; // inside a block already taken
    const close = ends.find((candidate) => candidate.start >= begin.end);
    if (!close) break; // truncated paste: a BEGIN with no END is not a report
    blocks.push(text.slice(begin.end, close.start));
    cursor = close.end;
  }

  const seen = new Set();
  const found = [];
  for (const block of blocks) {
    const cleaned = block.replace(BASE64URL_CHARS, '');
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    found.push(cleaned);
  }
  return found;
}
