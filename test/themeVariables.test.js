/**
 * Every `var(--x)` in the stylesheets must name a variable the stylesheets define.
 *
 * `--surface` and `--surface-muted` were used in `app.css` and declared nowhere.
 * Both had fallbacks, so nothing threw and nothing looked wrong in light theme:
 * `--surface` fell back to `#fff` under `color: inherit`, which is near-white in
 * dark theme, and the "Where the phone lands" field on `/admin/issue` was white
 * on white. The owner hit it mid-task on 2026-09-08, a week after it shipped.
 *
 * A fallback is what made this silent rather than what saved it. This test is
 * the reason it cannot come back: a typo'd or renamed variable now fails here
 * instead of rendering something unreadable in the theme nobody develops in.
 *
 * Deliberately not asserted: that every *defined* variable is used. Unused ones
 * are dead weight, not a defect, and `theme.css` is a palette -- it is allowed
 * to offer more than the app currently reaches for.
 *
 * UPDATED 2026-09-17 for DESIGN-SYSTEM-PLAN step 5, which changed two things
 * this file had hard-coded:
 *
 *   * There is a second stylesheet now, `tokens.css`, the estate's shared
 *     palette carried as a byte-identical copy. It packs pairs onto one line
 *     (`--ok: 46 125 50;  --ok-tint: 232 245 233;`), and the declaration
 *     pattern here anchored to the start of a line -- so every `-tint` token
 *     read as undefined. The pattern now accepts a declaration after a `;` too.
 *
 *   * The theme polarity flipped to match the shared file: `:root` is the DARK
 *     theme and `[data-theme="light"]` is the override. It used to be the other
 *     way round in this stylesheet while `index.html` carried
 *     `data-theme="dark"` -- so the app rendered dark out of a light `:root`,
 *     and the base/override assertion below was checking the pair backwards.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = fileURLToPath(new URL('../src/styles', import.meta.url));

const sheets = readdirSync(stylesDir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, text: readFileSync(`${stylesDir}/${name}`, 'utf8') }));

/** The same text with every CSS comment blanked out, positions preserved.
 *
 *  Comments are replaced by spaces rather than deleted so that `lineOf` still
 *  reports the right line. Needed because these stylesheets EXPLAIN themselves:
 *  theme.css documents finding (c) by quoting `var(--accent)` in prose, and a
 *  scanner that reads comments reports the explanation as the defect. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Tokens an app is entitled to set for itself despite carrying the shared copy.
 *
 *  A name list, not a blanket allowance, and the same one the suite's
 *  `test_design_tokens.py` keeps: `--size-base` is per app BY DESIGN -- the
 *  Tracker is 22px, the Overlay 18px, Cadence 18px, the React apps 16px -- so a
 *  flat "never redeclare" rule would forbid the plan's own design. */
const PER_APP = new Set(['size-base']);

// A declaration starts a line OR follows a `;` on one -- tokens.css pairs a
// colour with its tint on a single line, and anchoring to the line start alone
// silently lost the second of every pair.
const DECLARATION = /(?:^|;)\s*--([a-z0-9-]+)\s*:/gm;
const USAGE = /var\(\s*--([a-z0-9-]+)/g;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

describe('theme variables', () => {
  it('finds the stylesheets at all', () => {
    // Guards the whole file: a moved styles directory would otherwise make
    // every assertion below vacuously true.
    expect(sheets.length).toBeGreaterThan(0);
  });

  it('defines every variable the stylesheets use', () => {
    const defined = new Set();
    for (const { text } of sheets) {
      for (const match of code(text).matchAll(DECLARATION)) defined.add(match[1]);
    }

    const undeclared = [];
    for (const { name, text } of sheets) {
      for (const match of code(text).matchAll(USAGE)) {
        if (!defined.has(match[1])) {
          undeclared.push(`--${match[1]} (${name}:${lineOf(text, match.index)})`);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('answers every themed variable in both dark and light', () => {
    // A variable defined only in the base renders its DARK value on a light
    // ground. The light block is an override list, so anything it names must be
    // in the base -- and anything the base themes must be answered here.
    //
    // The direction matters and is the thing step 5 corrected: `:root` is dark
    // now, following the shared file, and `[data-theme="light"]` overrides it.
    const theme = sheets.find((sheet) => sheet.name === 'theme.css');
    expect(theme, 'theme.css is where both themes live').toBeTruthy();

    const block = (selector) => {
      const start = theme.text.indexOf(selector);
      expect(start, `${selector} exists`).toBeGreaterThan(-1);
      const open = theme.text.indexOf('{', start);
      const body = code(theme.text).slice(open + 1, theme.text.indexOf('}', open));
      return new Set([...body.matchAll(DECLARATION)].map((match) => match[1]));
    };

    const light = block(':root[data-theme="light"]');
    const base = block(':root {');

    expect(
      [...light].filter((name) => !base.has(name)),
      'the light theme declares something the base never does, so it is not an override',
    ).toEqual([]);
  });

  it('does not shadow a shared token with a local one', () => {
    // DESIGN-SYSTEM-PLAN step 5, finding (c), as a standing check.
    //
    // The shared palette gives colours as RGB TRIPLETS (`--accent: 200 25 46`)
    // so they can take an alpha. Cadence used the same two names, `--accent` and
    // `--warn`, as finished colours. Redeclaring one in theme.css does not
    // produce a different colour -- it produces `background: 200 25 46`, an
    // invalid declaration that falls back to whatever was inherited. That is a
    // worse failure than a wrong colour because nothing about it looks broken.
    const shared = sheets.find((sheet) => sheet.name === 'tokens.css');
    const theme = sheets.find((sheet) => sheet.name === 'theme.css');
    expect(shared, 'tokens.css is the shared copy').toBeTruthy();

    const names = (text) => new Set([...code(text).matchAll(DECLARATION)].map((m) => m[1]));
    const shadowed = [...names(theme.text)].filter(
      (name) => names(shared.text).has(name) && !PER_APP.has(name),
    );

    expect(
      shadowed.sort(),
      'theme.css redeclares a shared token; define a Cadence name FROM it instead',
    ).toEqual([]);
  });

  it('uses the shared triplets as triplets', () => {
    // The other half of the same finding: having stopped shadowing them, every
    // use site has to read `rgb(var(--accent))`. A bare `var(--accent)` left
    // behind is the exact invalid declaration described above.
    const offenders = [];
    for (const { name, text } of sheets) {
      if (name === 'tokens.css') continue;
      for (const match of code(text).matchAll(
        /(?<!rgb\()var\(\s*--(accent|warn|bad|ok|hot|hyper|brand|depth|surface|ink|mist)\s*[,)]/g,
      )) {
        offenders.push(`--${match[1]} (${name}:${lineOf(text, match.index)})`);
      }
    }
    expect(offenders, 'these are RGB triplets and must be wrapped in rgb()').toEqual([]);
  });
});
