import { describe, it, expect } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_LIBRARY, EXERCISE_LIBRARY_SIZE } from '../src/lib/data/exerciseLibrary.js';
import { readCatalogue, trackerIndex } from '../tools/tracker-library.mjs';
import { buildPlanQr } from '../src/lib/qr/planQr.js';

/**
 * The bundled library must not drift from the Tracker.
 *
 * This is the alarm the owner asked for when he reversed E12 on 2026-09-15:
 * *"we would need to have something, somewhere to trigger a full assessment
 * suite update if any exercises were to be added to the Tracker."* The plan QR
 * now carries identity and dosage and Cadence resolves the name, the
 * instructions and the picture from here -- so an exercise added to the Tracker
 * and not regenerated here reaches an employee's phone as a name with nothing
 * under it.
 *
 * That failure is quiet and it is on the wrong machine to notice. It looks like
 * a rendering bug on a phone, days later, and the person holding the phone
 * cannot tell a missing library entry from a broken app.
 *
 * TWO KINDS OF CHECK, because they are available at different times. The drift
 * check needs the Tracker cloned beside Cadence and says so plainly when it is
 * not -- *"deps not installed here"* is a fact and silence is not (CLAUDE.md).
 * The shape checks run everywhere, including on a machine that only has this
 * repo, and they are what catches a generated file that was committed empty or
 * half-written.
 */

const indexPath = trackerIndex();

describe('the bundled exercise library', () => {
  it('covers every exercise the Tracker can put in a plan', () => {
    if (!indexPath) {
      // Recorded rather than skipped silently. A check that could not run must
      // say so; the shape checks below still carry real weight here.
      console.warn(
        'SKIPPED: the Tracker is not cloned beside this repo, so drift cannot be checked here.',
      );
      return;
    }
    const catalogue = readCatalogue(indexPath);

    expect(EXERCISE_LIBRARY.map((e) => e.source_exercise_id).sort()).toEqual(
      catalogue.map((e) => e.source_exercise_id).sort(),
    );
  });

  it('matches the Tracker field for field, not merely id for id', () => {
    /* Ids agreeing proves nothing about the text. An instruction edited in the
     * Tracker and not regenerated here would leave the phone showing the OLD
     * wording, which is worse than showing none: it is confidently wrong, and
     * nothing about it looks stale. */
    if (!indexPath) {
      console.warn('SKIPPED: the Tracker is not cloned beside this repo.');
      return;
    }
    const catalogue = readCatalogue(indexPath);
    const bundled = new Map(EXERCISE_LIBRARY.map((e) => [e.source_exercise_id, e]));

    const drifted = catalogue.filter((entry) => {
      const held = bundled.get(entry.source_exercise_id);
      return !held || JSON.stringify(held) !== JSON.stringify(entry);
    });

    expect(
      drifted.map((e) => e.source_exercise_id),
      'run `node tools/generate-exercise-library.mjs --write`',
    ).toEqual([]);
  });

  it('gives every exercise something for the phone to show', () => {
    /* The entire reason the library exists. An entry without instructions is an
     * exercise an employee is told to do with no description of how. */
    const empty = EXERCISE_LIBRARY.filter((e) => !e.instructions || !e.name);
    expect(empty.map((e) => e.source_exercise_id)).toEqual([]);
  });

  it('is not empty, and is the size it claims', () => {
    /* Guards the generated file being committed truncated or half-written --
     * the failure mode that would make every other check here vacuous. */
    expect(EXERCISE_LIBRARY.length).toBeGreaterThan(30);
    expect(EXERCISE_LIBRARY.length).toBe(EXERCISE_LIBRARY_SIZE);
  });

  it('has no duplicate ids, because the id is the join key', () => {
    const ids = EXERCISE_LIBRARY.map((e) => e.source_exercise_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indexes every entry by id', () => {
    expect(EXERCISE_BY_ID.size).toBe(EXERCISE_LIBRARY.length);
    for (const entry of EXERCISE_LIBRARY) {
      expect(EXERCISE_BY_ID.get(entry.source_exercise_id)).toBe(entry);
    }
  });

  it('names a movement category the contract recognises', () => {
    /* The categories are what Cadence groups a programme by. A picker key that
     * leaked through unmapped would put an exercise in a category no screen
     * renders. */
    const allowed = new Set([
      'lunge',
      'single_leg_dip',
      'shoulder_reach',
      'trunk_rotation',
      'cervical_rotation',
    ]);
    const stray = EXERCISE_LIBRARY.filter((e) => !allowed.has(e.movement_category));
    expect(stray.map((e) => `${e.source_exercise_id}:${e.movement_category}`)).toEqual([]);
  });

  it('stores exercise types in key form, not with spaces', () => {
    /* `buildPlanPayload` emits `static_stabilization`; the Tracker's own table
     * stores "static stabilization". Getting this wrong would not break
     * anything visibly -- it would just stop every type-based comparison
     * matching. */
    const spaced = EXERCISE_LIBRARY.filter((e) => /\s/.test(e.exercise_type));
    expect(spaced.map((e) => e.source_exercise_id)).toEqual([]);
  });
});

describe('the whole library still fits in one plan QR', () => {
  /* The invariant reversing E12 bought, asserted rather than remembered.
   *
   * Before the reversal a plan capped at 11-14 exercises and `/admin/issue`
   * refused past it. After, the entire library fits -- but only just: around
   * **110 bytes of headroom at 44 exercises**, which is roughly one more
   * exercise. Adding two or three to the Tracker would quietly restore a
   * ceiling, and the symptom would be identical to the original bug: an EIS
   * discovering at the printer that a plan cannot be issued.
   *
   * The exact figure moves by a few bytes with the plan_id and the dates, so
   * this prints what it measured rather than asserting a number --
   * `tools/measure-plan-capacity.mjs` is the authority and reported 106 on
   * 2026-09-15. What is asserted is the thing that matters: headroom > 0.
   *
   * A real plan is far smaller -- the 20-minute session budget puts it at 3-8
   * exercises -- so this is a margin check, not a daily risk. It exists because
   * the margin is invisible: nothing about adding an exercise to the Tracker
   * suggests it might make some other plan unissuable.
   *
   * It uses the real `buildPlanQr`, the same function `/admin/issue` calls.
   */
  it('reports its own headroom, and fails before an admin would', async () => {
    if (!indexPath) {
      console.warn('SKIPPED: the Tracker is not cloned beside this repo.');
      return;
    }

    const exercises = EXERCISE_LIBRARY.map((entry, i) => ({
      source_exercise_id: entry.source_exercise_id,
      name: entry.name,
      movement_category: entry.movement_category,
      exercise_type: entry.exercise_type,
      default_prescription: entry.default_prescription,
      prescription_override: null,
      duration_sec: entry.duration_sec,
      days: [[1, 3, 5], [2, 4], [1, 2, 3, 4, 5], [1, 4]][i % 4],
      sort_order: i,
    }));

    const payload = {
      schema_version: 1,
      plan_id: 'headroom-probe',
      generated_at: '2026-09-16T12:00:00.000Z',
      source: { app: 'hma-tracker', version: 'headroom-probe' },
      employee: {
        employee_number: '4412', first_name: 'Alex', last_name: 'Rivera', name: 'Alex Rivera',
        company: 'Hendrickson', department: 'Weld', shift: '1st', location: 'Somerset, KY',
      },
      assessment: {
        assessment_date: '2026-09-16', assessment_type: 'Initial', total_score: 8,
        follow_up_date: '2026-10-28', reassessment_date: '2026-10-14', notes: '',
      },
      schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
      exercises,
    };

    let result;
    try {
      result = await buildPlanQr(payload, { baseUrl: 'https://hma-cadence.vercel.app' });
    } catch (error) {
      throw new Error(
        `A plan containing the whole ${exercises.length}-exercise library can no longer be `
        + `issued (${error.code ?? error.message}). The ceiling E12's reversal removed is back. `
        + 'Run `node tools/measure-plan-capacity.mjs` to see where it now falls.',
      );
    }

    // Reported on every run, so the margin shrinking is visible before it bites.
    console.log(`    whole library: ${exercises.length} exercises, ${result.planBytes} bytes, ${result.headroom} spare`);
    expect(result.headroom).toBeGreaterThan(0);
  });
});
