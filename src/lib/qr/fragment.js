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

export const ROUTE_FOR = { k: '/pair', p: '/plan' };

let captured = null;

/**
 * Pull `{kind, data}` out of a scanned string, or null.
 *
 * Accepts both the bare fragment this file has always handled (`#p=…`) and the
 * whole URL a QR actually encodes (`https://host/#p=…`), because the in-app
 * scanner reads the printed code directly rather than being navigated to it.
 *
 * The host is deliberately not checked. A plan envelope is authenticated and
 * sealed to a device key, so a code pointing somewhere else cannot do anything
 * here beyond failing to open — and rejecting on host would break the moment
 * the deployment moves.
 */
export function parseQrPayload(text) {
  const match = /#(k|p)=([A-Za-z0-9_-]+)$/.exec(String(text ?? '').trim());
  if (!match) return null;
  return { kind: match[1], data: match[2] };
}

/**
 * Hand a payload to the handling routes without a page load. Used by the
 * in-app scanner: on iOS a Home Screen install has its own storage, so a code
 * scanned by the phone's camera opens in Safari and lands in the wrong copy.
 * Scanning inside the app keeps the key and the plan in one place.
 */
export function setQrPayload(payload) {
  captured = payload;
  return payload;
}

export function captureQrFragment() {
  if (typeof window === 'undefined') return null;

  const parsed = parseQrPayload(window.location.hash);
  if (!parsed) return null;

  captured = parsed;

  // Strip the payload and land on the handling route in one replace, so the
  // fragment never enters the history stack.
  window.history.replaceState(null, '', ROUTE_FOR[parsed.kind] + window.location.search);
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
