/**
 * `image_ref` is a bare filename that Cadence resolves against its own assets.
 * The Tracker converted every exercise image to WebP on 2026-08-21, but the
 * fixtures and the contract doc here kept saying `.png` for five days — nothing
 * failed, because none of it is executed, which is exactly why it drifted.
 *
 * The Tracker asserts the same property at its source (`DEFAULT_IMAGES` must be
 * a flat `/images/<name>.webp`). This is the receiving half: the examples Cadence
 * ships must describe a payload the Tracker could actually send, or they teach
 * the wrong shape to whoever reads them next.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const SOURCES = [
  'src/lib/data/localSeed.js',
  'src/pages/AdminImportPlan.jsx',
  'docs/plan-payload-contract.md',
  'docs/sample-plan-payload.json',
];

describe('image_ref examples match what the Tracker emits', () => {
  it.each(SOURCES)('%s references no stale image format', (rel) => {
    const stale = read(rel).match(/[\w ()'-]+\.(png|jpg|jpeg|gif)\b/gi) ?? [];
    expect(stale).toEqual([]);
  });

  it('the shipped sample payload uses bare .webp filenames, never paths', () => {
    const sample = JSON.parse(read('docs/sample-plan-payload.json'));
    const refs = (sample.exercises ?? []).map((e) => e.image_ref).filter(Boolean);
    expect(refs.length).toBeGreaterThan(0); // guard against the file quietly emptying
    for (const ref of refs) {
      expect(ref).toMatch(/\.webp$/);
      expect(ref).not.toContain('/'); // Cadence resolves it; a path would escape that
    }
  });
});
