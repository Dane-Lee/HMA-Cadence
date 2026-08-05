/**
 * URL fragment intake.
 *
 * A scanned QR opens Cadence at `/#k=…` (pairing) or `/#p=…` (plan). Fragments
 * are never sent in an HTTP request, so the key/plan reaches the browser without
 * touching the host serving the app — that property is the whole reason the
 * payload rides in the fragment instead of a query string.
 *
 * Called once from main.jsx BEFORE React mounts, so that:
 *   1. the fragment is stripped from the URL immediately (history.replaceState),
 *      keeping it out of browser history and out of Google/Apple history sync;
 *   2. the router boots on the right route with a clean URL.
 *
 * The captured value is held in module memory only — never localStorage, never
 * sessionStorage. A pairing key must not outlive the page load that received it.
 * (An unopenable plan is persisted separately, as ciphertext — see pending.js.)
 */

const ROUTE_FOR = { k: '/pair', p: '/plan' };

let captured = null;

export function captureQrFragment() {
  if (typeof window === 'undefined') return null;

  const match = /^#(k|p)=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match) return null;

  const [, kind, data] = match;
  captured = { kind, data };

  // Strip the payload and land on the handling route in one replace, so the
  // fragment never enters the history stack.
  window.history.replaceState(null, '', ROUTE_FOR[kind] + window.location.search);
  return captured;
}

/**
 * Read the captured payload for a route. Deliberately non-consuming: React
 * StrictMode remounts pages in development, and a read-once API would leave the
 * second mount with nothing to show. Both handlers are idempotent, so re-reading
 * is safe.
 */
export function readQrFragment(kind) {
  return captured?.kind === kind ? captured.data : null;
}

/** Drop the captured payload once the user has moved past the handling screen. */
export function clearQrFragment() {
  captured = null;
}
