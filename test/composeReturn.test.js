/**
 * The phone's half of the return channel: what it holds locally becomes an
 * email the employee can send, and a report a practitioner can open.
 *
 * The adapter tests here run against the real localAdapter, not a stub, so a
 * completion recorded the way the app records it is the completion that ends
 * up in the payload.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { generatePlanKey, importPlanKey, keyIdFor } from '../src/lib/qr/envelope.js';
import {
  composeReturnEmail,
  ensureRecognitionKey,
  hasNothingToSend,
  toReturnPayload,
} from '../src/lib/return/composeReturn.js';
import { extractReturnEnvelopes, openReturnEnvelope } from '../src/lib/return/returnEnvelope.js';
import { isRecognitionKey } from '../src/lib/return/returnValidation.js';
import {
  fetchActiveProgram,
  fetchRecognitionKey,
  fetchReturnEvents,
  reportPain,
  resetLocalDb,
  saveRecognitionKey,
  submitFeedback,
  toggleExerciseComplete,
} from '../src/lib/data/adapters/localAdapter.js';

const RECOGNITION = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

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

async function newKey() {
  const rawKey = generatePlanKey();
  return { keyId: await keyIdFor(rawKey), key: await importPlanKey(rawKey, { extractable: true }) };
}

describe('toReturnPayload', () => {
  it('drops the duplicate a cumulative resend produces', () => {
    const payload = toReturnPayload({
      recognitionKey: RECOGNITION,
      events: {
        completions: [
          { e: 's3', d: '2026-08-24' },
          { e: 's3', d: '2026-08-24' },
          { e: 's3', d: '2026-08-26' },
        ],
      },
    });
    expect(payload.completions).toEqual([
      { e: 's3', d: '2026-08-24' },
      { e: 's3', d: '2026-08-26' },
    ]);
  });

  it('keeps only the newest rating per exercise, since feedback is a standing value', () => {
    const payload = toReturnPayload({
      recognitionKey: RECOGNITION,
      events: {
        feedback: [
          { e: 's3', d: '2026-08-20', v: 'thumbs_down' },
          { e: 's3', d: '2026-08-26', v: 'thumbs_up' },
          { e: 'l1', d: '2026-08-21', v: 'thumbs_up' },
        ],
      },
    });
    expect(payload.feedback).toEqual([
      { e: 'l1', d: '2026-08-21', v: 'thumbs_up' },
      { e: 's3', d: '2026-08-26', v: 'thumbs_up' },
    ]);
  });

  it('treats two pain taps on the same exercise the same day as one fact', () => {
    const payload = toReturnPayload({
      recognitionKey: RECOGNITION,
      events: {
        pain: [
          { e: 'l1', d: '2026-08-26', c: 'pain_during' },
          { e: 'l1', d: '2026-08-26', c: 'pain_during' },
          { e: 'l1', d: '2026-08-26', c: 'pain_after' },
        ],
      },
    });
    expect(payload.pain).toHaveLength(2);
  });

  it('omits empty event lists rather than sending empty arrays', () => {
    const payload = toReturnPayload({
      recognitionKey: RECOGNITION,
      events: { completions: [{ e: 's3', d: '2026-08-24' }], pain: [], feedback: [] },
    });
    expect(payload.pain).toBeUndefined();
    expect(payload.feedback).toBeUndefined();
    expect(hasNothingToSend(payload)).toBe(false);
  });

  it('recognises a device with nothing worth sending', () => {
    expect(hasNothingToSend(toReturnPayload({ recognitionKey: RECOGNITION, events: {} }))).toBe(true);
  });
});

describe('composeReturnEmail', () => {
  it('produces a mailto the admin can paste straight back out', async () => {
    const { key, keyId } = await newKey();
    const payload = toReturnPayload({
      recognitionKey: RECOGNITION,
      planId: 'plan-0001',
      events: { completions: [{ e: 's3', d: '2026-08-24' }] },
    });
    const mail = await composeReturnEmail({
      payload,
      key,
      keyId,
      to: 'eis@example.com',
    });

    expect(mail.mailtoUrl.startsWith('mailto:eis%40example.com?')).toBe(true);
    expect(mail.mailtoUrl).toContain('subject=HMA%20Cadence%20progress%20report');

    // The round trip that matters: decode the mailto, extract, decrypt.
    const body = decodeURIComponent(mail.mailtoUrl.split('&body=')[1]);
    const [envelope] = extractReturnEnvelopes(body);
    await expect(openReturnEnvelope(envelope, key)).resolves.toMatchObject({
      recognition_key: RECOGNITION,
      plan_id: 'plan-0001',
    });
  });

  it('refuses to compose a report with no events, rather than sending an empty one', async () => {
    const { key, keyId } = await newKey();
    const payload = toReturnPayload({ recognitionKey: RECOGNITION, events: {} });
    await expect(composeReturnEmail({ payload, key, keyId })).rejects.toMatchObject({
      name: 'ReturnValidationError',
    });
  });
});

describe('ensureRecognitionKey', () => {
  beforeEach(() => {
    resetLocalDb(SEED_NOW);
  });

  it('mints one on first use and reuses it forever after', async () => {
    expect(await fetchRecognitionKey()).toBeNull();

    const first = await ensureRecognitionKey({ fetchRecognitionKey, saveRecognitionKey });
    expect(isRecognitionKey(first)).toBe(true);

    const second = await ensureRecognitionKey({ fetchRecognitionKey, saveRecognitionKey });
    expect(second).toBe(first);
  });
});

describe('fetchReturnEvents, against the real adapter', () => {
  beforeEach(() => {
    resetLocalDb(SEED_NOW);
  });

  it('turns what the app recorded into contract events keyed by exercise id', async () => {
    // Whoever the seed's first employee is — this is about plumbing, not personas.
    const { employeeId, program } = await seededEmployee();
    const [first, second] = program.assignments;

    await toggleExerciseComplete({
      employeeId,
      programId: program.id,
      assignmentId: first.assignmentId,
      completed: true,
    });
    await reportPain({
      employeeId,
      assignmentId: second.assignmentId,
      programId: program.id,
      category: 'pain_during',
    });
    await submitFeedback({ employeeId, assignmentId: first.assignmentId, rating: 'thumbs_up' });

    const events = await fetchReturnEvents(employeeId);

    expect(events.planId).toBe(program.source_plan_id ?? events.planId);
    expect(events.completions).toContainEqual(
      expect.objectContaining({ e: first.source_exercise_id }),
    );
    expect(events.pain).toContainEqual(
      expect.objectContaining({ e: second.source_exercise_id, c: 'pain_during' }),
    );
    expect(events.feedback).toContainEqual(
      expect.objectContaining({ e: first.source_exercise_id, v: 'thumbs_up' }),
    );
  });

  it('does not report an exercise the employee un-completed', async () => {
    const { employeeId, program } = await seededEmployee();
    const [first] = program.assignments;

    // Compared against a baseline rather than asserting the exercise is absent:
    // the seed holds real historical completions of it, and a cumulative
    // history is supposed to keep those. Only today's toggle should vanish.
    const before = (await fetchReturnEvents(employeeId)).completions;

    await toggleExerciseComplete({
      employeeId,
      programId: program.id,
      assignmentId: first.assignmentId,
      completed: true,
    });
    expect((await fetchReturnEvents(employeeId)).completions.length).toBe(before.length + 1);

    await toggleExerciseComplete({
      employeeId,
      programId: program.id,
      assignmentId: first.assignmentId,
      completed: false,
    });
    expect(await fetchReturnEvents(employeeId).then((e) => e.completions)).toEqual(before);
  });

  it('composes an end-to-end report from recorded activity', async () => {
    const { employeeId, program } = await seededEmployee();
    const { key, keyId } = await newKey();
    await toggleExerciseComplete({
      employeeId,
      programId: program.id,
      assignmentId: program.assignments[0].assignmentId,
      completed: true,
    });

    const recognitionKey = await ensureRecognitionKey({ fetchRecognitionKey, saveRecognitionKey });
    const events = await fetchReturnEvents(employeeId);
    const payload = toReturnPayload({ recognitionKey, planId: events.planId, events });
    const mail = await composeReturnEmail({ payload, key, keyId, to: 'eis@example.com' });

    const [envelope] = extractReturnEnvelopes(mail.body);
    const opened = await openReturnEnvelope(envelope, key);
    expect(opened.recognition_key).toBe(recognitionKey);
    expect(opened.completions.length).toBeGreaterThan(0);
    // The privacy claim, at the far end of the real pipeline.
    expect(opened.name).toBeUndefined();
    expect(opened.employee).toBeUndefined();
  });
});

/** The seed's first employee with an active program, whoever that is. */
async function seededEmployee() {
  const { employees } = await import('../src/lib/data/adapters/localAdapter.js').then(
    async (m) => ({ employees: await m.fetchAdminEmployeeList() }),
  );
  for (const candidate of employees) {
    const program = await fetchActiveProgram(candidate.id);
    if (program?.assignments?.length >= 2) return { employeeId: candidate.id, program };
  }
  throw new Error('Seed has no employee with an active program');
}
