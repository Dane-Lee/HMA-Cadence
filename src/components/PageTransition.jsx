import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/** Screen transitions for Cadence: a fade-in on every screen, and a veil for the login.
 *
 * REWRITTEN 2026-09-17, the same evening it was first built. The first version
 * kept an "exit" phase in React state -- render the old screen at opacity 0
 * for a beat, then swap. The owner opened it and saw *"just a black fucking
 * screen. Nothing is loading at all."* An exit phase that depends on a timer to
 * leave it is a screen that stays black the moment anything interrupts the
 * timer, and it was not worth finding out which thing had.
 *
 * So the rule now: NOTHING here can leave a screen invisible. Two pieces:
 *
 *   1. `PageTransition` keys its wrapper on the location, so every screen
 *      change mounts fresh and plays a short fade-IN from CSS. There is no
 *      exit phase and no state that could stick. If the animation does not
 *      run for any reason, the screen simply appears.
 *
 *   2. The login gets the moment the owner asked for -- "a smooth and elegant
 *      (sexy, even) fade out/in" -- through a VEIL: a full-screen layer that
 *      fades to black over the login, the route changes underneath it at the
 *      peak, and it fades back out over the first real screen. The veil is a
 *      separate element that only ever animates its own opacity, it never
 *      blocks input (`pointer-events: none`), and a watchdog lifts it after
 *      1.5 s no matter what. Worst case is no effect, never a black screen.
 *
 * `useVeil()` gives a screen `cover()` and `reveal()`. Login is the only caller
 * today; anything else that earns a flourish can use the same two calls.
 */
const VeilContext = createContext({ cover: async () => {}, reveal: () => {} });

const COVER_MS = 340;
const WATCHDOG_MS = 1500;

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useVeil() {
  return useContext(VeilContext);
}

export default function PageTransition({ children }) {
  const location = useLocation();
  const [covered, setCovered] = useState(false);
  const watchdog = useRef(null);

  // The veil can never be left down. Whatever called cover() is expected to
  // call reveal(); if it does not -- an exception, an unmount, a navigation
  // that never completes -- this lifts it anyway.
  useEffect(() => {
    if (!covered) return undefined;
    watchdog.current = setTimeout(() => setCovered(false), WATCHDOG_MS);
    return () => clearTimeout(watchdog.current);
  }, [covered]);

  const cover = useCallback(() => {
    if (reducedMotion()) return Promise.resolve();
    setCovered(true);
    return new Promise((resolve) => setTimeout(resolve, COVER_MS));
  }, []);

  const reveal = useCallback(() => setCovered(false), []);

  return (
    <VeilContext.Provider value={{ cover, reveal }}>
      <div className="page" key={location.key}>
        {children}
      </div>
      <div className={covered ? 'veil veil--on' : 'veil'} aria-hidden="true" />
    </VeilContext.Provider>
  );
}
