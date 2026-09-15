/**
 * An unset client base URL must stop the issue, not quietly become localhost.
 *
 * This is the failure the client/admin split created and nothing else in the
 * suite would catch. `AdminIssuePlan` lives only in the admin build, so the
 * origin it runs at is `http://localhost:5173` -- never where an employee's
 * phone should land. While one build served both halves, defaulting to
 * `window.location.origin` was right; afterwards it is wrong every single time.
 *
 * What makes it worth a test rather than a comment is how it fails. A base of
 * `http://localhost:5173` is a valid base: the key mints, the envelope encrypts,
 * both codes render, the sheet prints, and the phone scans it cleanly. The first
 * sign of trouble is an employee in a different building on a different day
 * looking at a page that will not load, holding a sheet on which nothing is
 * visibly wrong. There is no error to read and no way back to the cause.
 *
 * And "unset" is the ordinary state, not the exotic one: `.env` is gitignored,
 * so every fresh clone starts here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defaultBaseUrl } from '../src/lib/clientBaseUrl.js';
import { buildPlanQr, normalizeBaseUrl, PlanQrError } from '../src/lib/qr/planQr.js';

const SAMPLE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../docs/sample-plan-payload.json', import.meta.url)), 'utf8'),
);

describe('the client base URL an admin issues against', () => {
  it('is the configured address when one is set', () => {
    expect(defaultBaseUrl({ VITE_CLIENT_BASE_URL: 'https://hma-cadence.vercel.app' }))
      .toBe('https://hma-cadence.vercel.app');
  });

  it('tolerates the whitespace that comes with pasting a URL', () => {
    expect(defaultBaseUrl({ VITE_CLIENT_BASE_URL: '  https://hma-cadence.vercel.app \n' }))
      .toBe('https://hma-cadence.vercel.app');
  });

  it('is EMPTY when unset — never the admin app’s own origin', () => {
    expect(defaultBaseUrl({})).toBe('');
    expect(defaultBaseUrl(null)).toBe('');
    expect(defaultBaseUrl({ VITE_CLIENT_BASE_URL: '' })).toBe('');

    /* Deliberately NOT asserted: `defaultBaseUrl()` with no argument. The
     * default parameter reads the real `import.meta.env`, and vitest loads
     * `.env` -- so on this machine that call returns the configured URL and on
     * a fresh clone it returns ''. A test on it would pass or fail by which
     * machine ran it, which is the exact failure mode HANDOFF 2026-08-20 cost a
     * day to. The environment is injected here so the assertions are about the
     * function. */
  });

  it('never returns an origin just because the code is running in a browser', () => {
    /* The regression guard. A `window` with a location is exactly the condition
     * the removed fallback keyed on, so if that fallback ever comes back, this
     * is the test that notices. */
    const priorWindow = globalThis.window;
    globalThis.window = { location: { origin: 'http://localhost:5173' } };
    try {
      expect(defaultBaseUrl({})).toBe('');
    } finally {
      if (priorWindow === undefined) delete globalThis.window;
      else globalThis.window = priorWindow;
    }
  });

  it('refuses to mint a key at all when it is unset', async () => {
    /* The behaviour that matters. Empty is only useful because it stops the
     * issue here, on the admin's screen, rather than producing a sheet. */
    await expect(
      buildPlanQr(structuredClone(SAMPLE), { baseUrl: defaultBaseUrl({}) }),
    ).rejects.toBeInstanceOf(PlanQrError);
  });

  it('CONTROL: a localhost base would have been accepted without complaint', () => {
    /* Why the check has to sit in `defaultBaseUrl` and cannot be left to
     * `normalizeBaseUrl`. Nothing downstream finds localhost suspicious — it is
     * a well-formed base URL and is treated as one. If this ever starts
     * throwing, the test above has stopped discriminating and this says so
     * rather than going quietly vacuous. */
    expect(normalizeBaseUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });
});
