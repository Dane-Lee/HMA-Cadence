/**
 * Data-layer entry point.
 *
 * Selects the active backend adapter and re-exports its functions as the single
 * `db` object the rest of the app uses. Views/auth import from here (or via the
 * `queries.js` facade) and never touch a database client directly, so swapping
 * backends is a one-line change here.
 *
 * Backends:
 *   • 'local' (default) — fictional data in localStorage, no cloud. The path
 *     ATI IT approved for building everything except the banned parts.
 *   • A future ATI-sanctioned DB — add its adapter under ./adapters/ and wire it
 *     below. See ./contract.js for the exact surface an adapter must implement.
 *
 * NOTE: The Supabase adapter (./adapters/supabase.js) is deliberately NOT
 * importable here — Supabase is prohibited as the DB. It is kept only as the
 * reference implementation of the contract.
 */
import * as local from './adapters/localAdapter.js';

const BACKENDS = {
  local,
};

// Overridable via VITE_DATA_BACKEND, but defaults to (and currently only
// offers) the local adapter.
const requested = import.meta.env.VITE_DATA_BACKEND ?? 'local';
export const DATA_BACKEND = BACKENDS[requested] ? requested : 'local';

if (!BACKENDS[requested]) {
  console.warn(
    `[hma-cadence] Unknown VITE_DATA_BACKEND "${requested}"; falling back to "local".`,
  );
}

export const db = BACKENDS[DATA_BACKEND];
