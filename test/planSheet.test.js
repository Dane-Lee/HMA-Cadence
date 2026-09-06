import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildPlanQr } from '../src/lib/qr/planQr.js';
import {
  renderSheetCodes,
  sheetExercises,
  daysLabel,
  qrModuleCount,
  moduleSizeMm,
  SHEET_STEPS,
  WRONG_ORDER_NOTE,
  PLAN_CODE_MM,
  MIN_MODULE_MM,
  QUIET_MODULES,
} from '../src/lib/sheet/planSheet.js';

const BASE = 'https://cadence.example.com';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../docs/sample-plan-payload.json', import.meta.url)), 'utf8'),
);

function samplePlan() {
  return structuredClone(SAMPLE);
}

/* Deterministic high-entropy filler, copied in spirit from issuePlan.test.js:
 * repeated text compresses away and would quietly shrink the very code this
 * file is trying to print at its largest. */
function noise(length, seed) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  let state = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

function planWith(count, template) {
  return Array.from({ length: count }, (_, index) => ({
    ...template,
    source_exercise_id: `x${index}`,
    name: `Exercise ${index}`,
    instructions: noise(90, index + 1),
    sort_order: index,
  }));
}

/* A plan pushed as close to MAX_QR_BYTES as it goes without tipping over, so the
 * module size below is measured on the biggest code that can ever be printed
 * rather than on the comfortable sample. */
async function largestIssuablePlan() {
  const payload = samplePlan();
  const template = payload.exercises[0];
  for (let count = 4; count <= 60; count += 1) {
    payload.exercises = planWith(count, template);
    try {
      const result = await buildPlanQr(payload, { baseUrl: BASE });
      if (count === 60) return { result, exercises: count };
    } catch {
      payload.exercises = planWith(count - 1, template);
      return { result: await buildPlanQr(payload, { baseUrl: BASE }), exercises: count - 1 };
    }
  }
  throw new Error('never reached the capacity limit');
}

describe('the printed sheet: geometry', () => {
  it('keeps the plan code scannable at its print size, even at full capacity', async () => {
    const { result, exercises } = await largestIssuablePlan();
    const codes = await renderSheetCodes(result);

    /* The point of the test is that this holds for the WORST case, so assert
     * the case really was near the limit rather than a small plan that passed
     * for the wrong reason. */
    expect(exercises).toBeGreaterThan(10);
    expect(result.headroom).toBeLessThan(200);

    expect(codes.planModuleMm).toBeGreaterThanOrEqual(MIN_MODULE_MM);
    expect(codes.pairModuleMm).toBeGreaterThanOrEqual(MIN_MODULE_MM);
    expect(codes.readable).toBe(true);
  });

  it('measures the module across the quiet zone, not just the symbol', async () => {
    const result = await buildPlanQr(samplePlan(), { baseUrl: BASE });
    const codes = await renderSheetCodes(result);

    /* A viewBox that excluded the margin would make every printed module read
     * larger than it is, which is the direction that lets an unscannable sheet
     * through. Pin that the count includes both quiet zones. */
    const symbolOnly = codes.planModules - QUIET_MODULES * 2;
    expect(symbolOnly).toBeGreaterThan(20);
    expect((symbolOnly - 21) % 4).toBe(0); // QR versions are 21 + 4n modules.
    expect(codes.planModuleMm).toBeCloseTo(PLAN_CODE_MM / codes.planModules, 6);
  });

  it('renders SVG, so the print size is a measurement rather than a dpi guess', async () => {
    const result = await buildPlanQr(samplePlan(), { baseUrl: BASE });
    const codes = await renderSheetCodes(result);

    expect(codes.planSvg).toContain('<svg');
    expect(codes.planSvg).not.toContain('data:image/png');
  });

  it('reports a code that is too small rather than throwing it away', () => {
    /* A v40 code squeezed onto a business card. The sheet still renders -- the
     * owner needs to see what he has -- but `readable` has to say so. */
    const modules = qrModuleCount('<svg viewBox="0 0 185 185">');
    expect(modules).toBe(185);
    expect(moduleSizeMm(modules, 50)).toBeLessThan(MIN_MODULE_MM);
  });
});

describe('the printed sheet: what it tells the employee', () => {
  it('asks for the pairing code first and the plan code second', () => {
    expect(SHEET_STEPS[0].title.toLowerCase()).toContain('first');
    expect(SHEET_STEPS[1].title.toLowerCase()).toContain('second');
  });

  it('never tells them to install anything or add it to the home screen', () => {
    /* Both older decisions (B1, E2) say "install steps", and open item 1 says
     * installing first can strand the plan in the browser's storage. If this
     * fails, that wording came back -- check the open item before deleting the
     * test. */
    const words = SHEET_STEPS.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase();
    expect(words).not.toMatch(/home screen/);
    expect(words).not.toMatch(/installing|installed|install it|install the/);
    expect(words).toContain('nothing to install');
  });

  it('names the in-app scanner as the fallback for the plan code', () => {
    /* 2026-09-06, first print test on the owner's iPhone: the Camera app read
     * the pairing code and did not register the plan code at all. The in-app
     * scanner had already decoded both on 08-31. The sheet must send the
     * employee there, and must say it on the plan-code step, not in a footnote. */
    expect(SHEET_STEPS[1].body).toContain('Scan my sheet');
    expect(SHEET_STEPS[1].body.toLowerCase()).toContain('does not react');
  });

  it('says the wrong scan order is recoverable, because it is', () => {
    /* applyPlanEnvelope saves an unopenable plan and PairDevice drains it. A
     * sheet that threatened the opposite would cause reprints for nothing. */
    expect(WRONG_ORDER_NOTE.toLowerCase()).toContain('nothing is lost');
  });

  it('warns that the exercises live in the browser that scanned them', () => {
    const words = SHEET_STEPS.map((s) => `${s.title} ${s.body}`).join(' ').toLowerCase();
    expect(words).toContain('same browser');
  });
});

describe('the printed sheet: the backup exercise list', () => {
  it('prints the override rather than the default when the practitioner set one', () => {
    const rows = sheetExercises(samplePlan());
    const reverseLunge = rows.find((row) => row.name === 'Reverse Lunge');

    expect(reverseLunge.prescription).toBe('2x10 each side');
    expect(reverseLunge.prescription).not.toBe('3x10 each side');
  });

  it('prints in the plan order, not the payload order', () => {
    const payload = samplePlan();
    payload.exercises = [...payload.exercises].reverse();

    const rows = sheetExercises(payload);

    expect(rows.map((row) => row.id)).toEqual(
      [...samplePlan().exercises]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((exercise) => exercise.source_exercise_id),
    );
  });

  it('names the days rather than printing raw numbers', () => {
    expect(daysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysLabel([])).toBe('As scheduled');
    expect(daysLabel(undefined)).toBe('As scheduled');
  });

  it('survives an exercise with nothing prescribed', () => {
    const payload = samplePlan();
    payload.exercises[0].default_prescription = null;
    payload.exercises[0].prescription_override = null;

    expect(sheetExercises(payload)[0].prescription).toBe('');
  });
});
