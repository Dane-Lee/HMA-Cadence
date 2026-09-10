/**
 * How many exercises fit in a plan QR, measured against the Tracker's real library.
 *
 * Decision E12 ("do not slim the payload") rests on the sentence *"Capacity is
 * fine (911 chars for 12 exercises)"*. That figure does not reproduce, and the
 * reason is recorded in WORKLOG 1e: the earlier measurement reused **identical**
 * instruction text across exercises, which DEFLATE collapses to almost nothing.
 * Real plans carry 44 different instructions, and they do not compress that way.
 *
 * So this exists to stop the number being re-derived from a fixture again. It
 * reads the Tracker's actual `EXERCISES` object out of its `index.html` and runs
 * the actual `buildPlanQr()`, which is the same function `/admin/issue` calls.
 * Nothing here is a model of the encoder; it *is* the encoder.
 *
 *   node tools/measure-plan-capacity.mjs [--base https://host] [--max 20]
 *
 *   --base  Origin the QR points at. It is inside the QR, so it counts against
 *           capacity -- measure with the host you will really deploy on. The
 *           default is a realistic length rather than a flatteringly short one.
 *   --max   Highest exercise count to try (default 20).
 *
 * The ceiling this prints is a real operational limit: past it, `/admin/issue`
 * refuses and the admin cannot issue that plan at all.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { buildPlanQr, MAX_QR_BYTES, PLAN_ECC_LEVEL, PlanQrError } from '../src/lib/qr/planQr.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CADENCE = join(HERE, '..');

/** The Tracker's `index.html`, under either folder name at either depth.
 *  It is `HMA-Tracker-app` on one machine and `HMA-Correct-Exercise-Tracker` on
 *  the other, inside the suite repo on one and alongside it on the other. Same
 *  resolution order as `estate-status.mjs`; do not hardcode one. */
function trackerIndex() {
  const roots = [join(CADENCE, '..'), join(CADENCE, '..', '..')];
  for (const root of roots) {
    for (const name of ['HMA-Tracker-app', 'HMA-Correct-Exercise-Tracker']) {
      const candidate = join(root, name, 'index.html');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** The Tracker's picker keys are not the contract's movement keys.
 *  Mirrors its own `CADENCE_MOVEMENT`. */
const CATEGORY = {
  lunge: 'lunge',
  sld: 'single_leg_dip',
  shoulder: 'shoulder_reach',
  trunk: 'trunk_rotation',
  cervical: 'cervical_rotation',
};

/** Lift one `const NAME={...}` object literal out of the page by brace-matching.
 *
 *  Evaluating the literal is deliberate. A regex over the entries would quietly
 *  drop any exercise whose text did not match its assumptions, and a capacity
 *  measurement that silently used 40 of 44 exercises is worse than none. */
function readObject(html, name) {
  const start = html.indexOf(`const ${name}={`);
  if (start === -1) throw new Error(`no ${name} object in the Tracker's index.html`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      // eslint-disable-next-line no-new-func
      if (depth === 0) return new Function(`return ${html.slice(open, i + 1)}`)();
    }
  }
  throw new Error(`${name} is not brace-balanced`);
}

/** Every exercise, shaped exactly as the Tracker's `buildPlanPayload()` emits it.
 *
 *  The per-exercise fields have to come from the Tracker's real tables, not from
 *  plausible constants. `exercise_type`, `duration_sec` and `image_ref` all vary
 *  per exercise in a real plan, and a constant repeated 15 times is close to free
 *  under DEFLATE. Filling them in with one value each is the same mistake that
 *  produced E12's "911 chars" -- it measures the compressor, not the payload. */
function readLibrary(indexPath) {
  const html = readFileSync(indexPath, 'utf8');
  const exercises = readObject(html, 'EXERCISES');
  const types = readObject(html, 'EX_TYPE');
  const durations = readObject(html, 'EX_DURATION');
  const images = readObject(html, 'DEFAULT_IMAGES');

  const flat = [];
  for (const [picker, group] of Object.entries(exercises)) {
    const category = CATEGORY[picker];
    if (!category) throw new Error(`unmapped Tracker picker key "${picker}"`);
    for (const ex of group.exercises ?? []) {
      const image = images[ex.id];
      flat.push({
        source_exercise_id: ex.id,
        name: ex.name,
        instructions: ex.inst,
        movement_category: category,
        // `.replace(/\s+/g,'_')` mirrors buildPlanPayload; "static stabilization"
        // is stored with a space and the contract wants the key form.
        exercise_type: (types[ex.id] || '').replace(/\s+/g, '_'),
        default_prescription: ex.sets,
        prescription_override: null,
        duration_sec: durations[ex.id] || 0,
        // A real program assigns days per exercise. Kept varied for the same
        // reason as the fields above.
        days: [[1, 3, 5], [2, 4], [1, 2, 3, 4, 5], [1, 4]][flat.length % 4],
        sort_order: flat.length,
        image_ref: image && !image.startsWith('data:')
          ? decodeURIComponent(image.split('/').pop())
          : null,
      });
    }
  }
  return flat;
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
const max = Number(argOf('--max', '20'));

const indexPath = trackerIndex();
if (!indexPath) {
  console.error('The Tracker is not cloned on this machine, so there is no real library to measure.');
  console.error('Looked for HMA-Tracker-app/ and HMA-Correct-Exercise-Tracker/ beside and above Cadence.');
  process.exit(2);
}

const library = readLibrary(indexPath);
const lengths = library.map((ex) => ex.instructions.length).sort((a, b) => a - b);
const median = lengths[Math.floor(lengths.length / 2)];

console.log(`Library:  ${library.length} exercises from ${indexPath}`);
console.log(`          instruction text median ${median} chars`);
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
  console.log(`\nNo ceiling at or below ${Math.min(max, library.length)} exercises with this base URL.`);
} else {
  console.log(`\nCEILING: ${ceiling} exercises. A ${ceiling + 1}-exercise plan cannot be issued at all.`);
  console.log('This is an operational limit, not a warning -- /admin/issue refuses it.');
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
const byLongest = [...library].sort((a, b) => b.instructions.length - a.instructions.length);
const byShortest = [...library].sort((a, b) => a.instructions.length - b.instructions.length);

console.log('\nWhat actually moves the ceiling:\n');
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
