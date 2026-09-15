/**
 * Generate Cadence's bundled exercise library from the Tracker's catalogue.
 *
 *     node tools/generate-exercise-library.mjs          # check, exit 1 on drift
 *     node tools/generate-exercise-library.mjs --write  # regenerate
 *
 * WHY THIS EXISTS. The plan QR used to carry every exercise's full name and
 * instructions, which put a hard ceiling of 11-14 exercises on a plan -- past
 * which `/admin/issue` refuses outright. The owner reversed decision E12 on
 * 2026-09-15 once that ceiling was measured rather than assumed: the payload
 * carries identity and dosage, and Cadence resolves the text and the picture
 * from a library it already has. The ceiling then clears the whole 44-exercise
 * library.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN. The Tracker is the source of truth for
 * exercises, and it is in a different repo. A hand-maintained second copy here
 * would drift the first time anyone adds an exercise, and the symptom would be
 * an employee's phone showing a name with no instructions under it -- which
 * looks like a rendering bug, not like a stale file.
 *
 * That is exactly what the owner asked for when reversing E12: "something,
 * somewhere to trigger a full assessment suite update if any exercises were to
 * be added to the Tracker." This script is the derivation; the alarm is
 * `test/exerciseLibrary.test.js` here and `test_cadence_exercise_library.py` in
 * the suite -- the latter because it runs on a machine that can see BOTH repos,
 * which is the only place the two can actually be compared.
 *
 * Note what this library does NOT make safe: an exercise the Tracker retired.
 * Retired ids stay retired (invariant A3) precisely so an old plan still
 * resolves.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readCatalogue, trackerIndex } from './tracker-library.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, '..', 'src', 'lib', 'data', 'exerciseLibrary.js');

const HEADER = `/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 *     node tools/generate-exercise-library.mjs --write
 *
 * Cadence's copy of the Tracker's exercise catalogue, keyed by the public
 * exercise id that joins the Tracker, the Overlay and Cadence. The plan QR
 * carries identity and dosage; the name, the instructions and the image come
 * from here, which is what lets a plan hold the whole library rather than
 * stopping at 11-14 exercises.
 *
 * Regenerate when the Tracker's exercises change. If you are reading this
 * because a test failed, that is the test telling you the Tracker moved.
 */
`;

function render(entries) {
  const lines = entries.map((entry) => `  ${JSON.stringify(entry)},`).join('\n');
  return `${HEADER}
export const EXERCISE_LIBRARY = [
${lines}
];

/** id -> entry. Built once; the ingest looks up every exercise in a plan. */
export const EXERCISE_BY_ID = new Map(
  EXERCISE_LIBRARY.map((entry) => [entry.source_exercise_id, entry]),
);

/** The Tracker revision this was generated from, as a count. A cheap signal that
 *  something changed; the real comparison is field by field in the tests. */
export const EXERCISE_LIBRARY_SIZE = ${entries.length};
`;
}

const indexPath = trackerIndex();
if (!indexPath) {
  console.error('The Tracker is not cloned on this machine, so there is no catalogue to read.');
  console.error('Looked for HMA-Tracker-app/ and HMA-Correct-Exercise-Tracker/ beside and above Cadence.');
  process.exit(2);
}

const entries = readCatalogue(indexPath);
const rendered = render(entries);
const write = process.argv.includes('--write');

let current = null;
try {
  current = readFileSync(OUTPUT, 'utf8');
} catch {
  current = null;
}

if (write) {
  writeFileSync(OUTPUT, rendered);
  console.log(`wrote ${OUTPUT}`);
  console.log(`  exercises: ${entries.length}`);
  const missingText = entries.filter((e) => !e.instructions).length;
  const missingImage = entries.filter((e) => !e.image_ref).length;
  console.log(`  without instructions: ${missingText}`);
  console.log(`  without an image:     ${missingImage}`);
} else if (current === rendered) {
  console.log(`up to date (${entries.length} exercises)`);
} else {
  console.error('DRIFT: the bundled library does not match the Tracker.');
  console.error('Run `node tools/generate-exercise-library.mjs --write`.');
  process.exit(1);
}
