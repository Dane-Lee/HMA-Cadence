/**
 * The send action and the state the card renders from.
 *
 * `sendReturn` is the one place that can lose an employee's week, so the cases
 * that must not send at all are tested as carefully as the case that does.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { generatePlanKey } from '../src/lib/qr/envelope.js';
import { clearDeviceKeys, storeDeviceKey } from '../src/lib/qr/keystore.js';
import { prepareReturn, returnSignature, sendReturn } from '../src/lib/return/sendReturn.js';
import { extractReturnEnvelopes, openReturnEnvelope } from '../src/lib/return/returnEnvelope.js';
import { toReturnPayload } from '../src/lib/return/composeReturn.js';
import * as adapter from '../src/lib/data/adapters/localAdapter.js';

const ADDRESS = 'eis@example.com';

/**
 * A fixed seed date, so the suite does not depend on what day it is run.
 *
 * The seed completes exercises on the employee's `completeWeekdays` from this
 * week's Monday through today inclusive. Run on a day the seeded employee
 * completes on, the exercise a test toggles is *already* complete and dated
 * today, the toggle is a no-op, and the assertion fails — which is exactly what
 * happened on Monday 2026-08-31 after passing on Sunday 2026-08-30. Pinning the
 * seed to a Friday in a past week keeps a full Mon-Fri of real history while
 * guaranteeing none of it is dated today.
 */
const SEED_NOW = new Date('2026-06-05T12:00:00Z');

/** The build-time return address, which `returnAddress()` reads. */
function setAddress(value) {
  import.meta.env.VITE_RETURN_ADDRESS = value;
}

async function seededEmployee() {
  const employees = await adapter.fetchAdminEmployeeList();
  for (const candidate of employees) {
    const program = await adapter.fetchActiveProgram(candidate.id);
    if (program?.assignments?.length) return { employeeId: candidate.id, program };
  }
  throw new Error('Seed has no employee with an active program');
}

async function recordSomething() {
  const { employeeId, program } = await seededEmployee();
  await adapter.toggleExerciseComplete({
    employeeId,
    programId: program.id,
    assignmentId: program.assignments[0].assignmentId,
    completed: true,
  });
  return { employeeId, program };
}

describe('prepareReturn status', () => {
  beforeEach(async () => {
    adapter.resetLocalDb(SEED_NOW);
    await clearDeviceKeys();
    setAddress(ADDRESS);
  });

  afterEach(() => {
    setAddress(ADDRESS);
  });

  it('reports unconfigured when the build has no return address', async () => {
    setAddress('');
    const { employeeId } = await recordSomething();
    const state = await prepareReturn({ employeeId, db: adapter });
    expect(state.status).toBe('unconfigured');
  });

  it('reports unsent once there is activity', async () => {
    const { employeeId } = await recordSomething();
    const state = await prepareReturn({ employeeId, db: adapter });
    expect(state.status).toBe('unsent');
  });

  it('reports sent once that activity has gone, and unsent again after more', async () => {
    const { employeeId, program } = await recordSomething();

    const first = await prepareReturn({ employeeId, db: adapter });
    await adapter.markReturnSent({ signature: first.signature });
    expect((await prepareReturn({ employeeId, db: adapter })).status).toBe('sent');

    await adapter.reportPain({
      employeeId,
      assignmentId: program.assignments[0].assignmentId,
      programId: program.id,
      category: 'pain_during',
    });
    expect((await prepareReturn({ employeeId, db: adapter })).status).toBe('unsent');
  });

  it('notices a swap that leaves the event count unchanged', async () => {
    // Why the state is a fingerprint and not a count: completing one exercise
    // and un-completing another nets to zero.
    const { employeeId, program } = await seededEmployee();
    if (program.assignments.length < 2) return;
    const [a, b] = program.assignments;

    await adapter.toggleExerciseComplete({
      employeeId, programId: program.id, assignmentId: a.assignmentId, completed: true,
    });
    const first = await prepareReturn({ employeeId, db: adapter });
    await adapter.markReturnSent({ signature: first.signature });

    await adapter.toggleExerciseComplete({
      employeeId, programId: program.id, assignmentId: a.assignmentId, completed: false,
    });
    await adapter.toggleExerciseComplete({
      employeeId, programId: program.id, assignmentId: b.assignmentId, completed: true,
    });

    const after = await prepareReturn({ employeeId, db: adapter });
    expect(after.payload.completions).toHaveLength(first.payload.completions.length);
    expect(after.status).toBe('unsent');
  });
});

describe('sendReturn', () => {
  beforeEach(async () => {
    adapter.resetLocalDb(SEED_NOW);
    await clearDeviceKeys();
    setAddress(ADDRESS);
  });

  it('refuses, without opening anything, when the phone is not paired', async () => {
    const { employeeId } = await recordSomething();
    const openUrl = vi.fn();

    const result = await sendReturn({ employeeId, db: adapter, openUrl });

    expect(result).toMatchObject({ ok: false, reason: 'unpaired' });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('refuses when the build has no return address', async () => {
    setAddress('');
    const { employeeId } = await recordSomething();
    const openUrl = vi.fn();

    expect(await sendReturn({ employeeId, db: adapter, openUrl })).toMatchObject({
      ok: false,
      reason: 'unconfigured',
    });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('refuses when nothing has been recorded', async () => {
    await storeDeviceKey(generatePlanKey());
    const openUrl = vi.fn();

    // An employee with no events of any kind. Deliberately not a seeded one:
    // the seed ships real history, so using it would make this test pass or
    // skip depending on demo data rather than on the guard being there.
    const result = await sendReturn({ employeeId: 'nobody-at-all', db: adapter, openUrl });

    expect(result).toMatchObject({ ok: false, reason: 'empty' });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('opens a mailto the practitioner can open, and records the hand-off', async () => {
    const rawKey = generatePlanKey();
    await storeDeviceKey(rawKey);
    const { employeeId } = await recordSomething();
    const openUrl = vi.fn();

    const result = await sendReturn({ employeeId, db: adapter, openUrl });

    expect(result.ok).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(1);
    const url = openUrl.mock.calls[0][0];
    expect(url.startsWith('mailto:eis%40example.com?')).toBe(true);

    // The hand-off is recorded, so the card stops asking.
    expect((await prepareReturn({ employeeId, db: adapter })).status).toBe('sent');

    // And the thing it opened is genuinely readable at the other end.
    const body = decodeURIComponent(url.split('&body=')[1]);
    const [envelope] = extractReturnEnvelopes(body);
    const opened = await openReturnEnvelope(envelope, await keyFor(rawKey));
    expect(opened.completions.length).toBeGreaterThan(0);
    expect(opened.name).toBeUndefined();
  });

  it('encrypts to the newest key after a re-pair, not the first', async () => {
    await storeDeviceKey(generatePlanKey());
    // A re-assessment mints a new plan key and the phone pairs again.
    const newest = generatePlanKey();
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct pairedAt
    await storeDeviceKey(newest);

    const { employeeId } = await recordSomething();
    const openUrl = vi.fn();
    await sendReturn({ employeeId, db: adapter, openUrl });

    const body = decodeURIComponent(openUrl.mock.calls[0][0].split('&body=')[1]);
    const [envelope] = extractReturnEnvelopes(body);
    await expect(openReturnEnvelope(envelope, await keyFor(newest))).resolves.toBeTruthy();
  });
});

describe('returnSignature', () => {
  it('ignores the timestamp, which changes on every build', () => {
    const events = { completions: [{ e: 's3', d: '2026-08-24' }] };
    const a = toReturnPayload({ recognitionKey: 'x', events, generatedAt: '2026-08-24T00:00:00Z' });
    const b = toReturnPayload({ recognitionKey: 'x', events, generatedAt: '2026-08-29T00:00:00Z' });
    expect(returnSignature(a)).toBe(returnSignature(b));
  });
});

async function keyFor(rawKey) {
  const { importPlanKey } = await import('../src/lib/qr/envelope.js');
  return importPlanKey(rawKey, { extractable: true });
}
