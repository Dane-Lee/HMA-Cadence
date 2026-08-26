/**
 * Cadence-Admin composes the two QR payloads; the employee's phone consumes
 * them. The valuable assertion is therefore not "it produced a string" but
 * "the receiver can open it" — so the round trip goes back through the real
 * parse/decrypt path rather than inspecting the envelope by hand.
 */

import { describe, expect, it } from 'vitest';
import { buildPlanQr, MAX_QR_BYTES, normalizeBaseUrl, PlanQrError } from '../src/lib/qr/planQr.js';
import {
  decryptPlanEnvelope,
  fromBase64Url,
  importPlanKey,
  keyIdToHex,
  parsePlanEnvelope,
} from '../src/lib/qr/envelope.js';

const BASE = 'https://cadence.example.com';

function plan(overrides = {}) {
  return {
    schema_version: 1,
    plan_id: 'plan-0001',
    generated_at: '2026-08-26T12:00:00.000Z',
    source: { app: 'hma-tracker', version: 'test' },
    employee: {
      employee_number: '4412', first_name: 'A', last_name: 'B', name: 'A B',
      company: 'Hendrickson', department: 'Weld', shift: '1st', location: 'Somerset, KY',
    },
    assessment: {
      assessment_date: '2026-08-26', assessment_type: 'Initial', total_score: 8,
      follow_up_date: '2026-10-07', reassessment_date: '2026-09-23', notes: '',
    },
    schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
    exercises: [
      {
        source_exercise_id: 's3', name: 'Bridge',
        instructions: 'On your back, knees bent. Squeeze glutes and lift hips.',
        movement_category: 'single_leg_dip', exercise_type: 'strength',
        default_prescription: '3x10-15', prescription_override: null,
        duration_sec: 258, days: [1, 3, 5], sort_order: 0, image_ref: 'Bridge.webp',
      },
    ],
    ...overrides,
  };
}

describe('buildPlanQr', () => {
  it('produces fragment URLs the receiver’s parser accepts', async () => {
    const out = await buildPlanQr(plan(), { baseUrl: BASE });
    // fragment.js gates on exactly this shape before React mounts.
    const FRAGMENT = /^#(k|p)=([A-Za-z0-9_-]+)$/;
    expect(FRAGMENT.test(new URL(out.planUrl).hash)).toBe(true);
    expect(FRAGMENT.test(new URL(out.pairUrl).hash)).toBe(true);
  });

  it('round-trips: the plan QR decrypts with the pairing QR’s key', async () => {
    const out = await buildPlanQr(plan(), { baseUrl: BASE });

    // Exactly what the phone does: read #p=, parse, look up a key by id, decrypt.
    const envelope = new URL(out.planUrl).hash.slice('#p='.length);
    const parsed = parsePlanEnvelope(envelope);

    const rawKey = fromBase64Url(new URL(out.pairUrl).hash.slice('#k='.length));
    const key = await importPlanKey(rawKey); // extractable:false, as the phone imports it
    expect(keyIdToHex(parsed.keyId)).toBe(keyIdToHex(out.keyId));

    const decoded = await decryptPlanEnvelope(parsed, key);
    expect(decoded.plan_id).toBe('plan-0001');
    expect(decoded.exercises[0].source_exercise_id).toBe('s3');
    expect(decoded.employee.employee_number).toBe('4412');
  });

  it('mints a fresh key every time, so one plan cannot open another', async () => {
    const a = await buildPlanQr(plan(), { baseUrl: BASE });
    const b = await buildPlanQr(plan({ plan_id: 'plan-0002' }), { baseUrl: BASE });
    expect(a.keyB64).not.toBe(b.keyB64);

    const key = await importPlanKey(fromBase64Url(a.keyB64));
    await expect(decryptPlanEnvelope(parsePlanEnvelope(
      new URL(b.planUrl).hash.slice('#p='.length),
    ), key)).rejects.toThrow();
  });

  it('refuses a payload Cadence would reject, before minting anything', async () => {
    await expect(buildPlanQr({ schema_version: 1 }, { baseUrl: BASE }))
      .rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('refuses to emit an oversized code rather than printing a truncated one', async () => {
    // Instruction text is the realistic way a payload bloats.
    const fat = plan({
      exercises: Array.from({ length: 40 }, (_, i) => ({
        source_exercise_id: `x${i}`, name: `Exercise ${i}`,
        instructions: `${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12)}${i}`,
        movement_category: 'trunk_rotation', exercise_type: 'strength',
        default_prescription: '3x10', prescription_override: null,
        duration_sec: 200, days: [1, 3], sort_order: i, image_ref: null,
      })),
    });
    await expect(buildPlanQr(fat, { baseUrl: BASE })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('counts the base URL against capacity, since the QR encodes the whole URL', async () => {
    const short = await buildPlanQr(plan(), { baseUrl: 'https://a.co' });
    const long = await buildPlanQr(plan(), { baseUrl: `https://${'x'.repeat(80)}.example.com` });
    expect(long.planBytes).toBeGreaterThan(short.planBytes);
    expect(short.headroom).toBe(MAX_QR_BYTES - short.planBytes);
  });

  it('a realistic plan leaves comfortable headroom', async () => {
    const out = await buildPlanQr(plan({
      exercises: Array.from({ length: 12 }, (_, i) => ({
        ...plan().exercises[0], source_exercise_id: `e${i}`, sort_order: i,
      })),
    }), { baseUrl: BASE });
    // Documents the measured reality rather than just asserting "under the cap".
    expect(out.planBytes).toBeLessThan(MAX_QR_BYTES);
    expect(out.headroom).toBeGreaterThan(0);
  });
});

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes and any fragment the admin pasted along', () => {
    expect(normalizeBaseUrl('https://c.example.com/')).toBe('https://c.example.com');
    expect(normalizeBaseUrl('https://c.example.com/#p=abc')).toBe('https://c.example.com');
  });

  it('rejects an empty base rather than emitting a relative URL', () => {
    expect(() => normalizeBaseUrl('  ')).toThrow(PlanQrError);
  });
});
