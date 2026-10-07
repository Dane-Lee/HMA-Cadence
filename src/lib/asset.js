/**
 * A file from `public/`, under whatever base this build was given.
 *
 * "/" on the employee's phone. "/cadence/" in the admin build, which the suite
 * serves at /cadence since 2026-10-07 -- where a bare "/ati-logo-positive.png"
 * would ask the SUITE for the file and come back a broken image.
 *
 * Written with the leading slash, so the source still reads as the path it
 * always was (and the logo tests that look for it still find it). Anything that
 * is not root-relative passes through untouched: a full URL, or "" -- which the
 * branding settings use to mean "show no mark".
 */
export function asset(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return path;
  return import.meta.env.BASE_URL + path.slice(1);
}
