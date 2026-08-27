/**
 * Cadence-Admin composes the two QR payloads; the employee's phone consumes
 * them. The valuable assertion is therefore not "it produced a string" but
 * "the receiver can open it" — so the round trip goes back through the real
 * parse/decrypt path rather than inspecting the envelope by hand.
 */

import { describe, expect, it } from 'vitest';
import { buildPlanQr, CAPACITY_BY_ECC, MAX_QR_BYTES, normalizeBaseUrl, PlanQrError } from '../src/lib/qr/planQr.js';
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
    // Deliberately incompressible. Repeated text deflates to almost nothing, which
    // is how both machines first talked themselves into believing capacity was a
    // non-issue — and an LCG rather than a modular cycle, because a short repeating
    // pattern also deflates away and made the first version of this test pass for
    // the wrong reason.
    const noise = (n, seed) => { let s = (seed * 2654435761) >>> 0, o = '';
      for (let k = 0; k < n; k++) { s = (s * 1664525 + 1013904223) >>> 0; o += String.fromCharCode(97 + ((s >>> 16) % 26)); }
      return o; };
    const fat = plan({
      exercises: Array.from({ length: 60 }, (_, i) => ({
        source_exercise_id: `x${i}`, name: `Exercise ${noise(24, i)}`,
        instructions: noise(160, i + 7),
        movement_category: 'trunk_rotation', exercise_type: 'strength',
        default_prescription: '3x10', prescription_override: null,
        duration_sec: 200, days: [1, 3], sort_order: i, image_ref: `${noise(20, i + 3)}.webp`,
      })),
    });
    await expect(buildPlanQr(fat, { baseUrl: BASE })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('the refusal says how far over it is and what to cut', async () => {
    // An LCG, not a modular cycle: a repeating pattern deflates away and the
    // payload never reaches the cap, which is what made the first version of this
    // test pass for the wrong reason.
    const noise = (n, seed) => { let s = (seed * 2654435761) >>> 0, o = '';
      for (let k = 0; k < n; k++) { s = (s * 1664525 + 1013904223) >>> 0; o += String.fromCharCode(97 + ((s >>> 16) % 26)); }
      return o; };
    const fat = plan({
      exercises: Array.from({ length: 60 }, (_, i) => ({
        source_exercise_id: `y${i}`, name: noise(30, i),
        instructions: noise(180, i + 5),
        movement_category: 'trunk_rotation', exercise_type: 'strength',
        default_prescription: '3x10', prescription_override: null,
        duration_sec: 200, days: [1], sort_order: i, image_ref: null,
      })),
    });
    // "Too big" alone leaves the admin guessing; the numbers are the actionable part.
    const err = await buildPlanQr(fat, { baseUrl: BASE }).catch((e) => e);
    expect(err.code).toBe('too_large');
    expect(err.detail.planBytes).toBeGreaterThan(err.detail.limit);
    expect(err.detail.exercises).toBe(60);
    expect(err.message).toMatch(/\d+ bytes/);
  });

  it('counts the base URL against capacity, since the QR encodes the whole URL', async () => {
    const short = await buildPlanQr(plan(), { baseUrl: 'https://a.co' });
    const long = await buildPlanQr(plan(), { baseUrl: `https://${'x'.repeat(80)}.example.com` });
    expect(long.planBytes).toBeGreaterThan(short.planBytes);
    expect(short.headroom).toBe(MAX_QR_BYTES - short.planBytes);
  });

  /* Real instruction text from the Tracker's own library. A full plan of eleven
     *distinct* exercises is the case the whole design has to survive, and it is
     the case both machines got wrong by measuring twelve copies of one exercise. */
  const REAL_INSTRUCTIONS = [
    'Lie on a table at 45° with one leg hanging off. Let your leg hang to feel a stretch in the front of your hip.',
    'Kneel on one knee, tuck the pelvis under, shift weight forward until a stretch is felt at the front of the hip.',
    'Doorway, forearms on the frame at shoulder height. Step through until a stretch is felt across the chest. Hold.',
    'On hands and knees, sit back toward the heels and reach one arm across the body along the floor.',
    'Tilt the head toward one armpit, then gently assist with the same-side hand until a stretch is felt.',
    'Stand facing a table, raise leg and place lower leg on the edge. Slowly lean forward until you feel a stretch in your hip.',
    'Bosu ball (curved side up) in front. Step up and drive the opposite knee toward the ceiling. Keep abdominals contracted.',
    'Reach one hand behind the head and down the spine. Use the other hand to draw the elbow gently back.',
    'Side lying, knees bent 90°. Open the top arm across the body, following the hand with your eyes. Return slowly.',
    'Tilt one ear toward the shoulder without rotating. Hold, then return through centre and repeat to the other side.',
    'Stand with hands behind your head, step one foot back and bend both knees to ~90°. Drive through the front foot to stand.',
  ];

  it('a full plan of eleven DISTINCT exercises fits at the chosen ECC level', async () => {
    const real = plan({
      exercises: REAL_INSTRUCTIONS.map((instructions, i) => ({
        source_exercise_id: `r${i}`,
        name: ['Hip Flexor Stretch', 'Kneeling Hip Flexor Stretch', 'Doorway Pec Stretch',
          'Child Pose with Cross Reach', 'Levator Scapulae Stretch', 'Pigeon Stretch',
          'High Step-Ups', 'Overhead Tricep Stretch', 'Side Lying T-Spine Rotation',
          'Cervical Side Bending', 'Reverse Lunge'][i],
        instructions,
        movement_category: 'trunk_rotation', exercise_type: 'flexibility',
        default_prescription: '2x30 sec hold each side', prescription_override: null,
        duration_sec: 160, days: [1, 3, 5], sort_order: i,
        image_ref: `Hip Flexor Stretch off of Table ${i}.webp`,
      })),
    });
    const out = await buildPlanQr(real, { baseUrl: 'https://hma-cadence.vercel.app' });

    // Fits — but the margin is the point, not the pass. Measured ~1977 bytes against
    // a 2331 cap at level M. The same plan does NOT fit at level H (cap 1273), which
    // is why PLAN_ECC_LEVEL is a documented decision and not an implementation detail.
    expect(out.planBytes).toBeLessThan(MAX_QR_BYTES);
    expect(out.planBytes).toBeGreaterThan(CAPACITY_BY_ECC.H);
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
