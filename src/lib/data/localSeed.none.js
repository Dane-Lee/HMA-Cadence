/**
 * The demo seed, as the deployed client build sees it: there is none.
 *
 * `vite.config.js` aliases `#seed` here for a production CLIENT build, so
 * `localSeed.js` -- and the five fictional people in it -- is never pulled into
 * the module graph. Not tree-shaken out afterwards: never in. Same mechanism as
 * `adminRoutes.none.jsx`, for the same reason, which is that "eliminated at
 * compile time" and "hidden at runtime" are different promises and only one of
 * them survives someone reading the bundle.
 *
 * WHY IT MATTERS HERE. Decision A2 says the seed is "stripped from production
 * builds ... the dead branch is eliminated at compile time so personas are
 * physically absent from shipped files." It was not: `Maria Santos` and the rest
 * were readable in the deployed bundle on 2026-09-16. Cadence is the one
 * employee-facing app in the estate, so those names sat on the phone of every
 * real person who installed it -- fictional health records, invented programmes
 * and invented pain reports, indistinguishable at a glance from somebody's
 * actual data.
 *
 * AN EMPTY STORE IS THE CORRECT STARTING STATE, not a degraded one. A phone that
 * has not scanned a plan has no employee, no programme and no history, and the
 * app already says so -- `EmployeeToday` and `AdminEmployees` both have empty
 * states. Scanning a plan QR is what creates the account, via `ingestPlan`.
 *
 * THE ADMIN BUILD KEEPS ITS SEED, deliberately, and this is the one piece of A2
 * left undone. The seed carries the only admin account there is
 * (`ADMIN001`/`1234`), so stripping it from the admin build locks the
 * practitioner out of their own app with no way back in. A2's "admin: empty
 * roster" needs a bootstrap admin account first, which touches auth and is its
 * own piece of work. The admin build is never deployed -- it runs locally on the
 * practitioner's machine -- so the fictional roster there is a tidiness problem,
 * not an exposure one.
 *
 * Keys, not values: every key `buildSeedDb` returns is present and empty. The
 * adapter indexes into these directly (`store.employees.find(...)`), so a
 * missing key is a crash rather than an absence.
 */
export function buildSeedDb() {
  return {
    employees: [],
    exercise_library: [],
    programs: [],
    exercise_assignments: [],
    check_ins: [],
    exercise_completions: [],
    exercise_feedback: [],
    pain_reports: [],
  };
}
