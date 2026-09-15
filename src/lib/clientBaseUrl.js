/**
 * Where an employee's phone lands when it scans a plan QR.
 *
 * `VITE_CLIENT_BASE_URL`, or nothing. There is deliberately **no fallback to
 * `window.location.origin`**, and the absence is the point.
 *
 * That fallback used to be correct: one build served both the admin and the
 * client, so the admin's own origin *was* where the phone should land. The
 * client/admin split (2026-09-15) made it permanently wrong -- this value is
 * only ever read by `AdminIssuePlan`, which exists solely in the admin build,
 * and the admin build is never the thing an employee opens. The admin runs at
 * `http://localhost:5173`.
 *
 * Wrong in the worst available way, too. `normalizeBaseUrl` accepts
 * `http://localhost:5173` because it is a perfectly valid base: the QR mints,
 * renders, prints and scans without a single complaint, and fails for the first
 * time in an employee's hands, a day later, away from the machine that made it.
 * Nothing on the sheet looks different.
 *
 * Empty is the honest answer and it fails loudly instead: `normalizeBaseUrl`
 * refuses an empty base, so issuing stops on the admin's own screen, before the
 * printer. The issue page's address field stays editable, so an admin who hits
 * this can type the URL and carry on.
 *
 * Unset is a real state, not a hypothetical: `.env` is gitignored (the return
 * address in it must not be committed to a public repo), so a fresh clone of
 * this repo has no value here at all.
 */
export function defaultBaseUrl(env = import.meta.env) {
  const configured = env?.VITE_CLIENT_BASE_URL;
  return configured ? String(configured).trim() : '';
}
