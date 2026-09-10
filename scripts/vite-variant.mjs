/**
 * Run Vite with a build variant selected: `node scripts/vite-variant.mjs <variant> [vite args]`
 *
 * This exists because the variant has to reach `vite.config.js` as an
 * environment variable, and `CADENCE_VARIANT=admin vite build` is not valid on
 * Windows -- where the admin build is the only one that ever runs. The usual fix
 * is `cross-env`, which cannot be added here: the ATI machine cannot
 * `npm install` at all (corporate TLS interception), so a new dependency would
 * make the admin build unbuildable on the one machine that needs it.
 *
 * Vite's own `--mode` was the other candidate and was rejected: for a build,
 * Vite derives `isProduction` from the mode, so a custom mode risks shipping a
 * development React build. The variant is not a mode -- it is which files exist.
 */
import { spawn } from 'node:child_process';

const [variant, ...args] = process.argv.slice(2);

if (variant !== 'admin' && variant !== 'client') {
  console.error(`usage: node scripts/vite-variant.mjs <admin|client> [vite args]`);
  console.error(`got: ${variant ?? '(nothing)'}`);
  process.exit(1);
}

const child = spawn('vite', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CADENCE_VARIANT: variant },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
