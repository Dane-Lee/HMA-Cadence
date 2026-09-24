/* WHO THIS DEPLOYMENT IS FOR.
 *
 * Cadence is built for one employer at a time, and until 2026-09-24 that
 * employer was spelled into the markup in four places: the login card's site
 * line, the login card's mark, and the mark in both app headers.
 *
 * The owner, on being asked whether the Hendrickson mark should stay hardcoded
 * when the "Hendrickson · Navarre" line beside it was being removed for exactly
 * that reason:
 *
 *   "you're right. let's keep 'Hendrickson - Navarre' and keep the
 *    'Hendrickson H', make both of those aspects configurable (to avoid
 *    potential hiccups in the future)."
 *
 * So both are settings now, and both keep today's values as their defaults.
 *
 * WHY DEFAULTS RATHER THAN REQUIRED. `VITE_RETURN_ADDRESS` is unset by default
 * and its absence is a handled state, which is the right shape for an address
 * that must not be published from a public repo. This is different: a client
 * name and a logo are not secrets, and defaulting them to nothing would blank
 * the branding of the deployment that exists today to serve a future one that
 * does not. So the defaults are the current values, and EMPTY IS ALSO A REAL
 * SETTING -- set either to "" and that piece disappears cleanly rather than
 * rendering a broken image or a stray separator.
 *
 * BUILD-TIME, like the return address: changing it costs one redeploy, and
 * `import.meta.env` is replaced at build time, so there is nothing to read at
 * runtime and nothing to get wrong on a phone that cached the old bundle.
 */

const DEFAULT_CLIENT_NAME = 'Hendrickson · Navarre';
const DEFAULT_CLIENT_LOGO = '/hendrickson-logo.jpg';

/** `undefined` means "not configured" -> the default. `''` means "deliberately
 *  none" -> hide it. Those are different answers and the caller needs both. */
function setting(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed;
}

export function clientName(env = import.meta.env) {
  return setting(env?.VITE_CLIENT_NAME, DEFAULT_CLIENT_NAME);
}

export function clientLogo(env = import.meta.env) {
  return setting(env?.VITE_CLIENT_LOGO, DEFAULT_CLIENT_LOGO);
}

/** The alt text for the client mark. Derived from the name rather than being a
 *  third setting: a deployment that sets one and forgets the other would
 *  otherwise ship a screen reader announcing the wrong company. */
export function clientLogoAlt(env = import.meta.env) {
  const name = clientName(env);
  if (!name) return 'Client logo';
  // "Hendrickson · Navarre" -> "Hendrickson". The site is not part of the mark.
  return name.split('·')[0].trim() || 'Client logo';
}
