import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildPlanQr } from '../src/lib/qr/planQr.js';
import { toKeyIdHex } from '../src/lib/qr/envelope.js';
import { renderSheetCodes } from '../src/lib/sheet/planSheet.js';
import PlanSheet from '../src/components/PlanSheet.jsx';

/* Server rendering rather than jsdom.
 *
 * The sheet is the one screen in this app that is consumed on paper, so what
 * matters is the markup that reaches the printer -- there is no interaction to
 * simulate. renderToStaticMarkup gives exactly that, in the node environment
 * this suite already runs in, without adding a DOM library for one file. */

const BASE = 'https://cadence.example.com';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../docs/sample-plan-payload.json', import.meta.url)), 'utf8'),
);

async function renderSheet(payload = structuredClone(SAMPLE)) {
  const issued = await buildPlanQr(payload, { baseUrl: BASE });
  const codes = await renderSheetCodes(issued);
  const html = renderToStaticMarkup(
    createElement(PlanSheet, {
      payload,
      codes,
      issued,
      keyIdHex: toKeyIdHex(issued.keyId),
    }),
  );
  return { html, issued, codes, payload };
}

describe('the sheet as it reaches the printer', () => {
  it('renders both codes as inline SVG, not as images', async () => {
    const { html } = await renderSheet();

    /* An <img src="data:..."> is resampled at print time, which is what the
     * mm sizing exists to avoid. If this ever flips to an image, the 110mm
     * measurement stops meaning anything. */
    expect(html.match(/<svg/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('data:image');
  });

  it('sizes the code box itself in millimetres, not just the figure round it', async () => {
    const { html } = await renderSheet();

    /* Asserting that "110mm" appears somewhere is not enough -- it passes while
     * the box actually holding the SVG is sized in pixels, which is exactly the
     * mistake this is here to prevent. Read the style off the QR element. */
    const boxes = [...html.matchAll(/class="plan-sheet__qr"[^>]*style="([^"]*)"/g)]
      .map((match) => match[1]);

    expect(boxes).toHaveLength(2);
    for (const style of boxes) {
      expect(style).toMatch(/width:\s*\d+mm/);
      expect(style).toMatch(/height:\s*\d+mm/);
      expect(style).not.toMatch(/px/);
    }
    expect(boxes.join(' ')).toContain('110mm');
    expect(boxes.join(' ')).toContain('55mm');
  });

  it('carries the employee on it, so two sheets cannot be swapped', async () => {
    const { html } = await renderSheet();

    expect(html).toContain('Maria Santos');
    expect(html).toContain('4412');
  });

  it('prints every exercise in the plan as the scan-failed backup', async () => {
    const { html, payload } = await renderSheet();

    for (const exercise of payload.exercises) {
      expect(html).toContain(exercise.name);
    }
    expect(html).toContain('2x10 each side'); // the override, not the default
    expect(html).not.toContain('3x10 each side');
  });

  it('numbers the codes so the order survives being looked at, not read', async () => {
    const { html } = await renderSheet();
    const first = html.indexOf('Scan this first');
    const second = html.indexOf('Then scan this');

    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('prints the module size, which is what a failed scan at the printer needs', async () => {
    const { html, codes } = await renderSheet();

    expect(html).toContain(`${codes.planModuleMm.toFixed(2)}mm each`);
    expect(html).not.toContain('BELOW');
  });

  it('says so on the paper when the code is too small to scan', async () => {
    const { issued, payload } = await renderSheet();
    const codes = await renderSheetCodes(issued);

    /* Force the marginal case rather than waiting for a plan big enough to
     * produce it: the warning is the part that must not be silent. */
    const html = renderToStaticMarkup(
      createElement(PlanSheet, {
        payload,
        codes: { ...codes, readable: false },
        issued,
        keyIdHex: toKeyIdHex(issued.keyId),
      }),
    );

    expect(html).toContain('BELOW');
    expect(html).toContain('expect scanning trouble');
  });

  it('renders a plan with no exercises rather than breaking on it', async () => {
    /* Not a plan anyone would issue, but the sheet must not be the thing that
     * throws -- it renders after the key is already stored. */
    const payload = structuredClone(SAMPLE);
    const issued = await buildPlanQr(payload, { baseUrl: BASE });
    const codes = await renderSheetCodes(issued);

    const html = renderToStaticMarkup(
      createElement(PlanSheet, {
        payload: { ...payload, exercises: [], employee: null },
        codes,
        issued,
        keyIdHex: toKeyIdHex(issued.keyId),
      }),
    );

    expect(html).toContain('Employee');
    expect(html).not.toContain('Your exercises</h3>');
  });
});
