/**
 * Read the Tracker's exercise catalogue out of its `index.html`.
 *
 * The Tracker is the source of truth for exercises: five parallel structures
 * keyed by a public id (`l1`, `s3`, `co2`…) that the Tracker, the Overlay and
 * Cadence all join on. Two things in Cadence need to read it -- the capacity
 * measurement and the bundled exercise library -- and they must not each grow
 * their own parser, because a parser that silently drops four of forty-four
 * exercises produces a wrong answer that looks like a right one.
 *
 * It is a parser rather than a copy for the same reason `fault_vocabulary.py`
 * and `design/tokens.css` are: one canonical definition, everything else
 * derived. `tools/generate-exercise-library.mjs` is the derivation and
 * `test/exerciseLibrary.test.js` is the alarm when it goes stale.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CADENCE = join(HERE, '..');

/** The Tracker's `index.html`, under either folder name at either depth.
 *
 *  It is `HMA-Tracker-app` on one machine and `HMA-Correct-Exercise-Tracker` on
 *  the other, inside the suite repo on one and alongside it on the other. Same
 *  resolution order as `estate-status.mjs`; do not hardcode one. Returns null
 *  rather than throwing, because "the Tracker is not cloned here" is a real,
 *  reportable state and not an error. */
export function trackerIndex() {
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
export const CATEGORY = {
  lunge: 'lunge',
  sld: 'single_leg_dip',
  shoulder: 'shoulder_reach',
  trunk: 'trunk_rotation',
  cervical: 'cervical_rotation',
};

/** Lift one `const NAME={...}` object literal out of the page by brace-matching.
 *
 *  Evaluating the literal is deliberate. A regex over the entries would quietly
 *  drop any exercise whose text did not match its assumptions, and a library
 *  that silently held 40 of 44 exercises is worse than none -- the four missing
 *  ones would render as a name with no instructions on an employee's phone. */
export function readObject(html, name) {
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

/**
 * Every exercise the Tracker can put in a plan, as catalogue entries.
 *
 * Catalogue fields only -- no `days`, no `sort_order`, no
 * `prescription_override`. Those describe one person's programme, not the
 * exercise, and they are what the plan QR still carries.
 */
export function readCatalogue(indexPath) {
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
        duration_sec: durations[ex.id] || 0,
        image_ref:
          image && !image.startsWith('data:')
            ? decodeURIComponent(image.split('/').pop())
            : null,
      });
    }
  }
  return flat;
}
