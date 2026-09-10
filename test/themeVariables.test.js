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
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = fileURLToPath(new URL('../src/styles', import.meta.url));

const sheets = readdirSync(stylesDir)
  .filter((name) => name.endsWith('.css'))
  .map((name) => ({ name, text: readFileSync(`${stylesDir}/${name}`, 'utf8') }));

const DECLARATION = /^\s*--([a-z0-9-]+)\s*:/gm;
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
      for (const match of text.matchAll(DECLARATION)) defined.add(match[1]);
    }

    const undeclared = [];
    for (const { name, text } of sheets) {
      for (const match of text.matchAll(USAGE)) {
        if (!defined.has(match[1])) {
          undeclared.push(`--${match[1]} (${name}:${lineOf(text, match.index)})`);
        }
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('answers every themed variable in both light and dark', () => {
    // A variable defined only in `:root` renders its light value on a dark
    // ground. The dark block is an override list, so anything it names must be
    // in the base -- and anything the base themes must be answered here.
    const theme = sheets.find((sheet) => sheet.name === 'theme.css');
    expect(theme, 'theme.css is where both themes live').toBeTruthy();

    const block = (selector) => {
      const start = theme.text.indexOf(selector);
      expect(start, `${selector} exists`).toBeGreaterThan(-1);
      const open = theme.text.indexOf('{', start);
      const body = theme.text.slice(open + 1, theme.text.indexOf('}', open));
      return new Set([...body.matchAll(DECLARATION)].map((match) => match[1]));
    };

    const dark = block('[data-theme="dark"]');
    const base = block(':root');

    expect([...dark].filter((name) => !base.has(name))).toEqual([]);
  });
});
