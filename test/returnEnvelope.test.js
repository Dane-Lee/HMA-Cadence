/**
 * The return channel, end to end as data: phone composes → email mangles it →
 * Cadence-Admin extracts and opens it.
 *
 * The mangling cases are the point. A payload that only survives a pristine
 * copy-paste is a payload that fails the first time someone forwards a report.
 */
import { describe, it, expect } from 'vitest';

import { generatePlanKey, importPlanKey, keyIdFor } from '../src/lib/qr/envelope.js';
import {
  RETURN_BEGIN,
  RETURN_END,
  buildReturnEnvelope,
  extractReturnEnvelopes,
  formatReturnEmail,
  generateRecognitionKey,
  openReturnEnvelope,
  returnKeyId,
} from '../src/lib/return/returnEnvelope.js';
import {
  RETURN_KIND,
  isRecognitionKey,
  validateReturnPayload,
} from '../src/lib/return/returnValidation.js';

const RECOGNITION = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function report(overrides = {}) {
  return {
    recognition_key: RECOGNITION,
    generated_at: '2026-08-27T12:00:00.000Z',
    plan_id: 'plan-0001',
    completions: [
      { e: 's3', d: '2026-08-24' },
      { e: 'l1', d: '2026-08-24' },
      { e: 's3', d: '2026-08-26' },
    ],
    pain: [{ e: 'l1', d: '2026-08-26', c: 'pain_during', n: 'left hip' }],
    feedback: [{ e: 's3', d: '2026-08-26', v: 'thumbs_up' }],
    ...overrides,
  };
}

async function newKey() {
  const rawKey = generatePlanKey();
  return {
    rawKey,
    keyId: await keyIdFor(rawKey),
    key: await importPlanKey(rawKey, { extractable: true }),
  };
}

describe('recognition key', () => {
  it('is 32 hex characters and does not repeat', () => {
    const a = generateRecognitionKey();
    const b = generateRecognitionKey();
    expect(isRecognitionKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('is required, and rejects a value that is not 32 hex characters', () => {
    expect(validateReturnPayload(report({ recognition_key: 'nope' }))).toContain(
      'recognition_key is required (32 hex characters).',
    );
  });
});

describe('buildReturnEnvelope / openReturnEnvelope', () => {
  it('round-trips a report through the encrypted envelope', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const opened = await openReturnEnvelope(envelope, key);

    expect(opened.kind).toBe(RETURN_KIND);
    expect(opened.recognition_key).toBe(RECOGNITION);
    expect(opened.completions).toHaveLength(3);
    expect(opened.pain[0]).toMatchObject({ e: 'l1', c: 'pain_during', n: 'left hip' });
  });

  it('refuses to build a payload the receiver would reject', async () => {
    const { key, keyId } = await newKey();
    await expect(
      buildReturnEnvelope(report({ pain: [{ e: 'l1', d: '2026-08-26', c: 'not_a_category' }] }), {
        key,
        keyId,
      }),
    ).rejects.toMatchObject({ name: 'ReturnValidationError' });
  });

  it('will not open with the wrong key', async () => {
    const mine = await newKey();
    const theirs = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key: mine.key, keyId: mine.keyId });
    await expect(openReturnEnvelope(envelope, theirs.key)).rejects.toMatchObject({
      code: 'decrypt_failed',
    });
  });

  it('exposes the keyId without decrypting, so the admin knows whose key to try', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const expected = Array.from(keyId, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(returnKeyId(envelope)).toBe(expected);
  });

  it('carries no identifying information', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const opened = await openReturnEnvelope(envelope, key);
    // The contract's privacy claim, asserted rather than trusted to review.
    for (const field of ['employee', 'name', 'first_name', 'last_name', 'employee_number', 'badge']) {
      expect(opened[field]).toBeUndefined();
    }
  });
});

describe('extractReturnEnvelopes', () => {
  it('finds the payload in the email the phone composes', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const body = formatReturnEmail(envelope);

    expect(body).toContain(RETURN_BEGIN);
    expect(body).toContain(RETURN_END);
    expect(extractReturnEnvelopes(body)).toEqual([envelope]);
  });

  it('survives a forwarded copy: quote marks on every line, markers included', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const quoted = formatReturnEmail(envelope)
      .split('\n')
      .map((line) => '> ' + line)
      .join('\n');

    const [found] = extractReturnEnvelopes(quoted);
    expect(found).toBe(envelope);
    // Still opens, which is the claim that actually matters.
    await expect(openReturnEnvelope(found, key)).resolves.toMatchObject({
      recognition_key: RECOGNITION,
    });
  });

  it('survives a reply to a reply: nested quoting', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const mangled = formatReturnEmail(envelope)
      .split('\n')
      .map((line) => '>>  ' + line)
      .join('\n');

    expect(extractReturnEnvelopes(mangled)).toEqual([envelope]);
  });

  it('survives a marker broken at its own spaces', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    // Mail clients wrap at whitespace, so a quoted marker can arrive split
    // where its spaces are. They do not break mid-word.
    const split = formatReturnEmail(envelope)
      .replace(RETURN_BEGIN, '-----BEGIN\n> HMA\n> REPORT-----')
      .replace(RETURN_END, '-----END HMA\n> REPORT-----');

    const [found] = extractReturnEnvelopes(split);
    expect(found).toBe(envelope);
    await expect(openReturnEnvelope(found, key)).resolves.toMatchObject({
      recognition_key: RECOGNITION,
    });
  });

  it('ingests a batch of emails pasted in one action', async () => {
    const a = await newKey();
    const b = await newKey();
    const envelopeA = await buildReturnEnvelope(report(), { key: a.key, keyId: a.keyId });
    const envelopeB = await buildReturnEnvelope(
      report({ recognition_key: '0f1e2d3c4b5a69788796a5b4c3d2e1f0' }),
      { key: b.key, keyId: b.keyId },
    );

    const inbox = [
      'From: one@example.com',
      formatReturnEmail(envelopeA),
      '\n--- Forwarded message ---\nFrom: two@example.com',
      formatReturnEmail(envelopeB),
      '\n-- \nSent from my phone',
    ].join('\n');

    expect(extractReturnEnvelopes(inbox)).toEqual([envelopeA, envelopeB]);
  });

  it('drops the duplicate a reply chain repeats', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const body = formatReturnEmail(envelope);

    expect(extractReturnEnvelopes(body + '\n\nOn Tuesday you wrote:\n' + body)).toEqual([envelope]);
  });

  it('ignores a truncated paste that has a BEGIN but no END', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    const truncated = formatReturnEmail(envelope).split(RETURN_END)[0];

    expect(extractReturnEnvelopes(truncated)).toEqual([]);
  });

  it('returns nothing for text that holds no report', () => {
    expect(extractReturnEnvelopes('Just a normal email, thanks!')).toEqual([]);
    expect(extractReturnEnvelopes('')).toEqual([]);
    expect(extractReturnEnvelopes(null)).toEqual([]);
  });

  it('fails closed when the block was edited, rather than opening something wrong', async () => {
    const { key, keyId } = await newKey();
    const envelope = await buildReturnEnvelope(report(), { key, keyId });
    // Someone "tidied" the block and dropped a character.
    const edited = formatReturnEmail(envelope).replace(envelope.slice(10, 20), envelope.slice(11, 20));

    const [found] = extractReturnEnvelopes(edited);
    expect(found).not.toBe(envelope);
    await expect(openReturnEnvelope(found, key)).rejects.toThrow();
  });
});

describe('the cumulative contract', () => {
  it('accepts a report that repeats events it already sent', async () => {
    const { key, keyId } = await newKey();
    // The phone sends its whole history every time; the same day appears again.
    const resend = report({
      completions: [...report().completions, { e: 's3', d: '2026-08-24' }],
    });
    await expect(buildReturnEnvelope(resend, { key, keyId })).resolves.toEqual(expect.any(String));
  });

  it('accepts an uneventful week — completions only, no pain, no feedback', async () => {
    const { key, keyId } = await newKey();
    const quiet = { recognition_key: RECOGNITION, completions: [{ e: 's3', d: '2026-08-24' }] };
    await expect(buildReturnEnvelope(quiet, { key, keyId })).resolves.toEqual(expect.any(String));
  });

  it('rejects a payload carrying no events at all', () => {
    expect(validateReturnPayload({ kind: RETURN_KIND, recognition_key: RECOGNITION })).toContain(
      'A return must carry at least one of: completions, pain, feedback.',
    );
  });
});
