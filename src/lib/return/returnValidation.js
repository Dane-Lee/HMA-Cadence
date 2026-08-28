/**
 * Return Payload validation — contract v1.
 *
 * The reverse direction of `planValidation.js`: what an employee's phone sends
 * back, not what it receives. Given a parsed payload, returns an array of
 * human-readable error strings ([] means valid).
 *
 * Two properties of this contract are worth stating up front, because both are
 * load-bearing and neither is obvious from the shape:
 *
 * 1. **It carries no identifying information.** No name, no badge, no plan
 *    content — only a recognition key and event data. Cadence-Admin attaches
 *    the person from its own records. An intercepted report is meaningless
 *    without the practitioner's machine. So there is deliberately nothing here
 *    to validate a name against: if you find yourself adding one, that is the
 *    contract being broken rather than extended.
 *
 * 2. **It is cumulative.** The phone sends its entire history every time, so a
 *    dropped, filtered or never-sent email self-heals on the next one. That
 *    makes duplicate events across sends the normal case, not an error — the
 *    admin side dedupes on ingest. Validation must not reject a payload for
 *    repeating what it already sent.
 *
 * Kept dependency-light (only the shared enums) so it can back both the phone's
 * composer and the admin's ingest.
 */
import { PAIN_CATEGORIES, FEEDBACK_RATINGS } from '../constants.js';

export const SUPPORTED_RETURN_VERSION = 1;

/** Distinguishes a return from a plan when something is pasted into the wrong box. */
export const RETURN_KIND = 'hma-cadence-return';

const PAIN_KEYS = new Set(PAIN_CATEGORIES.map((c) => c.key));
const RATING_KEYS = new Set(FEEDBACK_RATINGS.map((r) => r.key));

/** Hex, and long enough that two people never collide by accident. */
export const RECOGNITION_KEY_BYTES = 16;
const RECOGNITION_KEY_RE = /^[0-9a-f]{32}$/;

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Thrown by ingest when validation fails; carries the full error list. */
export class ReturnValidationError extends Error {
  constructor(errors) {
    super(`Return rejected: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
    this.name = 'ReturnValidationError';
    this.errors = errors;
  }
}

/** Thrown when schema_version isn't one this receiver understands. */
export class ReturnVersionError extends Error {
  constructor(got) {
    super(`Unsupported return schema_version ${got} (this receiver supports ${SUPPORTED_RETURN_VERSION}).`);
    this.name = 'ReturnVersionError';
    this.schemaVersion = got;
  }
}

export function isRecognitionKey(value) {
  return typeof value === 'string' && RECOGNITION_KEY_RE.test(value);
}

/**
 * Validate an event list. Shared across the three kinds because they differ
 * only in their extra fields, and duplicating the date/id checks three times is
 * how the three drift apart.
 */
function validateEvents(errors, list, name, checkEntry) {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    errors.push(`${name} must be an array when present.`);
    return;
  }
  list.forEach((entry, index) => {
    const at = `${name}[${index}]`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${at} must be an object.`);
      return;
    }
    if (!entry.e || typeof entry.e !== 'string') {
      errors.push(`${at}.e is required (exercise id).`);
    }
    if (!isDate(entry.d)) {
      errors.push(`${at}.d must be a YYYY-MM-DD date.`);
    }
    checkEntry(errors, entry, at);
  });
}

export function validateReturnPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['Payload must be a JSON object.'];

  if (payload.kind !== RETURN_KIND) {
    // The likeliest cause is a plan pasted into the return box, which is worth
    // saying plainly rather than reporting as a dozen missing fields.
    errors.push(`kind must be "${RETURN_KIND}" — is this actually a return payload?`);
  }

  if (!isRecognitionKey(payload.recognition_key)) {
    errors.push('recognition_key is required (32 hex characters).');
  }

  if (payload.generated_at !== undefined && Number.isNaN(Date.parse(payload.generated_at))) {
    errors.push('generated_at must be an ISO timestamp when present.');
  }

  if (payload.plan_id !== undefined && typeof payload.plan_id !== 'string') {
    errors.push('plan_id must be a string when present.');
  }

  validateEvents(errors, payload.completions, 'completions', () => {});

  validateEvents(errors, payload.pain, 'pain', (errs, entry, at) => {
    if (!PAIN_KEYS.has(entry.c)) {
      errs.push(`${at}.c must be one of: ${[...PAIN_KEYS].join(', ')}.`);
    }
    if (entry.n !== undefined && typeof entry.n !== 'string') {
      errs.push(`${at}.n must be a string when present.`);
    }
  });

  validateEvents(errors, payload.feedback, 'feedback', (errs, entry, at) => {
    if (!RATING_KEYS.has(entry.v)) {
      errs.push(`${at}.v must be one of: ${[...RATING_KEYS].join(', ')}.`);
    }
  });

  // A return with a recognition key and nothing else is legitimate: it is what
  // a compliant employee with an uneventful week sends, and the admin uses it
  // as proof of life. Only reject it if nothing at all was supplied.
  if (!payload.completions && !payload.pain && !payload.feedback) {
    errors.push('A return must carry at least one of: completions, pain, feedback.');
  }

  return errors;
}
