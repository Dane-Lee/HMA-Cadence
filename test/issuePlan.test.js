import { describe, it, expect, beforeEach } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildPlanQr } from '../src/lib/qr/planQr.js';
import {
  parsePlanEnvelope,
  decryptPlanEnvelope,
  importPlanKey,
  keyIdFor,
  toKeyIdHex,
} from '../src/lib/qr/envelope.js';
import {
  recordIssuedPlanKey,
  fetchIssuedPlanKey,
  resetLocalDb,
} from '../src/lib/data/adapters/localAdapter.js';

const BASE = 'https://cadence.example.com';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../docs/sample-plan-payload.json', import.meta.url)), 'utf8'),
);

/* The real contract-v1 sample, not a hand-rolled approximation.
 *
 * Writing my own from memory produced a payload validatePlanPayload rejected,
 * which made six tests fail for a reason that had nothing to do with issuing.
 * Reading the shipped sample is both correct and drift-proof. */
function samplePlan() {
  return structuredClone(SAMPLE);
}

/* High-entropy text from a fixed seed.
 *
 * The first version of this test used varied-looking instructions that shared a
 * repeated substring, and DEFLATE collapsed 40 exercises to 637 bytes of
 * headroom -- the plan fit, and the test failed for the opposite reason to the
 * one it was written for. That is the same trap that made an earlier 960-byte
 * capacity measurement wrong. Deterministic so the test cannot flake. */
function noise(length, seed) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  let state = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

beforeEach(() => {
  resetLocalDb(new Date('2026-09-04T12:00:00Z'));
});

describe('issuing a plan', () => {
  it('produces both codes, with the pairing code carrying the key', async () => {
    const result = await buildPlanQr(samplePlan(), { baseUrl: BASE });

    expect(result.pairUrl).toContain('#k=');
    expect(result.planUrl).toContain('#p=');
    expect(toKeyIdHex(result.keyId)).toMatch(/^[0-9a-f]{8}$/);
    expect(result.headroom).toBeGreaterThan(0);
  });

  it('the stored key is the one that opens the plan code', async () => {
    /* The whole point of keeping the key. If what the admin stores does not
     * decrypt what it printed, every return from that plan is unopenable and
     * nothing about the sheet looks wrong. */
    const result = await buildPlanQr(samplePlan(), { baseUrl: BASE });

    await recordIssuedPlanKey({
      keyId: toKeyIdHex(result.keyId),
      keyB64: result.keyB64,
      planId: SAMPLE.plan_id,
      employeeNumber: SAMPLE.employee.employee_number,
    });

    const stored = await fetchIssuedPlanKey(toKeyIdHex(result.keyId));
    const key = await importPlanKey(fromBase64Url(stored.keyB64));
    const envelope = result.planUrl.split('#p=')[1];
    const payload = await decryptPlanEnvelope(parsePlanEnvelope(envelope), key);

    expect(payload.plan_id).toBe(SAMPLE.plan_id);
    expect(payload.employee.employee_number).toBe(SAMPLE.employee.employee_number);
  });

  it('the stored keyId is the one stamped on the envelope', async () => {
    /* A return is matched by the keyId parsed off the envelope, so a mismatch
     * here means a return that decrypts fine and is filed under nobody. */
    const result = await buildPlanQr(samplePlan(), { baseUrl: BASE });

    const envelope = result.planUrl.split('#p=')[1];
    const stampedHex = toKeyIdHex(parsePlanEnvelope(envelope).keyId);

    expect(stampedHex).toBe(toKeyIdHex(result.keyId));
    expect(toKeyIdHex(await keyIdFor(fromBase64Url(result.keyB64)))).toBe(stampedHex);
  });

  it('two issues never share a key', async () => {
    const a = await buildPlanQr(samplePlan(), { baseUrl: BASE });
    const b = await buildPlanQr(samplePlan(), { baseUrl: BASE });

    expect(a.keyB64).not.toBe(b.keyB64);
    expect(toKeyIdHex(a.keyId)).not.toBe(toKeyIdHex(b.keyId));
  });

  it('refuses an oversized plan and reports what to cut', async () => {
    /* 1e: the refusal has to say the byte count and what to do about it, not
     * just "no". Varied instruction text is what breaks it -- DEFLATE collapses
     * repeated text, so a plan of identical instructions is misleadingly small. */
    const plan = samplePlan();
    const template = samplePlan().exercises[0];
    plan.exercises = Array.from({ length: 40 }, (_, i) => ({
      ...template,
      source_exercise_id: `x${i}`,
      name: noise(24, i * 7 + 1),
      instructions: noise(180, i * 31 + 3),
      sort_order: i,
    }));

    await expect(buildPlanQr(plan, { baseUrl: BASE })).rejects.toMatchObject({
      code: 'too_large',
    });

    try {
      await buildPlanQr(plan, { baseUrl: BASE });
    } catch (err) {
      expect(err.detail.planBytes).toBeGreaterThan(err.detail.limit);
      expect(err.detail.exercises).toBe(40);
      expect(err.message).toMatch(/\d+/);
    }
  });

  it('counts the base URL against capacity', async () => {
    /* A long host spends room the plan needs, and it would only show up at the
     * printer. Same plan, longer address, less headroom. */
    const short = await buildPlanQr(samplePlan(), { baseUrl: 'https://a.co' });
    const long = await buildPlanQr(samplePlan(), {
      baseUrl: 'https://a-very-long-cadence-hostname.example.company.com',
    });

    expect(long.headroom).toBeLessThan(short.headroom);
  });

  it('rejects a plan Cadence itself would reject, before minting a key', async () => {
    const plan = samplePlan();
    delete plan.employee.employee_number;

    await expect(buildPlanQr(plan, { baseUrl: BASE })).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });
});
