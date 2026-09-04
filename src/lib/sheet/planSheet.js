/**
 * The printed companion sheet (pipeline item 1f).
 *
 * Everything here is framework-free so it can be tested in this repo's node
 * environment. The JSX in `components/PlanSheet.jsx` only lays it out.
 *
 * Three things are decided here rather than in the markup, because each is a
 * decision somebody could quietly undo by editing a string:
 *
 * 1. **The codes are SVG, not PNG.** The screen codes stay raster -- they are
 *    scanned off a screen at a fixed pixel size. A printed code is specified in
 *    *millimetres*, and rasterising 110mm turns that into a question about the
 *    printer's dpi and its resampling. SVG makes the measurement the real one.
 *
 * 2. **The module size is computed and printed on the sheet.** "~110mm square"
 *    was the plan's number and it needs a real scan test, but a scan test that
 *    fails tells you nothing on its own. Printing the x-dimension means a failed
 *    scan at the printer separates "the code is too small" from "something else
 *    is wrong", without a second trip.
 *
 * 3. **The steps do not mention installing anything.** See SHEET_STEPS.
 */
import QRCode from 'qrcode';

import { PLAN_ECC_LEVEL } from '../qr/planQr.js';

/* Print sizes. The plan code is v38-v40; the pairing code carries 32 bytes and
 * is far smaller, so it does not need the same square. */
export const PLAN_CODE_MM = 110;
export const PAIR_CODE_MM = 55;

/* Minimum x-dimension (one module) for reliable phone-camera scanning. 0.5mm is
 * the conservative end of the usual 0.4-0.5mm guidance, chosen that way because
 * the failure it prevents happens in front of an employee with a printed sheet
 * that cannot be fixed on the spot. */
export const MIN_MODULE_MM = 0.5;

/* The quiet zone rendered into the SVG, in modules, per side. It counts toward
 * the width, so it has to be included when working out the module size -- a
 * subtraction that is easy to forget and makes the code read 4% larger than it
 * prints. */
export const QUIET_MODULES = 4;

/**
 * Modules across a qrcode-generated SVG, quiet zone included.
 *
 * Read from the viewBox rather than recomputed from the payload: this is the
 * thing that will actually be printed, and the version the library picked is
 * not something this file should be predicting independently.
 */
export function qrModuleCount(svg) {
  const match = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
  if (!match) throw new Error('QR SVG has no readable viewBox');
  return Number(match[1]);
}

/** Physical size of one module, in mm, when `modules` are printed at `widthMm`. */
export function moduleSizeMm(modules, widthMm) {
  return widthMm / modules;
}

async function svgFor(text) {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: PLAN_ECC_LEVEL,
    margin: QUIET_MODULES,
  });
}

/**
 * Both codes as print-ready SVG, with the geometry that decides scannability.
 *
 * `readable` is advisory and deliberately not an exception: a sheet that is
 * marginal is still the sheet the owner has, and refusing to render it would
 * leave him with nothing while telling him nothing. The number is shown instead.
 */
export async function renderSheetCodes({ pairUrl, planUrl }) {
  const [pairSvg, planSvg] = await Promise.all([svgFor(pairUrl), svgFor(planUrl)]);

  const planModules = qrModuleCount(planSvg);
  const pairModules = qrModuleCount(pairSvg);
  const planModuleMm = moduleSizeMm(planModules, PLAN_CODE_MM);
  const pairModuleMm = moduleSizeMm(pairModules, PAIR_CODE_MM);

  return {
    pairSvg,
    planSvg,
    planModules,
    pairModules,
    planModuleMm,
    pairModuleMm,
    readable: planModuleMm >= MIN_MODULE_MM && pairModuleMm >= MIN_MODULE_MM,
  };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon, Wed, Fri" -- or "Every day" when the plan asks for all seven. */
export function daysLabel(days) {
  if (!Array.isArray(days) || days.length === 0) return 'As scheduled';
  if (days.length === 7) return 'Every day';
  return days
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .map((d) => DAY_NAMES[d])
    .join(', ');
}

/**
 * The plain exercise list, which is the sheet's backup for a scan that never
 * works (decision E2).
 *
 * `prescription_override` wins over `default_prescription` because the override
 * is the practitioner's decision for this employee, and printing the default
 * next to a code that carries the override would put two different answers in
 * front of the same person.
 */
export function sheetExercises(payload) {
  const exercises = Array.isArray(payload?.exercises) ? [...payload.exercises] : [];
  exercises.sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0));
  return exercises.map((exercise) => ({
    id: exercise?.source_exercise_id ?? null,
    name: exercise?.name ?? 'Exercise',
    prescription: exercise?.prescription_override || exercise?.default_prescription || '',
    days: daysLabel(exercise?.days),
  }));
}

/**
 * The numbered steps, in the order the employee performs them.
 *
 * **Pairing first, plan second** -- that is the smooth path, and it is what the
 * sheet asks for.
 *
 * **But the wrong order is not a failure**, and the sheet must not say it is.
 * `applyPlanEnvelope` saves an unopenable plan as a pending envelope and
 * `PairDevice` drains it the moment the key arrives; holding a plan scanned
 * weeks before pairing is the whole design (see pending.js). Telling an employee
 * they have ruined their sheet would cause a reprint that nothing requires.
 *
 * **Nothing here mentions installing the app or adding it to the home screen**,
 * and that is the one instruction most likely to be added back by someone
 * reading the older plan text (decisions B1 and E2 both say "install steps").
 * Two reasons it is wrong now. The codes are ordinary URLs, so the phone camera
 * opens them in the browser and no install ever happens. And storage is
 * per-browser: a plan scanned in Safari lives in Safari, so an employee who
 * installs first and scans second can end up with an empty app and a plan they
 * cannot reach -- open item 1 in PIPELINE-WORKFLOW-PLAN.md, still unverified on
 * a real iPhone. Until somebody has tested that on hardware, the sheet asks for
 * the one path that is known to work.
 */
export const SHEET_STEPS = Object.freeze([
  Object.freeze({
    title: 'Point your phone camera at the first code',
    body:
      'Tap the link your camera shows. Your phone will open a page that sets up ' +
      'your exercises. There is nothing to install.',
  }),
  Object.freeze({
    title: 'Point it at the second code',
    body: 'This is your exercise program. It opens on the same page.',
  }),
  Object.freeze({
    title: 'Write down the PIN it shows you',
    body:
      'The page gives you a temporary PIN the first time. You choose your own ' +
      'when you sign in.',
  }),
  Object.freeze({
    title: 'Use the same browser each time',
    body:
      'Your exercises are saved in the browser that scanned the codes. If you ' +
      'open a different one, they will not be there.',
  }),
]);

/** The reassurance that keeps a wrong-order scan from becoming a reprint. */
export const WRONG_ORDER_NOTE =
  'Scanned them the other way round? Nothing is lost — scan the first code and ' +
  'your exercises will appear.';
