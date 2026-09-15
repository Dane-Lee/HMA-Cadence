import { describe, it, expect } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_LIBRARY, EXERCISE_LIBRARY_SIZE } from '../src/lib/data/exerciseLibrary.js';
import { readCatalogue, trackerIndex } from '../tools/tracker-library.mjs';

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
