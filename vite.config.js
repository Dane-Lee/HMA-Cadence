import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Two builds from one codebase (PIPELINE-WORKFLOW-PLAN, Phase 5 / decision E6).
//
// The client build is what an employee's phone downloads, and it must not
// physically contain the admin pages -- excluded at COMPILE time, not hidden
// behind a runtime role check. The mechanism is the `#admin-routes` alias below:
// in the client build it resolves to an empty array, so `AdminIssuePlan` and the
// key-minting `buildPlanQr()` behind it are never in the module graph at all.
// Nothing is left for tree-shaking to miss.
//
// `admin` is the variant that includes them, and it is NEVER deployed -- it runs
// locally on the practitioner's machine, because it mints plan keys.
//
// The default is deliberately CLIENT, not admin. A host that runs a bare
// `npm run build` (which is what Vercel does unless told otherwise) must produce
// the safe artifact. Getting the variant wrong should cost the admin their local
// convenience, never publish the admin app to the internet. `npm run dev` sets
// admin explicitly, so local practitioner use is unaffected.
const VARIANT = process.env.CADENCE_VARIANT === 'admin' ? 'admin' : 'client';
const IS_ADMIN = VARIANT === 'admin';

const adminRoutesModule = IS_ADMIN
  ? './src/routes/adminRoutes.jsx'
  : './src/routes/adminRoutes.none.jsx';

export default defineConfig(({ command }) => {
  // The demo seed is stripped from the deployed client build (decision A2).
  //
  // It was not, and that was found on 2026-09-16 by reading the live bundle:
  // `Maria Santos` and the other four personas were in it. Cadence is the one
  // employee-facing app in the estate, so those fictional health records,
  // programmes and pain reports were sitting on the phone of every real person
  // who installed it -- indistinguishable at a glance from somebody's own data.
  //
  // Keyed on `command === 'build'` rather than on a mode, for the same reason
  // the variant is not a mode. `npm run dev` and vitest both run as `serve`, so
  // the seed stays exactly where A2 wants it -- in dev and in tests -- and
  // leaves on the way to a deployable artifact.
  //
  // `!IS_ADMIN` is a deliberate exception and the one piece of A2 still open.
  // The seed carries the ONLY admin account (`ADMIN001`/`1234`), so stripping it
  // from the admin build locks the practitioner out with no way back in. A2's
  // "admin: empty roster" needs a bootstrap admin account first, which touches
  // auth. The admin build is never deployed, so its fictional roster is untidy
  // rather than exposed.
  const stripSeed = command === 'build' && !IS_ADMIN;
  const seedModule = stripSeed
    ? './src/lib/data/localSeed.none.js'
    : './src/lib/data/localSeed.js';

  return {
    define: {
      // Read by App.jsx to decide where an admin-role account belongs. In the
      // client build `/admin` is not a route, so it must not be a redirect target.
      __ADMIN_BUILD__: JSON.stringify(IS_ADMIN),
    },
    resolve: {
      alias: {
        '#admin-routes': fileURLToPath(new URL(adminRoutesModule, import.meta.url)),
        '#seed': fileURLToPath(new URL(seedModule, import.meta.url)),
      },
    },
    build: {
      // Separate directories so a client deploy can never pick up an admin build
      // left behind by an earlier local run.
      outDir: IS_ADMIN ? 'dist-admin' : 'dist-client',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'HMA Cadence',
          short_name: 'Cadence',
          description: 'Track your corrective exercise program',
          theme_color: '#0e0e0e',
          background_color: '#0a0a0a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            {
              src: 'pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/storage/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'exercise-images',
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5174,
      host: true,
      // Vite denies unknown Host headers by default; bare IPs are allowed but DNS
      // names are not. Device testing over Tailscale arrives as
      // <machine>.<tailnet>.ts.net, which is how a phone gets a trusted HTTPS
      // origin here — real cert, so service workers register and the PWA installs
      // for real. A LAN IP over plain http cannot do either.
      // `.ts.net` is reachable only from inside the tailnet, not the public internet.
      allowedHosts: ['.ts.net'],
    },
  };
});
