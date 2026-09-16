/**
 * The client build must not contain the admin app.
 *
 * PIPELINE-WORKFLOW-PLAN Phase 5 accepts this step on one sentence: *"The
 * deployed bundle contains no admin routes."* The plan is equally specific about
 * the mechanism -- excluded **at compile time**, not hidden behind a runtime role
 * check -- because a role check leaves `AdminIssuePlan` in the bundle, and with
 * it `buildPlanQr()`, which mints plan keys. `planQr.js` says in its own comment
 * that key minting must happen on the admin's machine and never on a server.
 * Shipping it to every employee's phone is that same mistake pointing the other
 * way.
 *
 * Two checks, because they fail at different times and only one of them is
 * always available:
 *
 * 1. **The source check always runs.** If `App.jsx` imports an admin page
 *    directly, the split is defeated no matter what the config says, and that is
 *    a one-line mistake for someone to make later.
 * 2. **The bundle check runs when a build exists.** It is the real proof -- the
 *    source can be right and the alias still misconfigured.
 *
 * MARKERS ARE STRING LITERALS ON PURPOSE. The obvious markers (`AdminIssuePlan`,
 * `buildPlanQr`) are identifiers, and the minifier renames them: they are absent
 * from BOTH bundles, so a test built on them passes whatever happens. That was
 * checked rather than assumed, which is why the control below exists -- if a
 * marker stops appearing in the admin build it has stopped discriminating, and
 * this test says so instead of going quietly vacuous.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Strings that appear in the admin app and nowhere in the client app.
 *
 *  Deliberately NOT `AdminIssuePlan` / `buildPlanQr` -- see the note above.
 *  Deliberately NOT `This plan needs`, which looks admin-only but is also the
 *  opening of the client's own version-mismatch refusal ("This plan needs a
 *  newer version of Cadence than this device has"). Checked, not guessed. */
const ADMIN_MARKERS = [
  '/admin/issue',
  '/admin/returns',
  '/admin/import',
  '/admin/pain',
  'Where the phone lands',
  'Cadence would reject this plan',
  'too_large',
  'unknown_key',
  'not_a_return',
];

function bundleText(dir) {
  const assets = `${root}${dir}/assets`;
  if (!existsSync(assets)) return null;
  return readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(`${assets}/${name}`, 'utf8'))
    .join('\n');
}

/** Newest mtime under a directory, recursively. */
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(full));
    else newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

/** Is the built bundle older than the sources it was built from?
 *
 *  This guard exists because the first mutation test written against this file
 *  PASSED when it should have failed. Forcing the admin variant also moved
 *  `outDir` to `dist-admin`, so the mutated bundle was written elsewhere and the
 *  assertions happily read a `dist-client` from the previous, correct run. A
 *  stale artefact does not fail a bundle check -- it makes one meaningless, and
 *  quietly. So staleness is now a failure with a named fix rather than a pass. */
function staleness(dir) {
  const assets = `${root}${dir}/assets`;
  if (!existsSync(assets)) return null;
  const built = newestMtime(assets);
  const sources = Math.max(newestMtime(`${root}src`), statSync(`${root}vite.config.js`).mtimeMs);
  return sources > built ? { built, sources } : null;
}

describe('the client build excludes the admin app', () => {
  it('App.jsx reaches the admin routes only through the build-time alias', () => {
    const app = readFileSync(`${root}src/App.jsx`, 'utf8');

    const directAdminImports = [...app.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)]
      .map((match) => match[1])
      .filter((spec) => /pages\/Admin/.test(spec));

    expect(
      directAdminImports,
      'App.jsx must import admin pages only via "#admin-routes" -- a direct '
        + 'import puts them back in the employee bundle whatever vite.config says',
    ).toEqual([]);

    expect(app).toContain("from '#admin-routes'");
  });

  it('the alias resolves to an empty route list for the client', () => {
    const stub = readFileSync(`${root}src/routes/adminRoutes.none.jsx`, 'utf8');
    // The stub is the client's entire admin surface. If it ever gains a route,
    // the split is over and nothing else here would notice.
    expect(stub).toMatch(/const adminRoutes = \[\];/);
  });

  it('the admin bundle still contains the markers, or this test proves nothing', () => {
    const admin = bundleText('dist-admin');
    if (admin === null) {
      // Not a failure: the admin build is local-only and is not always present.
      // The client check below stands on its own; this one is the control.
      return;
    }
    const missing = ADMIN_MARKERS.filter((marker) => !admin.includes(marker));
    expect(
      missing,
      'these markers no longer appear in the admin build, so they can no longer '
        + 'discriminate -- replace them with strings the admin app really ships',
    ).toEqual([]);
  });

  it('the client bundle is not stale, so the check below means something', () => {
    const stale = staleness('dist-client');
    if (stale === null) return; // no build, or the build is newer than the source
    expect.fail(
      'dist-client is older than src/ or vite.config.js, so anything asserted '
      + 'about it describes a previous build. Run `npm run build:client` and '
      + 're-run. (This guard exists because a mutation test passed against a '
      + 'stale bundle.)',
    );
  });

  it('the client bundle contains no admin markers', () => {
    const client = bundleText('dist-client');
    if (client === null) {
      // `npm run build:client` has not been run in this checkout. The source
      // checks above still ran; this is the one that needs an artefact.
      return;
    }
    const found = ADMIN_MARKERS.filter((marker) => client.includes(marker));
    expect(
      found,
      'the client build is what an employee downloads and it must not contain '
        + 'the admin app -- check the #admin-routes alias in vite.config.js',
    ).toEqual([]);
  });
});

describe('the deploy points at the client build', () => {
  // Vercel's first attempt at this failed with "No Output Directory named
  // 'dist' found" -- which is the split working: the build makes dist-client
  // and dist-admin, and nothing is at the default path. Fixing that in the
  // dashboard would have left the decision in a web UI where neither session
  // can see it and a project recreated later would quietly lose it.
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
  );
  const viteConfig = readFileSync(
    fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    'utf8',
  );

  it('serves the directory the client build actually writes', () => {
    const match = viteConfig.match(/outDir: IS_ADMIN \? '([^']+)' : '([^']+)'/);
    expect(match, 'vite.config.js no longer declares the two outDirs').toBeTruthy();
    const [, adminDir, clientDir] = match;

    expect(config.outputDirectory).toBe(clientDir);
    expect(config.outputDirectory).not.toBe(adminDir);
  });

  it('never serves the admin build', () => {
    // The one that must never be deployed: it mints plan keys, and planQr.js
    // says in its own comment that key minting runs on the admin's machine and
    // never on a server. A deploy pointed here would publish that to everyone.
    expect(config.outputDirectory).not.toMatch(/admin/);
  });

  it('rewrites unknown paths to the app, so /scan survives a direct open', () => {
    // Cadence is a single-page app. Without this, opening /scan directly -- or
    // reloading on it, which is what a phone does constantly -- is a 404 from
    // the static host rather than the scanner.
    const catchAll = (config.rewrites ?? []).some(
      (rule) => rule.source === '/(.*)' && rule.destination === '/index.html',
    );
    expect(catchAll, 'vercel.json needs a catch-all rewrite to /index.html').toBe(true);
  });
});

describe('the app says which app it is', () => {
  it('the browser tab matches the installed app name', () => {
    // It said "HMA Tracker" for months -- a leftover from Cadence being cloned
    // from the Tracker. The owner found it on the deployed site and went
    // looking in Vercel for it, which is exactly the wrong place: it is in this
    // repo's index.html and nothing about hosting can change it.
    //
    // It matters more here than in most apps. Cadence is the one thing an
    // EMPLOYEE opens, on their own phone, and the tab and the home-screen icon
    // are most of what tells them what they installed.
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    const viteConfig = readFileSync(
      fileURLToPath(new URL('../vite.config.js', import.meta.url)),
      'utf8',
    );

    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    const manifestName = viteConfig.match(/name: '([^']+)'/)?.[1];

    expect(title, 'index.html has no <title>').toBeTruthy();
    expect(manifestName, 'vite.config.js has no PWA manifest name').toBeTruthy();
    expect(title).toBe(manifestName);
    expect(title).not.toMatch(/tracker/i);
  });
});

describe('the client build excludes the demo seed', () => {
  /* Decision A2: the seed is "stripped from production builds ... the dead
   * branch is eliminated at compile time so personas are physically absent from
   * shipped files."
   *
   * It was not. On 2026-09-16 the LIVE bundle at hma-cadence.vercel.app still
   * contained `Maria Santos` and the other four. Cadence is the one
   * employee-facing app in the estate, so five people's fictional health
   * records -- programmes, completions, pain reports -- were sitting on the
   * phone of every real person who installed it, indistinguishable at a glance
   * from their own data.
   *
   * Nothing caught it because nothing looked. `clientBuild.test.js` asked
   * whether the admin APP had leaked and never whether the demo DATA had, and
   * the seed is imported by the adapter every build uses, so there was no
   * variant difference to notice.
   *
   * The same string-literal rule as the admin markers applies: `buildSeedDb` is
   * an identifier and the minifier renames it, so it is absent from both
   * bundles and would prove nothing. Persona names are string data and survive.
   */
  const SEED_MARKERS = [
    'Maria Santos',
    'James Kowalski',
    'Priya Raman',
    'Tony Reeves',
    'ADMIN001',
  ];
  /* Persona NAMES, checked against both bundles rather than assumed. Two
   * earlier candidates were rejected by the control below: `must_change_pin:
   * false` is absent from the admin bundle because the minifier drops the space
   * and rewrites the boolean, and `must_change_pin` on its own appears in BOTH
   * because it is a field the adapter reads. Neither discriminates, and a
   * non-discriminating marker is a test that passes whatever happens. */

  it('the admin bundle still contains the seed, or this test proves nothing', () => {
    /* The control, and here it is also the intended behaviour rather than only
     * a discriminator: the seed carries the ONLY admin account, so an admin
     * build without it locks the practitioner out of their own app. If this
     * ever fails, check that before assuming the test is wrong. */
    const admin = bundleText('dist-admin');
    if (!admin) return; // no admin build on this machine; the client check still runs

    const missing = SEED_MARKERS.filter((marker) => !admin.includes(marker));
    expect(
      missing,
      'these markers no longer discriminate, so the client check below is vacuous',
    ).toEqual([]);
  });

  it('the client bundle contains no fictional people', () => {
    const client = bundleText('dist-client');
    if (!client) {
      console.warn('SKIPPED: no dist-client on this machine. Run `npm run build:client`.');
      return;
    }

    const found = SEED_MARKERS.filter((marker) => client.includes(marker));
    expect(
      found,
      'the demo seed is in the deployed client bundle — real employees would '
        + 'have these fictional records on their phones (decision A2)',
    ).toEqual([]);
  });

  it('the seed is excluded by the alias, not by a runtime check', () => {
    /* Same argument as the admin routes. A runtime `if (import.meta.env.PROD)`
     * leaves the personas in the file for anyone who opens it; the alias means
     * `localSeed.js` is never in the module graph at all. */
    const adapter = readFileSync(`${root}src/lib/data/adapters/localAdapter.js`, 'utf8');
    expect(adapter).toContain("from '#seed'");
    expect(
      adapter.includes("from '../localSeed.js'"),
      'the adapter imports the seed directly, so no build can exclude it',
    ).toBe(false);
  });

  it('the empty seed declares every key the real one does', () => {
    /* The adapter indexes straight into these (`store.employees.find(...)`), so
     * a key the empty seed forgets is a crash on an employee's phone at the
     * moment they scan their plan -- the one moment the app has to work. */
    const real = readFileSync(`${root}src/lib/data/localSeed.js`, 'utf8');
    const none = readFileSync(`${root}src/lib/data/localSeed.none.js`, 'utf8');

    const keysOf = (text) => {
      const at = text.indexOf('employees:');
      const block = text.slice(at, text.indexOf('};', at));
      return [...block.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
    };

    const missing = keysOf(real).filter((key) => !keysOf(none).includes(key));
    expect(missing, 'the empty seed is missing store keys the adapter reads').toEqual([]);
  });
});
