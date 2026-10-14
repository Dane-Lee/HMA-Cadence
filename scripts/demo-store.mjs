/**
 * Cadence-Admin's store for the suite's management demo, built by Cadence's own
 * code: `node scripts/demo-store.mjs < spec.json > store.json`
 *
 * The suite's demo seed (HMA-Manual/api_manual/demo_seed.py) calls this. The
 * owner asked for a demo "with made-up info" (ONE-APP-PLAN §10), and a made-up
 * store written by hand would drift from the real one the first time either
 * changed. So every plan goes through `ingestPlan` -- what the Issue and Import
 * pages run -- and every pain report through `fileReturnPain` -- what the
 * Reports page runs. Only the completions are laid down directly, in the shape
 * `localSeed.js` lays them down, because the function the phone uses records
 * "today" for whoever is signed in on it.
 *
 * The spec (stdin):
 *   plans     plan payloads as the Tracker's "→ Cadence" builds them. Each
 *             exercise's name, category, type and duration may be left out:
 *             they are filled from Cadence's bundled library, which is generated
 *             from the Tracker's, and the prescription is checked against it.
 *   activity  [{ employee_number, days: [{ date, all }] }] -- `all: false` is a
 *             day the employee stopped halfway, as the seed's lapsed persona does
 *   pain      [{ employee_number, e, d, c, n }] -- the report's own pain events
 *
 * Exits non-zero, naming the problem, rather than writing a store that is wrong.
 */
import { adoptStore, fileReturnPain, ingestPlan } from '../src/lib/data/adapters/localAdapter.js';
import { EXERCISE_BY_ID } from '../src/lib/data/exerciseLibrary.js';
import { buildSeedDb as buildEmptyDb } from '../src/lib/data/localSeed.none.js';

function fail(message) {
  process.stderr.write(`demo-store: ${message}\n`);
  process.exit(1);
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const spec = JSON.parse(raw);

// Start from nothing -- in Node the adapter falls back to the fictional seed --
// and catch every save, which is the store itself.
let held = null;
adoptStore(buildEmptyDb(), (next) => { held = next; });

for (const plan of spec.plans ?? []) {
  for (const ex of plan.exercises) {
    const known = EXERCISE_BY_ID.get(ex.source_exercise_id);
    if (!known) fail(`plan ${plan.plan_id}: no exercise ${ex.source_exercise_id} in Cadence's library`);
    if (ex.default_prescription !== known.default_prescription) {
      fail(`${ex.source_exercise_id}: the seed says "${ex.default_prescription}", the library "${known.default_prescription}"`);
    }
    ex.name ??= known.name;
    ex.movement_category ??= known.movement_category;
    ex.exercise_type ??= known.exercise_type;
    ex.duration_sec ??= known.duration_sec ?? 0;
  }
  const result = await ingestPlan(plan);
  if (result.unresolved_exercises.length) {
    fail(`plan ${plan.plan_id}: Cadence's library does not know ${result.unresolved_exercises.join(', ')}`);
  }
}
if (!held) fail('no plans: nothing to build');

const isoDow = (date) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

for (const { employee_number, days } of spec.activity ?? []) {
  const emp = held.employees.find((e) => e.employee_number === employee_number && e.role === 'employee');
  if (!emp) fail(`activity for ${employee_number}, who has no plan`);
  const program = held.programs.find((p) => p.employee_id === emp.id && p.status === 'active');
  const assignments = held.exercise_assignments.filter((a) => a.program_id === program.id);
  for (const { date, all } of days) {
    const scheduled = assignments.filter((a) => a.days.includes(isoDow(date)));
    if (!scheduled.length) fail(`${employee_number} has nothing scheduled on ${date}`);
    const done = all ? scheduled : scheduled.slice(0, Math.ceil(scheduled.length / 2));
    const checkInId = `ci-${emp.id}-${date}`;
    held.check_ins.push({
      id: checkInId, employee_id: emp.id, program_id: program.id,
      date, completed_at: `${date}T12:00:00Z`, ended_early: false,
    });
    for (const a of done) {
      held.exercise_completions.push({
        id: `ec-${a.id}-${date}`, check_in_id: checkInId,
        exercise_assignment_id: a.id, completed: true, completed_at: `${date}T12:00:00Z`,
      });
    }
  }
}

for (const { employee_number, ...event } of spec.pain ?? []) {
  const { filed, onRoster } = await fileReturnPain({ employeeNumber: employee_number, pain: [event] });
  if (!onRoster || filed !== 1) fail(`pain for ${employee_number} was not filed`);
}

process.stdout.write(JSON.stringify(held));
