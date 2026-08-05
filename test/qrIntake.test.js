/**
 * QR intake — pairing, plan application, and the pending-plan path.
 *
 * The pending path is the load-bearing one: an employee scans their printed
 * sheet before ever being paired, and the plan must apply itself the moment a
 * key arrives — days or weeks later, with no reprint.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../src/lib/data/adapters/localAdapter.js';
import {
  encodePlanEnvelope,
  generatePlanKey,
  importPlanKey,
  keyIdFor,
  keyIdToHex,
  toBase64Url,
} from '../src/lib/qr/envelope.js';
import { storeDeviceKey, getDeviceKey, hasAnyDeviceKey, clearDeviceKeys } from '../src/lib/qr/keystore.js';
import { readPendingPlan, clearPendingPlan } from '../src/lib/qr/pending.js';
import { applyPlanEnvelope } from '../src/lib/qr/applyPlan.js';

const plan = (overrides = {}) => ({
  schema_version: 1,
  plan_id: 'qr-test-plan-1',
  generated_at: '2026-08-04T12:00:00Z',
  source: { app: 'hma-tracker', version: 'test' },
  employee: { employee_number: '7788', name: 'Fictional Tester' },
  assessment: { assessment_date: '2026-08-04', total_score: 9 },
  schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
  exercises: [
    {
      source_exercise_id: 's3',
      name: 'Bridge',
      movement_category: 'single_leg_dip',
      exercise_type: 'strength',
      default_prescription: '3x10',
      days: [1, 3, 5],
      sort_order: 0,
    },
  ],
  ...overrides,
});

/** A Tracker-side key: extractable, because the Tracker has to render it as a QR. */
async function trackerKey() {
  const raw = generatePlanKey();
  return { raw, key: await importPlanKey(raw, { extractable: true }), keyId: await keyIdFor(raw) };
}

const seal = (payload, k) => encodePlanEnvelope(payload, { key: k.key, keyId: k.keyId });

beforeEach(async () => {
  db.resetLocalDb();
  clearPendingPlan();
  await clearDeviceKeys();
});

describe('pairing', () => {
  it('stores a key non-extractably and reports its keyId', async () => {
    const { raw, keyId } = await trackerKey();
    expect(await hasAnyDeviceKey()).toBe(false);

    const keyIdHex = await storeDeviceKey(raw);

    expect(keyIdHex).toBe(keyIdToHex(keyId));
    expect(await hasAnyDeviceKey()).toBe(true);
    const stored = await getDeviceKey(keyIdHex);
    expect(stored.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', stored)).rejects.toThrow();
  });

  it('refuses a pairing payload that is not 32 bytes', async () => {
    await expect(storeDeviceKey(new Uint8Array(16))).rejects.toThrow(/32 key bytes/);
  });

  it('keeps an older key so plans sealed to it still open after re-pairing', async () => {
    const first = await trackerKey();
    const second = await trackerKey();
    const sealedToFirst = await seal(plan(), first);

    await storeDeviceKey(first.raw);
    await storeDeviceKey(second.raw);

    expect((await applyPlanEnvelope(sealedToFirst)).outcome).toBe('applied');
  });
});

describe('applying a plan on a paired device', () => {
  it('creates the account and program, returning a temp PIN', async () => {
    const k = await trackerKey();
    await storeDeviceKey(k.raw);

    const res = await applyPlanEnvelope(await seal(plan(), k));

    expect(res.outcome).toBe('applied');
    expect(res.result.created_account).toBe(true);
    expect(res.result.temp_pin).toMatch(/^\d{4}$/);
    const emp = await db.authenticate('7788', res.result.temp_pin);
    expect(emp.must_change_pin).toBe(true);
  });

  it('is idempotent — re-scanning the same sheet updates rather than duplicates', async () => {
    const k = await trackerKey();
    await storeDeviceKey(k.raw);
    const envelope = await seal(plan(), k);

    const first = await applyPlanEnvelope(envelope);
    const second = await applyPlanEnvelope(envelope);

    expect(second.outcome).toBe('applied');
    expect(second.result.program_id).toBe(first.result.program_id);
    expect(second.result.created_account).toBe(false);
  });

  it('clears any pending plan once one is applied', async () => {
    const k = await trackerKey();
    const envelope = await seal(plan(), k);

    await applyPlanEnvelope(envelope); // unpaired → held
    expect(readPendingPlan()).not.toBeNull();

    await storeDeviceKey(k.raw);
    await applyPlanEnvelope(envelope);
    expect(readPendingPlan()).toBeNull();
  });
});

describe('the pending path', () => {
  it('holds the envelope when the device has no key, and applies it after pairing', async () => {
    const k = await trackerKey();
    const envelope = await seal(plan(), k);

    const scanned = await applyPlanEnvelope(envelope);
    expect(scanned.outcome).toBe('not_paired');
    expect(scanned.keyIdHex).toBe(keyIdToHex(k.keyId));

    // Nothing was written — the plan is unreadable until a key arrives.
    await expect(db.authenticate('7788', '0000')).rejects.toThrow();

    const held = readPendingPlan();
    expect(held.encoded).toBe(envelope);
    expect(held.keyIdHex).toBe(keyIdToHex(k.keyId));

    await storeDeviceKey(k.raw);
    const applied = await applyPlanEnvelope(held.encoded);
    expect(applied.outcome).toBe('applied');
    expect(applied.result.created_account).toBe(true);
  });

  it('stores ciphertext only — the held plan reveals nothing without the key', async () => {
    const k = await trackerKey();
    await applyPlanEnvelope(await seal(plan(), k));

    const held = JSON.stringify(readPendingPlan());
    expect(held).not.toContain('7788');
    expect(held).not.toContain('Fictional');
    expect(held).not.toContain('Bridge');
  });

  it("treats another employee's plan the same as being unpaired", async () => {
    const mine = await trackerKey();
    const theirs = await trackerKey();
    await storeDeviceKey(mine.raw);

    const res = await applyPlanEnvelope(await seal(plan(), theirs));

    // Deliberately indistinguishable from 'not_paired' — a stray sheet must not
    // reveal that it decrypted, or whose it is.
    expect(res.outcome).toBe('not_paired');
  });
});

describe('rejections', () => {
  it('reports an unsupported envelope version without holding the plan', async () => {
    const k = await trackerKey();
    const bytes = Uint8Array.from(atob((await seal(plan(), k)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    bytes[0] = 99;

    const res = await applyPlanEnvelope(toBase64Url(bytes));

    expect(res.outcome).toBe('unsupported_version');
    expect(readPendingPlan()).toBeNull();
  });

  it('reports tampered ciphertext as undecryptable, not as unpaired', async () => {
    const k = await trackerKey();
    await storeDeviceKey(k.raw);
    const bytes = Uint8Array.from(atob((await seal(plan(), k)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;

    expect((await applyPlanEnvelope(toBase64Url(bytes))).outcome).toBe('decrypt_failed');
  });

  it('surfaces validation errors from a well-formed but invalid plan', async () => {
    const k = await trackerKey();
    await storeDeviceKey(k.raw);

    const res = await applyPlanEnvelope(await seal(plan({ exercises: [] }), k));

    expect(res.outcome).toBe('invalid');
    expect(res.errors.join(' ')).toMatch(/exercises/);
  });

  it('rejects a payload whose contract version is unsupported', async () => {
    const k = await trackerKey();
    await storeDeviceKey(k.raw);

    expect((await applyPlanEnvelope(await seal(plan({ schema_version: 99 }), k))).outcome).toBe(
      'unsupported_version',
    );
  });

  it('rejects a code that is not an envelope at all', async () => {
    expect((await applyPlanEnvelope('notarealenvelope')).outcome).toBe('invalid');
  });
});
