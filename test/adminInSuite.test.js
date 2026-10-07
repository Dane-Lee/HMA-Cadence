/**
 * Cadence-Admin lives inside the suite (owner, 2026-10-07: "Yes, move
 * Cadence-Admin inside the suite").
 *
 * The suite serves the ADMIN build at /cadence, behind its own sign-in, and the
 * admin build keeps its data in the suite's store instead of its own browser
 * storage -- where the suite could not read it and no backup reached it. The
 * employee's app is not part of this and must not change: test/clientBuild.test.js
 * holds that side.
 *
 * Checked here, from both ends: the build (paths under /cadence/, no seed, no
 * install machinery), the data (it loads from the suite before anything renders,
 * and writes cannot overtake each other), and the header (Home, no Sign Out).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

describe('the admin build is built for /cadence', () => {
  const dist = `${root}dist-admin`;
  const has = existsSync(`${dist}/index.html`);

  it('is not stale, so the checks below mean something', () => {
    if (!has) return; // not built on this machine; the source checks below still run
    const built = newestMtime(`${dist}/assets`);
    const sources = Math.max(newestMtime(`${root}src`), statSync(`${root}vite.config.js`).mtimeMs);
    expect(
      sources > built,
      'dist-admin is older than src/ or vite.config.js. Run `npm run build:admin` and re-run.',
    ).toBe(false);
  });

  it('asks for every asset under /cadence/, where the suite serves it', () => {
    if (!has) return;
    const html = readFileSync(`${dist}/index.html`, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => ref.startsWith('/') && !ref.startsWith('/cadence/'))).toEqual([]);
  });

  it('carries no install machinery -- that is the phone app only', () => {
    if (!has) return;
    expect(readdirSync(dist).filter((name) => /^(sw|registerSW)\.js$|manifest\.webmanifest$/.test(name))).toEqual([]);
    if (existsSync(`${root}dist-client/index.html`)) {
      // The control: the phone's build still has it, or the check above proves nothing.
      expect(readdirSync(`${root}dist-client`).some((name) => name.endsWith('.webmanifest'))).toBe(true);
    }
  });

  it('never strips the seed by a runtime check, and strips it from every admin run', () => {
    const config = readFileSync(`${root}vite.config.js`, 'utf8');
    expect(config).toContain("const stripSeed = IS_ADMIN || command === 'build';");
    expect(config).toContain("base: IS_ADMIN ? '/cadence/' : '/'");
  });
});

describe('asset() resolves public files under the build\'s base', () => {
  it('leaves the phone\'s paths exactly as they were', async () => {
    const { asset } = await import('../src/lib/asset.js');
    // The test run is the client build, whose base is "/".
    expect(asset('/ati-logo-positive.png')).toBe('/ati-logo-positive.png');
  });

  it('passes through what is not a root path: a full URL, or "" for "no mark"', async () => {
    const { asset } = await import('../src/lib/asset.js');
    expect(asset('https://example.com/logo.png')).toBe('https://example.com/logo.png');
    expect(asset('')).toBe('');
    expect(asset(undefined)).toBe(undefined);
  });
});

describe('who is signed in', () => {
  it('in the admin build: the admin, without a Cadence login -- the suite\'s sign-in is in front', async () => {
    const { initialSession, SUITE_ADMIN } = await import('../src/lib/auth.jsx');
    const session = initialSession(true);
    expect(session.employee).toEqual(SUITE_ADMIN);
    expect(session.employee.role).toBe('admin');
    expect(session.employee.must_change_pin).toBe(false);
  });

  it('on the phone: whatever this device signed in as, exactly as before', async () => {
    const { initialSession } = await import('../src/lib/auth.jsx');
    localStorage.setItem('hma-cadence:session', JSON.stringify({ employee: { id: 'e1', role: 'employee' } }));
    expect(initialSession(false).employee.id).toBe('e1');
    localStorage.removeItem('hma-cadence:session');
    expect(initialSession(false)).toBe(null);
  });
});

describe('the admin header inside the suite', () => {
  const shell = readFileSync(`${root}src/pages/AdminShell.jsx`, 'utf8');

  it('leads its nav with Home, to the suite, as a full page load', () => {
    const nav = shell.slice(shell.indexOf('<nav className="app-header__nav">'));
    expect(nav.indexOf('className="app-header__home" href="/"')).toBeGreaterThan(-1);
    expect(nav.indexOf('app-header__home')).toBeLessThan(nav.indexOf('<NavLink'));
  });

  it('has no Sign Out: there is one, on the suite home screen (D7)', () => {
    expect(shell).not.toContain('signOut');
    expect(shell).not.toContain('app-header__signout');
  });
});

/** A stand-in for the shared adapter: it records writes and lets the test say
 *  when each one lands, so ordering can be checked rather than hoped for. */
function holdingStorage(held = null) {
  const sent = [];
  const pending = [];
  return {
    sent,
    get: async () => (held === null ? null : { value: JSON.stringify(held) }),
    set: (key, value) => {
      sent.push({ key, value });
      return new Promise((resolve) => pending.push(resolve));
    },
    landNext: () => pending.shift()?.(),
  };
}

describe('saves to the suite cannot overtake each other', () => {
  beforeEach(() => localStorage.clear());

  it('sends one at a time, and only the newest of what queued meanwhile', async () => {
    const { makeSaver } = await import('../src/lib/data/suiteStore.js');
    const storage = holdingStorage();
    const save = makeSaver(storage, 'k');

    save({ n: 1 });
    save({ n: 2 });
    save({ n: 3 });
    expect(storage.sent.map((s) => JSON.parse(s.value).n)).toEqual([1]);

    storage.landNext();
    await vi.waitFor(() => expect(storage.sent).toHaveLength(2));
    expect(JSON.parse(storage.sent[1].value).n).toBe(3); // 2 was overtaken while waiting, never sent

    storage.landNext();
    await save.settled();
    expect(storage.sent).toHaveLength(2);
  });

  it('keeps this browser\'s copy current and marks it unsent the moment it is queued', async () => {
    const { makeSaver } = await import('../src/lib/data/suiteStore.js');
    const storage = holdingStorage();
    const save = makeSaver(storage, 'k');

    save({ n: 1 });
    save({ n: 2 });

    expect(JSON.parse(localStorage.getItem('k')).n).toBe(2);
    expect(localStorage.getItem('hma-unsent:k')).toBe('1');
  });

  it('re-marks unsent as each send starts, so a value still waiting survives a closed page', async () => {
    const { makeSaver } = await import('../src/lib/data/suiteStore.js');
    const storage = holdingStorage();
    const save = makeSaver(storage, 'k');

    save({ n: 1 });
    save({ n: 2 });
    // The real adapter clears the mark when the store takes a write.
    localStorage.removeItem('hma-unsent:k');
    storage.landNext();
    await vi.waitFor(() => expect(storage.sent).toHaveLength(2));

    expect(localStorage.getItem('hma-unsent:k')).toBe('1');
  });
});

describe('the data loads from the suite before anything renders', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => vi.resetModules());

  it('adopts what the suite holds, and every change after goes back to the suite', async () => {
    const { hydrateFromSuite } = await import('../src/lib/data/suiteStore.js');
    const db = await import('../src/lib/data/adapters/localAdapter.js');
    const storage = holdingStorage({ employees: [{ id: 'e-held', name: 'Held By The Suite' }] });

    await hydrateFromSuite(storage);
    await db.saveRecognitionKey('rk-test');

    expect(storage.sent).toHaveLength(1);
    const body = storage.sent[0].value;
    expect(body).toContain('e-held');
    expect(body).toContain('rk-test');
  });

  it('lays a held store over the empty shape, so a key it predates reads as empty', async () => {
    const { hydrateFromSuite } = await import('../src/lib/data/suiteStore.js');
    const db = await import('../src/lib/data/adapters/localAdapter.js');

    await hydrateFromSuite(holdingStorage({ employees: [] }));

    await expect(db.listIssuedPlanKeys()).resolves.toEqual([]);
  });

  it('on a first visit, writes the store straight away so the suite holds the key', async () => {
    const { hydrateFromSuite } = await import('../src/lib/data/suiteStore.js');
    const storage = holdingStorage(null);

    await hydrateFromSuite(storage);

    expect(storage.sent.map((s) => s.key)).toEqual(['hma-cadence:local-db']);
  });
});
