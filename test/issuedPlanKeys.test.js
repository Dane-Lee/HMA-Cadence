import { describe, it, expect, beforeEach } from 'vitest';

import {
  recordIssuedPlanKey,
  fetchIssuedPlanKey,
  listIssuedPlanKeys,
  bindRecognitionKey,
  fetchByRecognitionKey,
} from '../src/lib/data/adapters/localAdapter.js';
import { resetLocalDb } from '../src/lib/data/adapters/localAdapter.js';
import { DATA_LAYER_FUNCTIONS } from '../src/lib/data/contract.js';
import * as adapter from '../src/lib/data/adapters/localAdapter.js';

const KEY_A = 'a1b2c3d4';
const KEY_B = '99887766';
const RAW_A = 'ZmFrZS1rZXktYQ';
const RAW_B = 'ZmFrZS1rZXktYg';

beforeEach(() => {
  resetLocalDb(new Date('2026-09-04T12:00:00Z'));
});

describe('the data-layer contract', () => {
  it('lists every issued-key function, and the adapter implements them', () => {
    for (const name of DATA_LAYER_FUNCTIONS) {
      expect(typeof adapter[name], `${name} missing from the local adapter`).toBe('function');
    }
    expect(DATA_LAYER_FUNCTIONS).toContain('recordIssuedPlanKey');
    expect(DATA_LAYER_FUNCTIONS).toContain('fetchByRecognitionKey');
  });
});

describe('recordIssuedPlanKey', () => {
  it('keeps the raw key, because a return cannot be opened without it', async () => {
    await recordIssuedPlanKey({
      keyId: KEY_A,
      keyB64: RAW_A,
      planId: 'plan-1',
      employeeNumber: '9001',
    });

    const row = await fetchIssuedPlanKey(KEY_A);
    expect(row.keyB64).toBe(RAW_A);
    expect(row.employeeNumber).toBe('9001');
    expect(row.recognitionKey).toBeNull();
  });

  it('refuses a record it could never decrypt with', async () => {
    await expect(recordIssuedPlanKey({ keyId: KEY_A })).rejects.toThrow();
    await expect(recordIssuedPlanKey({ keyB64: RAW_A })).rejects.toThrow();
  });

  it('returns null for a keyId it never issued', async () => {
    expect(await fetchIssuedPlanKey('deadbeef')).toBeNull();
  });

  it('survives a database seeded before the collection existed', async () => {
    // Older stored databases have no issuedPlanKeys array at all. Reading one
    // must be empty, not a crash before the admin app renders.
    expect(await listIssuedPlanKeys()).toEqual([]);
  });
});

describe('re-issuing the same keyId', () => {
  it('refreshes who it went to without losing a learned recognition key', async () => {
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9001' });
    await bindRecognitionKey({ keyId: KEY_A, recognitionKey: 'rk-1' });

    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9002' });

    const row = await fetchIssuedPlanKey(KEY_A);
    expect(row.employeeNumber).toBe('9002');
    expect(row.recognitionKey).toBe('rk-1');
  });

  it('does not create a second row for the same key', async () => {
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A });
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A });

    expect(await listIssuedPlanKeys()).toHaveLength(1);
  });
});

describe('recognition keys', () => {
  it('binds on a first return, then matches directly afterwards', async () => {
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9001' });

    await bindRecognitionKey({ keyId: KEY_A, recognitionKey: 'rk-1' });

    const found = await fetchByRecognitionKey('rk-1');
    expect(found.keyId).toBe(KEY_A);
    expect(found.employeeNumber).toBe('9001');
  });

  it('re-links a reinstall by overwriting, which is the designed behaviour', async () => {
    // A reinstall mints a NEW recognition key. The admin re-links it by keyId on
    // the next return -- self-healing, one send late. Overwriting is correct
    // here, not a conflict to refuse.
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A });
    await bindRecognitionKey({ keyId: KEY_A, recognitionKey: 'rk-old' });

    await bindRecognitionKey({ keyId: KEY_A, recognitionKey: 'rk-new' });

    expect(await fetchByRecognitionKey('rk-new')).not.toBeNull();
    expect(await fetchByRecognitionKey('rk-old')).toBeNull();
  });

  it('does not invent a row for a keyId that was never issued', async () => {
    expect(await bindRecognitionKey({ keyId: 'deadbeef', recognitionKey: 'rk-1' })).toBeNull();
    expect(await listIssuedPlanKeys()).toEqual([]);
  });

  it('never matches on a null recognition key', async () => {
    // Every freshly issued key has recognitionKey === null. A lookup with a
    // missing key must not match the first unbound row and hand a return to the
    // wrong employee.
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9001' });
    await recordIssuedPlanKey({ keyId: KEY_B, keyB64: RAW_B, employeeNumber: '9002' });

    expect(await fetchByRecognitionKey(null)).toBeNull();
    expect(await fetchByRecognitionKey(undefined)).toBeNull();
    expect(await fetchByRecognitionKey('')).toBeNull();
  });
});

describe('isolation between employees', () => {
  it('keeps two issued keys apart', async () => {
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9001' });
    await recordIssuedPlanKey({ keyId: KEY_B, keyB64: RAW_B, employeeNumber: '9002' });

    expect((await fetchIssuedPlanKey(KEY_A)).employeeNumber).toBe('9001');
    expect((await fetchIssuedPlanKey(KEY_B)).employeeNumber).toBe('9002');
    expect(await listIssuedPlanKeys()).toHaveLength(2);
  });

  it('hands back copies, so a caller cannot mutate the store by accident', async () => {
    await recordIssuedPlanKey({ keyId: KEY_A, keyB64: RAW_A, employeeNumber: '9001' });

    const row = await fetchIssuedPlanKey(KEY_A);
    row.employeeNumber = 'tampered';

    expect((await fetchIssuedPlanKey(KEY_A)).employeeNumber).toBe('9001');
  });
});
