import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/* EVERY SCREEN OPENS AT THE TOP -- in Cadence-Admin, inside the suite. Owner,
 * 2026-11-17: "whenever you click to a new screen (for whatever reason, in
 * whatever manner) ... it automatically starts that window at the top."
 *
 * The same component as HMA-Manual's (src/components/ScrollToTop.tsx there,
 * which carries the behaviour test: this repo's tests run without a DOM). Keyed
 * on the path alone, so a query or #anchor within one screen does not move you.
 *
 * Mounted only in the admin build (main.jsx). The employee's phone app was not
 * part of the request and is left as it was. */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/* A reload or a Back into Cadence-Admin from another program starts at the top
 * too, rather than where the browser last left it. */
export function startPagesAtTop() {
  try {
    window.history.scrollRestoration = 'manual';
  } catch {
    /* not settable here: the browser's own default stands */
  }
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.scrollTo(0, 0);
  });
}
