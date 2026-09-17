/**
 * The printed companion sheet is paper an employee is handed. It does not change.
 *
 * DESIGN-SYSTEM-PLAN rule 6: "Print stays what it is." The 1f sheet carries the
 * two QR codes a phone has to scan, and its scannability is a physical property
 * of the printed page -- which is why those rules are specified in millimetres
 * and why they set their own white ground and dark ink regardless of theme. A
 * restyle that reached them would produce a sheet that looks fine on screen and
 * cannot be scanned.
 *
 * Step 5 (2026-09-17) moved this app onto the shared palette and did not touch
 * this section; the check is standing rather than one-off, because the same
 * risk applies to every later pass over `app.css`.
 *
 * A fixture rather than a hash: a failure names the rule and shows the diff,
 * which is what makes it a test someone acts on instead of deletes. Change the
 * paper deliberately by running with UPDATE_PRINT_LOCK=1 and saying why in the
 * commit -- the fixture diff is then the record of what moved on the page.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(
  fileURLToPath(new URL('../src/styles/app.css', import.meta.url)),
  'utf8',
);
const fixturePath = fileURLToPath(new URL('./fixtures/print-sheet-css.json', import.meta.url));

/** Everything from the printed-sheet banner to the end of the file.
 *
 *  Taken as a contiguous tail rather than by matching selectors, because the
 *  section genuinely is the tail: `.plan-sheet*`, then `@page`, then
 *  `@media print`. A selector filter would silently stop protecting a rule
 *  someone adds there under a different name. */
function paper() {
  const at = appCss.indexOf('/* ---- The printed companion sheet (1f) ');
  expect(at, 'the printed-sheet section banner is gone from app.css').toBeGreaterThan(-1);
  return appCss.slice(at);
}

/** The tail split into `selector -> declarations`, comments dropped.
 *
 *  Comments are dropped so that rewording a note is not reported as changing
 *  the page -- the assertion is about what the printer does, and a comment does
 *  not reach the printer. */
function rules(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] !== '{') continue;
    const selector = css.slice(start, i).trim();
    const open = i;
    let depth = 0;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    out[selector] = css.slice(open + 1, i).trim();
    start = i + 1;
  }
  return out;
}

const current = rules(paper());

if (process.env.UPDATE_PRINT_LOCK === '1') {
  writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

const expected = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('the printed companion sheet', () => {
  it('is byte-identical to the fixture, rule by rule', () => {
    for (const [selector, body] of Object.entries(expected)) {
      expect(current, `the paper lost a rule: ${selector}`).toHaveProperty([selector]);
      expect(
        current[selector],
        `${selector} changed. That sheet is an employee's paper and carries the ` +
          `QR codes their phone has to scan. If the change is deliberate, rerun ` +
          `with UPDATE_PRINT_LOCK=1.`,
      ).toBe(body);
    }
  });

  it('gains no new rule without saying so', () => {
    // Not symmetric with the test above, and needed: a rule ADDED here changes
    // the paper just as surely as one edited, and would otherwise pass unnoticed
    // because every locked rule still matched.
    const added = Object.keys(current).filter((selector) => !(selector in expected));
    expect(added, `new rules now target the printed sheet: ${added.join(', ')}`).toEqual([]);
  });

  it('keeps its white ground and dark ink whatever the theme is', () => {
    // The one property worth stating separately, because it is the one a
    // well-meaning restyle would "fix": a dark-mode QR code is a code no
    // scanner will read. Literal values on purpose -- a token would follow the
    // theme, which is exactly what must not happen.
    expect(current['.plan-sheet']).toContain('background: #fff');
    expect(current['.plan-sheet']).toContain('color: #111');
  });
});
