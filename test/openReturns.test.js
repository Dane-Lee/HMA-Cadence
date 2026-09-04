import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildPlanQr } from '../src/lib/qr/planQr.js';
import {
  importPlanKey,
  fromBase64Url,
  toKeyIdHex,
  keyIdFor,
  encodePlanEnvelope,
} from '../src/lib/qr/envelope.js';
import { buildReturnEnvelope, formatReturnEmail } from '../src/lib/return/returnEnvelope.js';
import { openPastedReturns, summariseReturn, RETURN_OUTCOME } from '../src/lib/return/openReturns.js';
import {
  recordIssuedPlanKey,
  fetchIssuedPlanKey,
  bindRecognitionKey,
  fetchByRecognitionKey,
  resetLocalDb,
} from '../src/lib/data/adapters/localAdapter.js';

const BASE = 'https://cadence.example.com';
const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../docs/sample-plan-payload.json', import.meta.url)), 'utf8'),
);

const RECOGNITION = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const deps = { fetchIssuedPlanKey, bindRecognitionKey };

beforeEach(() => {
  resetLocalDb(new Date('2026-09-04T12:00:00Z'));
});

/** Issue a plan exactly as the admin page does, and keep the key. */
async function issuePlan(overrides = {}) {
  const result = await buildPlanQr(structuredClone(SAMPLE), { baseUrl: BASE });
  const keyId = toKeyIdHex(result.keyId);
  await recordIssuedPlanKey({
    keyId,
    keyB64: result.keyB64,
    planId: SAMPLE.plan_id,
    employeeNumber: SAMPLE.employee.employee_number,
    employeeName: SAMPLE.employee.name,
    ...overrides,
  });
  return { keyId, keyB64: result.keyB64 };
}

/** The email a phone paired with that key would actually send.
 *
 * The keyId has to be the one derived from the key itself -- that is what the
 * admin looks the key up by, so a made-up value would test nothing. */
async function reportEmail({ keyB64, payload }) {
  const raw = fromBase64Url(keyB64);
  const key = await importPlanKey(raw, { extractable: true });
  const envelope = await buildReturnEnvelope(payload, { key, keyId: await keyIdFor(raw) });
  return formatReturnEmail(envelope);
}

/** An envelope that decrypts but is not a valid return.
 *
 * buildReturnEnvelope validates on the way in, so it cannot produce this --
 * which is the point: only a phone running a different version could. Encoding
 * directly is the only honest way to simulate that skew. */
async function skewedEnvelope({ keyB64, payload }) {
  const raw = fromBase64Url(keyB64);
  const key = await importPlanKey(raw, { extractable: true });
  return encodePlanEnvelope(payload, { key, keyId: await keyIdFor(raw) });
}

function samplePayload(extra = {}) {
  return {
    kind: 'hma-cadence-return',
    schema_version: 1,
    recognition_key: RECOGNITION,
    generated_at: '2026-09-04T09:00:00Z',
    plan_id: SAMPLE.plan_id,
    completions: [{ e: 'l1', d: '2026-09-02' }],
    ...extra,
  };
}

describe('opening a pasted return', () => {
  it('round-trips a real report from a plan this machine issued', async () => {
    /* The end-to-end case that could not be tested before today: issue a plan,
     * keep the key, and open a report encrypted with it. */
    const { keyId, keyB64 } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });

    const { found, opened } = await openPastedReturns(email, deps);

    expect(found).toBe(1);
    expect(opened).toHaveLength(1);
    expect(opened[0].payload.plan_id).toBe(SAMPLE.plan_id);
    expect(opened[0].issued.employeeNumber).toBe(SAMPLE.employee.employee_number);
  });

  it('binds the recognition key so later reports match without the keyId', async () => {
    const { keyB64, keyId } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });

    await openPastedReturns(email, deps);

    const linked = await fetchByRecognitionKey(RECOGNITION);
    expect(linked).not.toBeNull();
    expect(linked.employeeNumber).toBe(SAMPLE.employee.employee_number);
  });

  it('says so plainly when the plan was issued somewhere else', async () => {
    /* Not a decryption failure -- there is nothing wrong with the email. Calling
     * it "unreadable" would send the admin hunting a corrupted message instead
     * of the other machine. */
    const { keyB64, keyId } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });
    resetLocalDb(new Date('2026-09-04T12:00:00Z')); // this machine never issued it

    const { results } = await openPastedReturns(email, deps);

    expect(results[0].outcome).toBe(RETURN_OUTCOME.UNKNOWN_KEY);
    expect(results[0].keyId).toBeTruthy();
  });

  it('reports an unopenable block without discarding the good ones', async () => {
    /* A forwarded thread can carry two people's reports. One being unreadable
     * must not cost the admin the other, or they re-ask everybody. */
    const a = await issuePlan();
    const emailA = await reportEmail({ ...a, payload: samplePayload() });

    const b = await buildPlanQr(structuredClone(SAMPLE), { baseUrl: BASE });
    const keyB = await importPlanKey(fromBase64Url(b.keyB64), { extractable: true });
    const strayEnvelope = await buildReturnEnvelope(
      samplePayload({ recognition_key: 'f'.repeat(32) }),
      { key: keyB, keyId: await keyIdFor(fromBase64Url(b.keyB64)) },
    );
    const emailB = formatReturnEmail(strayEnvelope); // key never recorded

    const { found, results, opened } = await openPastedReturns(`${emailA}\n\n${emailB}`, deps);

    expect(found).toBe(2);
    expect(opened).toHaveLength(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(
      [RETURN_OUTCOME.OPENED, RETURN_OUTCOME.UNKNOWN_KEY].sort(),
    );
  });

  it('finds nothing in an email with no report in it', async () => {
    const { found, opened } = await openPastedReturns(
      'Hi, just checking in about my exercises. Thanks!',
      deps,
    );

    expect(found).toBe(0);
    expect(opened).toEqual([]);
  });

  it('ignores a repeated block from a reply chain', async () => {
    const { keyB64, keyId } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });

    const { found } = await openPastedReturns(`${email}\n\n> quoted below\n${email}`, deps);

    expect(found).toBe(1);
  });

  it('treats a truncated paste as no report rather than a broken one', async () => {
    /* A BEGIN with no END is a paste that stopped early. Reporting it as
     * unreadable would imply the employee's report was damaged. */
    const { keyB64, keyId } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });
    const truncated = email.slice(0, Math.floor(email.length * 0.6));

    const { found } = await openPastedReturns(truncated, deps);

    expect(found).toBe(0);
  });

  it('survives quoting marks the mail client adds', async () => {
    const { keyB64, keyId } = await issuePlan();
    const email = await reportEmail({ keyB64, payload: samplePayload() });
    const quoted = email
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');

    const { opened } = await openPastedReturns(quoted, deps);

    expect(opened).toHaveLength(1);
  });

  it('reports a decrypted-but-wrong payload as not a return', async () => {
    /* The key is right, so this really is from that employee -- but the contents
     * are not a return we understand. That is a version skew, not a bad email,
     * and the admin should be told which. */
    const { keyB64 } = await issuePlan();
    const envelope = await skewedEnvelope({
      keyB64,
      payload: { kind: 'something-else', schema_version: 1 },
    });

    const { results } = await openPastedReturns(formatReturnEmail(envelope), deps);

    expect(results[0].outcome).toBe(RETURN_OUTCOME.NOT_A_RETURN);
    expect(results[0].issued.employeeNumber).toBe(SAMPLE.employee.employee_number);
  });
});

describe('summariseReturn', () => {
  it('counts what arrived without reproducing it', async () => {
    const summary = summariseReturn(
      samplePayload({
        pain: [{ e: 'l1', d: '2026-09-02', c: 'during' }],
        feedback: [{ e: 'l1', d: '2026-09-02', r: 3 }],
      }),
    );

    expect(summary).toMatchObject({ completions: 1, pain: 1, feedback: 1 });
    expect(summary.planId).toBe(SAMPLE.plan_id);
  });

  it('is null for nothing, rather than a row of zeroes', () => {
    expect(summariseReturn(null)).toBeNull();
  });
});
