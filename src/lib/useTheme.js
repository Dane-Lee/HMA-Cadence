import { useCallback, useEffect, useState } from 'react';

/** Light / dark for Cadence, which never had a toggle.
 *
 * Owner, 2026-09-17: "Every program will have light/dark mode, and every program
 * will have it as a Sun/Moon on the button." Until now this app was dark-only:
 * `index.html` hard-codes `data-theme="dark"` and nothing ever changed it.
 *
 * The theme lives on `<html data-theme>` because that is what `tokens.css`
 * answers -- `:root` is dark, `:root[data-theme="light"]` is the override.
 * The choice is saved raw in localStorage rather than in the data layer: it is
 * a per-device display preference, never shared, the same call the Overlay and
 * the Tracker made and recorded.
 *
 * `applyTheme` is also called once at module load, before React renders, so a
 * phone that chose light does not flash the dark ground on every open.
 */
const KEY = 'hma-cadence-theme';

function read() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  // The PWA's status bar colour should follow the ground.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#cccccc' : '#000000');
}

applyTheme(read());

export function useTheme() {
  const [theme, setTheme] = useState(read);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // A private window or a locked-down browser; the choice just does not persist.
      }
      return next;
    });
  }, []);

  return { theme, isDark: theme === 'dark', toggle };
}
