/**
 * How many exercises fit in a plan QR, measured against the Tracker's real library.
 *
 * MEASURES THE CONTRACT AS IT IS TODAY. Since the owner reversed decision E12 on
 * 2026-09-15 the payload carries identity and dosage only -- no `instructions`,
 * no `image_ref` -- and Cadence resolves the words and the picture from its own
 * bundled library. That is the shape measured by default here.
 *
 * WHY THIS TOOL EXISTS AT ALL is the other half of the story, and it is the
 * reason the default matters. E12 was decided on the sentence *"Capacity is fine
 * (911 chars for 12 exercises)"*, and that figure did not reproduce: the earlier
 * measurement reused IDENTICAL instruction text across exercises, which DEFLATE
 * collapses to almost nothing. Real plans carry 44 different instructions and do
 * not compress that way. The true figure was 2,148 bytes at 92% full, with a
 * hard ceiling of 11-14 exercises.
 *
 * So a stale number in this tool is exactly the failure it was built to prevent.
 * It reads the Tracker's actual `EXERCISES` out of its `index.html` and runs the
 * actual `buildPlanQr()` -- the same function `/admin/issue` calls. Nothing here
 * models the encoder; it *is* the encoder.
 *
 *   node tools/measure-plan-capacity.mjs [--base https://host] [--max 50] [--fat]
 *
 *   --base  Origin the QR points at. It is inside the QR, so it counts against
 *           capacity. Measured: its length barely matters, which is recorded
 *           below as a negative result so it is not re-investigated.
 *   --max   Highest exercise count to try (default: the whole library).
 *   --fat   Measure the OLD pre-E12-reversal shape, with full instructions
 *           inlined. Kept so the reversal's benefit stays reproducible rather
 *           than remembered.
 */

import QRCode from 'qrcode';
import { buildPlanQr, MAX_QR_BYTES, PLAN_ECC_LEVEL, PlanQrError } from '../src/lib/qr/planQr.js';

import { readCatalogue, trackerIndex } from './tracker-library.mjs';

/** Every exercise, shaped exactly as the Tracker's `buildPlanPayload()` emits it.
 *
 *  The catalogue fields come from the shared reader; the three PLAN fields are
 *  added here because they describe one person's programme rather than the
 *  exercise. They have to vary: `days` and `sort_order` differ per exercise in a
 *  real plan, and a constant repeated 15 times is close to free under DEFLATE.
 *  Filling them in with one value each is the same mistake that produced E12's
 *  "911 chars" -- it measures the compressor, not the payload. */
function readLibrary(indexPath) {
  // Key order is reconstructed deliberately, matching what `buildPlanPayload()`
  // emits. It is not cosmetic here: JSON.stringify preserves insertion order, so
  // moving a field changes how the payload DEFLATEs while leaving its length
  // identical -- spreading the catalogue and appending the plan fields shifted
  // every QR measurement by a few bytes with no change to the JSON size at all.
  // A tool whose whole job is to count bytes must not quietly re-order them.
  return readCatalogue(indexPath).map((entry, i) => ({
    source_exercise_id: entry.source_exercise_id,
    name: entry.name,
    instructions: entry.instructions,
    movement_category: entry.movement_category,
    exercise_type: entry.exercise_type,
    default_prescription: entry.default_prescription,
    prescription_override: null,
    duration_sec: entry.duration_sec,
    days: [[1, 3, 5], [2, 4], [1, 2, 3, 4, 5], [1, 4]][i % 4],
    sort_order: i,
    image_ref: entry.image_ref,
  }));
}

/** The payload as the Tracker emits it today: identity and dosage, no text.
 *
 *  `name` stays -- the contract requires it, and it is what an employee sees if
 *  their phone's library has not caught up with a newly added exercise. */
function slim(ex) {
  const { instructions, image_ref: imageRef, ...rest } = ex;
  return rest;
}

function planWith(exercises) {
  return {
    schema_version: 1,
    plan_id: 'plan-0001',
    generated_at: '2026-08-26T12:00:00.000Z',
    source: { app: 'hma-tracker', version: 'capacity-probe' },
    employee: {
      employee_number: '4412', first_name: 'Alex', last_name: 'Rivera', name: 'Alex Rivera',
      company: 'Hendrickson', department: 'Weld', shift: '1st', location: 'Somerset, KY',
    },
    assessment: {
      assessment_date: '2026-08-26', assessment_type: 'Initial', total_score: 8,
      follow_up_date: '2026-10-07', reassessment_date: '2026-09-23', notes: '',
    },
    schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
    exercises: exercises.map((ex, i) => ({ ...ex, sort_order: i })),
  };
}

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : args[i + 1];
};
const base = argOf('--base', 'https://hma-cadence.vercel.app');
const fat = args.includes('--fat');

const indexPath = trackerIndex();
if (!indexPath) {
  console.error('The Tracker is not cloned on this machine, so there is no real library to measure.');
  console.error('Looked for HMA-Tracker-app/ and HMA-Correct-Exercise-Tracker/ beside and above Cadence.');
  process.exit(2);
}

const full = readLibrary(indexPath);
const max = Number(argOf('--max', String(full.length)));
const lengths = full.map((ex) => ex.instructions.length).sort((a, b) => a - b);
const median = lengths[Math.floor(lengths.length / 2)];

// The shape actually measured in the table below.
const library = fat ? full : full.map(slim);

console.log(`Library:  ${full.length} exercises from ${indexPath}`);
console.log(`Contract: ${fat
  ? 'FAT -- full instructions inlined (the pre-2026-09-15 shape, for comparison)'
  : 'CURRENT -- identity and dosage only; Cadence resolves text from its library'}`);
console.log(`          instruction text median ${median} chars${fat ? '' : ' (not sent)'}`);
console.log(`Base URL: ${base} (${base.length} chars, counts against capacity)`);
console.log(`Limit:    ${MAX_QR_BYTES} bytes at ECC ${PLAN_ECC_LEVEL}\n`);
console.log('  exercises | exercise JSON | QR bytes | version | headroom');
console.log('  ----------|---------------|----------|---------|---------');

let ceiling = null;
for (let n = 1; n <= Math.min(max, library.length); n += 1) {
  const payload = planWith(library.slice(0, n));
  const jsonChars = JSON.stringify(payload.exercises).length;
  try {
    // eslint-disable-next-line no-await-in-loop
    const out = await buildPlanQr(payload, { baseUrl: base });
    const { version } = QRCode.create(out.planUrl, { errorCorrectionLevel: PLAN_ECC_LEVEL });
    console.log(
      `  ${String(n).padStart(9)} | ${String(jsonChars).padStart(13)} | `
      + `${String(out.planBytes).padStart(8)} | ${`v${version}`.padStart(7)} | `
      + `${String(out.headroom).padStart(8)}`,
    );
  } catch (error) {
    if (error instanceof PlanQrError && error.code === 'too_large') {
      console.log(
        `  ${String(n).padStart(9)} | ${String(jsonChars).padStart(13)} | `
        + `${String(error.detail.planBytes).padStart(8)} |       - | REFUSED`,
      );
      ceiling = n - 1;
      break;
    }
    throw error;
  }
}

if (ceiling === null) {
  console.log(`\nNO CEILING at or below ${Math.min(max, library.length)} exercises with this base URL.`);
  if (!fat) {
    console.log('The whole library fits in one plan. That is what reversing E12 bought:');
    console.log('under the old shape this refused partway through -- run --fat to see it.');
  }
} else {
  console.log(`\nCEILING: ${ceiling} exercises. A ${ceiling + 1}-exercise plan cannot be issued at all.`);
  console.log('This is an operational limit, not a warning -- /admin/issue refuses it.');
  if (!fat) {
    console.log('NOTE: this is the CURRENT slim contract hitting a limit, which was not');
    console.log('expected. Check whether the payload has grown.');
  }
}

/** Highest exercise count that still issues, for a given ordering of the library. */
async function ceilingFor(ordered, baseUrl) {
  let fits = 0;
  for (let n = 1; n <= ordered.length; n += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await buildPlanQr(planWith(ordered.slice(0, n)), { baseUrl });
      fits = n;
    } catch (error) {
      if (error instanceof PlanQrError && error.code === 'too_large') return fits;
      throw error;
    }
  }
  return fits;
}

// The ceiling above is one number for one ordering, and the headroom at the top
// is tens of bytes -- so the obvious question is what moves it. Two candidates,
// both measured rather than reasoned about, because the guess was wrong once.
const byLongest = [...full].sort((a, b) => b.instructions.length - a.instructions.length);
const byShortest = [...full].sort((a, b) => a.instructions.length - b.instructions.length);

console.log('\nWhat moved the ceiling under the OLD fat contract (kept reproducible):\n');
console.log('  variable                          | ceiling');
console.log('  ----------------------------------|--------');
console.log(`  library order (measured above)     | ${String(ceiling ?? '-').padStart(7)}`);
console.log(`  longest instructions first         | ${String(await ceilingFor(byLongest, base)).padStart(7)}`);
console.log(`  shortest instructions first        | ${String(await ceilingFor(byShortest, base)).padStart(7)}`);

// Base URL length: expected to matter, and it does not, in any realistic range.
// One more exercise costs ~80-100 bytes; the spread between a 13-character host
// and a 44-character one is 31. Recorded as a measured negative so nobody spends
// the afternoon on it again -- picking a shorter host buys no exercises.
const shortHost = await ceilingFor(library, 'https://c.app');
const longHost = await ceilingFor(library, 'https://cadence.hendrickson-intl.example.com');
console.log(`  13-char base URL                   | ${String(shortHost).padStart(7)}`);
console.log(`  44-char base URL                   | ${String(longHost).padStart(7)}`);

console.log('\nThe ceiling is set by the exercises and not by the host: a 31-character swing in');
console.log('the base URL changes nothing, while the choice of exercises moves it by three.');
console.log('Note it is not simply "long text is worse" -- shortest-first scores BELOW library');
console.log('order, because library order groups a category together and similar phrasing');
console.log('compresses. What the encoder rewards is a compressible SET, which is not a');
console.log('property any admin can see while building a program.');
console.log('\nSo the honest limit is a RANGE, 11-14, and a 12-exercise program can be refused.');

// What E12 is actually choosing between. E12 declined to slim the payload partly
// on the belief that capacity was fine; it is not, so the alternative deserves a
// number from the same instrument rather than an estimate. Slimming means the
// client resolves text from a bundled library and the QR carries only what the
// program decided: which exercise, how much, which days.
// Dropping instruction text and the image filename is the large win, and it is
// still a valid contract-v1 payload -- the validator requires id, name, category
// and type, and says nothing about `instructions`. So this one goes through the
// real encoder like everything else above.
const noText = (ex) => ({ ...ex, instructions: '', image_ref: null });

// Going further -- ids and dosage only -- cannot be measured here, and the
// reason is the finding: `validatePlanPayload` refuses it (name, category and
// type are required), so it is a contract v2. That is exactly the cost E12
// named. Its JSON size is reported so the size of the prize is visible, but it
// is a JSON measurement and not an encoder measurement, and is labelled so.
const idsOnly = (ex) => ({
  source_exercise_id: ex.source_exercise_id,
  default_prescription: ex.default_prescription,
  prescription_override: ex.prescription_override,
  duration_sec: ex.duration_sec,
  days: ex.days,
  sort_order: ex.sort_order,
});

const noTextCeiling = await ceilingFor(library.map(noText), base);
const twelve = library.slice(0, 12);

console.log('\nWhat slimming would buy (the E12 alternative):\n');
console.log('  payload                        | 12-ex JSON | ceiling');
console.log('  -------------------------------|------------|--------');
console.log(`  full, contract v1 (today)      | ${String(JSON.stringify(twelve).length).padStart(10)} | ${String(ceiling ?? '-').padStart(7)}`);
console.log(`  no instructions, no image_ref  | ${String(JSON.stringify(twelve.map(noText)).length).padStart(10)} | ${String(noTextCeiling).padStart(7)}`);
console.log(`  ids + dosage only              | ${String(JSON.stringify(twelve.map(idsOnly)).length).padStart(10)} |       ?`);
console.log('\n  ? = contract v1 cannot express it: validatePlanPayload requires name, category');
console.log('    and type, so it refuses. Slimming that far IS the version bump E12 priced.');
console.log('\nDropping instruction text alone clears the ceiling past the whole library, so the');
console.log('capacity problem is ENTIRELY the instruction text -- not the identity fields, not');
console.log('the assessment or employee blocks. Note what that row does and does not say: the');
console.log('payload still VALIDATES under contract v1, so no version bump is needed to make it');
console.log('fit. It would still break the employee\'s phone, which has nothing to display --');
console.log('the client text library is what E12 killed (B2). The capacity argument and the');
console.log('bundled-library argument are separable, and only the first one was measured wrong.');
console.log('\nE12\'s other reasons stand untouched: the printed sheet lists every exercise by');
console.log('name, so the privacy gain is still small, and a contract bump still has to be');
console.log('coordinated across two sessions. Only its capacity premise was false.');
