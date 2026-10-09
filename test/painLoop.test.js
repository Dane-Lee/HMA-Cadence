/**
 * The loop back from the employee, as it works since 2026-10-07.
 *
 * - An opened report's pain is FILED into the pain queue. Until now the Reports
 *   page counted it ("2 pain reports") and filed nothing, so the queue -- and the
 *   suite's Deliver light, which counts it -- could never see a real employee.
 * - The Tracker hands a finished plan straight to the Issue page through the
 *   suite's store, and the page takes it exactly once.
 * - No green, on the phone as well (owner: "Yes, change them in the employee's
 *   phone app").
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  fetchActiveProgram,
  fetchAdminEmployeeList,
  fetchUnresolvedPainReports,
  fileReturnPain,
  resetLocalDb,
  resolvePain,
} from '../src/lib/data/adapters/localAdapter.js';
import { HANDOFF_KEY, takeHandoff } from '../src/lib/handoff.js';
import { trackerIndex } from '../tools/tracker-library.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function maria() {
  const list = await fetchAdminEmployeeList();
  const row = list.find((e) => e.employee_number === '4412');
  const program = await fetchActiveProgram(row.id);
  return { id: row.id, exercise: program.assignments[0].source_exercise_id };
}

/** Pain reports filed from returns, as opposed to the seed's own. */
async function filedFromReports() {
  return (await fetchUnresolvedPainReports()).filter((p) => p.reported_at.endsWith('T12:00:00.000Z'));
}

describe('an opened report\'s pain reaches the pain queue', () => {
  beforeEach(() => resetLocalDb(new Date('2026-09-04T12:00:00Z')));

  it('files it against the right person and exercise', async () => {
    const { exercise } = await maria();

    const result = await fileReturnPain({
      employeeNumber: '4412',
      pain: [{ e: exercise, d: '2026-09-02', c: 'pain_during', n: 'left hip' }],
    });

    expect(result).toEqual({ filed: 1, onRoster: true });
    const [filed] = await filedFromReports();
    expect(filed.employee.employee_number).toBe('4412');
    expect(filed.assignment?.exercise).not.toBeNull();
    expect(filed.category).toBe('pain_during');
  });

  it('files nothing new when the same report is pasted again -- they are cumulative', async () => {
    const { exercise } = await maria();
    const pain = [{ e: exercise, d: '2026-09-02', c: 'pain_during' }];

    await fileReturnPain({ employeeNumber: '4412', pain });
    const again = await fileReturnPain({ employeeNumber: '4412', pain });

    expect(again.filed).toBe(0);
    expect(await filedFromReports()).toHaveLength(1);
  });

  it('keeps a followed-up report followed up when the next report repeats it', async () => {
    const { exercise } = await maria();
    const pain = [{ e: exercise, d: '2026-09-02', c: 'pain_during' }];
    await fileReturnPain({ employeeNumber: '4412', pain });
    const [filed] = await filedFromReports();
    await resolvePain(filed.id);

    const next = await fileReturnPain({
      employeeNumber: '4412',
      pain: [...pain, { e: exercise, d: '2026-09-03', c: 'pain_after' }],
    });

    expect(next.filed).toBe(1); // only the new day
    expect((await filedFromReports()).map((p) => p.category)).toEqual(['pain_after']);
  });

  it('says so when the person is not on the roster, rather than guessing who it was', async () => {
    const result = await fileReturnPain({
      employeeNumber: '0000',
      pain: [{ e: 'l1', d: '2026-09-02', c: 'pain_during' }],
    });

    expect(result).toEqual({ filed: 0, onRoster: false });
  });
});

describe('a plan handed over by the Tracker', () => {
  function heldStorage(value) {
    let held = value;
    return {
      get: async (key) => (key === HANDOFF_KEY && held ? { value: held } : null),
      set: async (key, next) => { if (key === HANDOFF_KEY) held = next; },
      peek: () => held,
    };
  }

  it('is taken, and the key is emptied so a reload does not bring it back', async () => {
    const storage = heldStorage(JSON.stringify({ plan_id: 'p-1', employee: { name: 'Fictional Person' } }));

    const plan = await takeHandoff(storage);

    expect(plan.plan_id).toBe('p-1');
    expect(storage.peek()).toBe('');
    expect(await takeHandoff(storage)).toBe(null);
  });

  it('is nothing when nothing was handed over', async () => {
    expect(await takeHandoff(heldStorage(''))).toBe(null);
  });

  it('uses the key the Tracker writes and the suite allows', () => {
    expect(HANDOFF_KEY).toBe('hma-cadence-handoff');
    // Found the way the library generator finds it: either folder name, beside
    // or above Cadence -- the two machines differ in both.
    const index = trackerIndex();
    if (!index) return; // no Tracker clone on this machine
    expect(readFileSync(index, 'utf8')).toContain(`'${HANDOFF_KEY}'`);
  });
});

describe('no green', () => {
  it('is left in the theme, the phone\'s included', () => {
    const theme = readFileSync(`${root}src/styles/theme.css`, 'utf8');
    expect(theme).not.toMatch(/#56c15b/i);
    expect(theme).toMatch(/--success: var\(--text\);/);
  });

  it('keeps the tick in a completed circle visible on either fill', () => {
    const css = readFileSync(`${root}src/styles/app.css`, 'utf8');
    const rule = css.slice(css.indexOf('.exercise-card.is-complete .exercise-card__check {'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('color: var(--bg-card);');
  });
});
