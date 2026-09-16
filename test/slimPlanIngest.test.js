import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as db from '../src/lib/data/adapters/localAdapter.js';
import { EXERCISE_BY_ID } from '../src/lib/data/exerciseLibrary.js';

/**
 * A plan that carries no exercise text still renders a full programme.
 *
 * This is decision E12 reversed (owner, 2026-09-15). The QR used to hold every
 * exercise's full instructions, and that put a hard ceiling of 11-14 exercises
 * on a plan -- past which `/admin/issue` refused to issue at all. The payload
 * now carries identity and dosage and Cadence resolves the words and the
 * picture from `exerciseLibrary.js`, which is generated from the Tracker.
 *
 * WHAT THESE TESTS ARE REALLY PINNING is the compatibility rule, because it is
 * the part that is easy to get backwards and expensive to get wrong:
 *
 *   * a SLIM plan resolves from the library -- the new normal;
 *   * a LEGACY plan keeps its own text -- an already-issued QR in someone's
 *     pocket must not change meaning because the app was updated;
 *   * an UNKNOWN id costs that one exercise and not the whole programme.
 *
 * The last one is a judgement worth stating. Refusing the plan outright would
 * be tidier and would cost an employee their other seven exercises for the sake
 * of one the library has not caught up with. It is reported to the caller
 * instead, so the failure lands on the admin who can fix it rather than on the
 * person holding the phone.
 */

const REAL_ID = 'l1';
const OTHER_ID = 's3';

function plan(exercises, overrides = {}) {
  return {
    schema_version: 1,
    plan_id: 'slim-plan-1',
    generated_at: '2026-09-15T12:00:00.000Z',
    employee: { employee_number: '7700', name: 'Sam Okafor' },
    assessment: { assessment_date: '2026-09-15', assessment_type: 'Initial', total_score: 9 },
    schedule: { work_days: [1, 3, 5], session_budget_sec: 1200 },
    exercises,
    ...overrides,
  };
}

/** What the Tracker will emit once it stops sending text: identity + dosage. */
function slimExercise(id, sortOrder = 0) {
  const known = EXERCISE_BY_ID.get(id);
  return {
    source_exercise_id: id,
    name: known.name,
    movement_category: known.movement_category,
    exercise_type: known.exercise_type,
    default_prescription: known.default_prescription,
    prescription_override: null,
    duration_sec: known.duration_sec,
    days: [1, 3, 5],
    sort_order: sortOrder,
  };
}

/** The assignment as a screen would receive it.
 *
 *  `fetchActiveProgram` spreads the library row into each assignment, so this
 *  is the resolved content itself rather than a peek at internal state -- if
 *  the resolution broke, this is exactly what an employee's phone would show. */
async function assignment(result, id) {
  const program = await db.fetchActiveProgram(result.employee_id);
  return program.assignments.find((a) => a.source_exercise_id === id);
}

beforeEach(() => {
  db.resetLocalDb();
});

describe('a slim plan resolves its content from the bundled library', () => {
  it('gives the employee real instructions the QR never carried', async () => {
    const known = EXERCISE_BY_ID.get(REAL_ID);
    expect(known.instructions, 'precondition: the library has text for this id').toBeTruthy();

    const result = await db.ingestPlan(plan([slimExercise(REAL_ID)]));

    expect((await assignment(result, REAL_ID)).description).toBe(known.instructions);
  });

  it('reports nothing unresolved for a plan the library fully covers', async () => {
    const result = await db.ingestPlan(
      plan([slimExercise(REAL_ID, 0), slimExercise(OTHER_ID, 1)]),
    );

    expect(result.unresolved_exercises).toEqual([]);
  });

  it('applies the plan at all, which is the whole point of the ceiling being gone', async () => {
    /* A plan holding the entire library. Under the old contract this could not
     * be issued: 15 exercises was refused outright. */
    const everyId = [...EXERCISE_BY_ID.keys()];
    expect(everyId.length).toBeGreaterThan(30);

    const result = await db.ingestPlan(plan(everyId.map((id, i) => slimExercise(id, i))));
    const program = await db.fetchActiveProgram(result.employee_id);

    expect(result.status).toBe('applied');
    expect(result.unresolved_exercises).toEqual([]);
    expect(program.assignments).toHaveLength(everyId.length);
  });
});

describe('an already-issued plan does not change meaning', () => {
  it('keeps the text the payload carried, rather than replacing it from the library', async () => {
    /* A sheet printed before this change is in somebody's pocket. Its QR holds
     * the instructions the employee was actually given, and those are what they
     * must keep seeing -- the library is a fallback, not an override. */
    const result = await db.ingestPlan(
      plan([{ ...slimExercise(REAL_ID), instructions: 'Text as printed on the sheet.' }]),
    );
    const row = await assignment(result, REAL_ID);

    expect(row.description).toBe('Text as printed on the sheet.');
    expect(row.content_source).toBe('payload');
  });

  it('records where each row got its content, because afterwards they look alike', async () => {
    const result = await db.ingestPlan(plan([slimExercise(REAL_ID)]));

    expect((await assignment(result, REAL_ID)).content_source).toBe('library');
  });
});

describe('an exercise the library does not know', () => {
  it('costs that one exercise and not the whole programme', async () => {
    const result = await db.ingestPlan(
      plan([
        slimExercise(REAL_ID, 0),
        {
          source_exercise_id: 'zz99',
          name: 'Something Added To The Tracker Yesterday',
          movement_category: 'lunge',
          exercise_type: 'strength',
          default_prescription: '3x10',
          duration_sec: 200,
          days: [1, 3, 5],
          sort_order: 1,
        },
      ]),
    );
    const program = await db.fetchActiveProgram(result.employee_id);

    expect(result.status).toBe('applied');
    expect(program.assignments).toHaveLength(2);
  });

  it('is reported, so the admin who issued it finds out rather than the employee', async () => {
    const result = await db.ingestPlan(
      plan([slimExercise(REAL_ID, 0), { ...slimExercise(REAL_ID, 1), source_exercise_id: 'zz99' }]),
    );

    expect(result.unresolved_exercises).toEqual(['zz99']);
  });

  it('still shows the name it was given, rather than nothing at all', async () => {
    const result = await db.ingestPlan(
      plan([
        {
          source_exercise_id: 'zz99',
          name: 'Something New',
          movement_category: 'lunge',
          exercise_type: 'strength',
          default_prescription: '3x10',
          duration_sec: 200,
          days: [1],
          sort_order: 0,
        },
      ]),
    );
    const row = await assignment(result, 'zz99');

    expect(row.name).toBe('Something New');
    expect(row.description).toBeNull();
    expect(row.content_source).toBe('missing');
  });
});

describe('the unresolved list has a reader', () => {
  /* `ingestPlan` reporting `unresolved_exercises` is only worth anything if
   * something shows it. It did not, for a day: the receiver computed the list
   * and every screen ignored it, which is the same failure as a log nobody
   * reads -- the work looks done and the information reaches no one.
   *
   * Source-level, and that is a stated limitation rather than a gloss: Cadence's
   * suite runs in node with no DOM, so there is nothing here that can render a
   * component. What this catches is the reader being deleted or renamed, which
   * is the realistic way it would regress.
   */
  const root = new URL('..', import.meta.url);
  const read = (p) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

  it('the admin import screen reads the unresolved list', () => {
    expect(read('src/pages/AdminImportPlan.jsx')).toContain('unresolved_exercises');
  });

  it('it is shown to the admin, who is the only one who can fix it', () => {
    /* Not to the employee. The fix is regenerating the library and redeploying,
     * and an employee holding a phone can do neither -- telling them would be
     * alarming and useless in equal measure. */
    const page = read('src/pages/AdminImportPlan.jsx');
    expect(page).toMatch(/generate-exercise-library/);
    expect(read('src/pages/ScanPlan.jsx')).not.toContain('unresolved_exercises');
  });

  it('the class it renders with is actually styled', () => {
    /* An unstyled warning block is invisible against the success panel it sits
     * inside, which would be the same bug one layer down. */
    expect(read('src/styles/app.css')).toContain('.import-result__warn');
  });
});
