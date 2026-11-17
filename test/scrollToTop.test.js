/**
 * Every Cadence-Admin screen opens at the top (owner, 2026-11-17: "whenever you
 * click to a new screen (for whatever reason, in whatever manner) ... it
 * automatically starts that window at the top").
 *
 * The behaviour itself is tested in HMA-Manual, where the identical component
 * lives and the tests have a DOM (src/components/ScrollToTop.test.tsx there).
 * This repo's tests run in Node, so what is checked here is the part that can
 * only go wrong in this repo: that the admin build mounts it, inside the router,
 * and that the employee's phone app -- which was not part of the request -- does
 * not carry it.
 *
 * The bundle marker is `scrollRestoration`: a property name, so the minifier
 * keeps it, and nothing else in Cadence uses it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

describe('Cadence-Admin opens every screen at the top', () => {
  it('main.jsx mounts ScrollToTop inside the router, in the admin build only', () => {
    const main = read('src/main.jsx');
    const router = main.indexOf('<BrowserRouter');
    const mount = main.indexOf('{__ADMIN_BUILD__ ? <ScrollToTop /> : null}');
    expect(mount, 'ScrollToTop is not mounted behind __ADMIN_BUILD__').toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(router);
    expect(mount).toBeLessThan(main.indexOf('</BrowserRouter>'));
    // Reloads and Back as well, in the admin branch only.
    const adminBranch = main.slice(main.indexOf('if (__ADMIN_BUILD__) {'));
    expect(adminBranch).toContain('startPagesAtTop();');
  });

  it('keys on the path, so a query or anchor within one screen does not move you', () => {
    const src = read('src/components/ScrollToTop.jsx');
    expect(src).toMatch(/const \{ pathname \} = useLocation\(\);/);
    expect(src).toMatch(/\}, \[pathname\]\);/);
  });

  const bundle = (dir) => {
    const assets = `${root}${dir}/assets`;
    if (!existsSync(assets)) return null;
    return readdirSync(assets).filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(`${assets}/${f}`, 'utf8')).join('\n');
  };

  it('is in the admin bundle and not in the phone bundle, when both are built', () => {
    const admin = bundle('dist-admin');
    const client = bundle('dist-client');
    if (admin === null || client === null) return; // no build here: the source check above stands
    expect(admin).toContain('scrollRestoration');
    expect(client).not.toContain('scrollRestoration');
  });
});
