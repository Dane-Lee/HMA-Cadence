/**
 * Cadence's copy of `design/tokens.css` must not drift from the suite's.
 *
 * DESIGN-SYSTEM-PLAN step 7 kills the drift that produced the estate's two
 * design families, and it knew about two ways an app consumes the shared file:
 * the React apps `@import` it, the single-file apps carry a marked copy inline.
 * **Cadence is a third**, recorded as step 5 finding (a) on 2026-09-10 -- a
 * separate repository that deploys independently, so it can neither import
 * across the tree nor be one HTML file. Its copy was therefore the one copy in
 * the estate that nothing checked.
 *
 * This is the Cadence half. The suite half is `test_design_tokens.py`, which
 * runs from the other repo and compares the same two files. Both exist on
 * purpose: this one runs in the repo that actually deploys, and fails a Cadence
 * build; that one runs where `design/tokens.css` lives, and fails if someone
 * edits the source without pushing the copy. Either repo alone can be checked
 * out without the other, which is exactly how the two machines work.
 *
 * SKIPS, rather than fails, when the suite repo is not beside this one. That is
 * the normal case on a machine that cloned Cadence alone, and a test that
 * cannot see the reference has nothing to say about it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BEGIN = '/* ==== SHARED TOKENS — COPY START (keep byte-identical across apps) ==== */';
const END = '/* ==== SHARED TOKENS — COPY END ==== */';

const localCopy = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));

/** `design/tokens.css` in the suite repo, wherever that repo sits.
 *
 *  Probed at two depths rather than hardcoded, for the same reason
 *  `estate-status.mjs` probes for the Tracker: the repos are laid out
 *  differently on the two machines, and one of them has already spent a while
 *  reporting a cloned repo as "not cloned on this machine". */
function sharedSource() {
  const roots = [
    new URL('../../design/tokens.css', import.meta.url),
    new URL('../../HMA-Assessment-Suite/design/tokens.css', import.meta.url),
  ];
  for (const url of roots) {
    const path = fileURLToPath(url);
    if (existsSync(path)) return path;
  }
  return null;
}

function markedRegion(text) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end + END.length);
}

describe('the shared design tokens', () => {
  it('are carried in this repo, between the copy markers', () => {
    // Asserted separately from the comparison below so that a missing or
    // mangled copy fails here with a clear cause, rather than as a confusing
    // "differs from the source" when the source is not even reachable.
    expect(existsSync(localCopy), 'src/styles/tokens.css is missing').toBe(true);
    const region = markedRegion(readFileSync(localCopy, 'utf8'));
    expect(region, 'src/styles/tokens.css no longer carries the marked region').toBeTruthy();
  });

  it('are byte-identical to the suite copy', () => {
    const source = sharedSource();
    if (!source) {
      // Not a failure: Cadence is a standalone repo and is routinely checked out
      // without the suite beside it.
      expect(true).toBe(true);
      return;
    }

    const expected = markedRegion(readFileSync(source, 'utf8'));
    expect(expected, `${source} no longer carries the marked region`).toBeTruthy();

    const carried = markedRegion(readFileSync(localCopy, 'utf8'));
    expect(
      carried,
      'src/styles/tokens.css differs from design/tokens.css. Copy the block over ' +
        'verbatim -- the copy IS the contract, and editing it here is the drift ' +
        'this test exists for. Cadence-local decisions belong in theme.css.',
    ).toBe(expected);
  });

  it('is imported, along with the brand faces, before anything that uses them', () => {
    // A CSS @import must precede every rule in its file, so position is forced
    // -- but the failure mode if one were dropped is quiet: `var(--accent)`
    // resolves to nothing and the page renders in inherited colour rather than
    // throwing, and a missing @font-face just falls back to a system face that
    // looks plausible.
    //
    // Two imports since 2026-09-17: the tokens, and `brand-fonts.css`, which
    // carries Barlow Condensed / Barlow / Bitter embedded. The faces come FIRST
    // because tokens.css names them in --font-display and friends.
    const theme = readFileSync(
      fileURLToPath(new URL('../src/styles/theme.css', import.meta.url)),
      'utf8',
    );
    const imports = [...theme.matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports, 'theme.css must import the faces then the tokens').toEqual([
      './brand-fonts.css',
      './tokens.css',
    ]);

    // Nothing may precede them but comments and whitespace.
    const beforeFirstImport = theme.slice(0, theme.indexOf('@import'));
    expect(beforeFirstImport.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
  });

  it('ships the brand faces it names', () => {
    // tokens.css names Barlow Condensed, Barlow and Bitter. If the embedded file
    // is missing or has lost a family, every one of them silently falls back to
    // a system face -- which on a plant phone is exactly the substitution the
    // brand faces exist to prevent.
    const faces = readFileSync(
      fileURLToPath(new URL('../src/styles/brand-fonts.css', import.meta.url)),
      'utf8',
    );
    for (const family of ['Barlow Condensed', 'Barlow', 'Bitter']) {
      expect(
        faces.includes(`font-family:'${family}'`),
        `${family} is not embedded in src/styles/brand-fonts.css`,
      ).toBe(true);
    }
    expect(faces.includes('base64'), 'the faces are referenced, not embedded').toBe(true);
  });
});
