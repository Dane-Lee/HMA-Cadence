import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/** A fade between screens, and a slower one out of the login.
 *
 * Owner, 2026-09-17: after signing in he wants "a smooth and elegant (sexy,
 * even) fade out/in transition" -- the kind of thing that makes someone say
 * "ooooh" the first time they open the app on their phone.
 *
 * HOW IT WORKS. Every route change renders the OLD screen for one more beat
 * while it fades out and lifts a few pixels, then swaps in the new screen,
 * which fades up from slightly below. Two overlapping halves, so there is
 * never a frame of nothing. The login -> first screen change gets a longer,
 * slower curve than ordinary navigation: that is the one moment worth a
 * flourish, and the same flourish on every tab tap would be a delay.
 *
 * WHAT IT DOES NOT DO. No library -- this app runs on whatever phone an
 * employee has, and a 20 KB animation dependency is not worth a fade. And it
 * respects `prefers-reduced-motion`: on a phone that asked for less motion the
 * swap is instant, which is what "smooth" means to that person.
 *
 * The heavy lifting is CSS (`.page-enter`, `.page-exit` in app.css). This
 * component only decides WHICH class the wrapper carries, and when.
 */
const EXIT_MS = 180;
const LOGIN_EXIT_MS = 420;

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function PageTransition({ children }) {
  const location = useLocation();
  const [shown, setShown] = useState({ key: location.key, path: location.pathname, children });
  const [phase, setPhase] = useState('enter');
  const [slow, setSlow] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (location.key === shown.key) {
      // Same screen re-rendering with new children; keep it current, no animation.
      setShown((current) => ({ ...current, children }));
      return undefined;
    }
    const leavingLogin = shown.path === '/login';
    if (reducedMotion()) {
      setShown({ key: location.key, path: location.pathname, children });
      setPhase('enter');
      return undefined;
    }
    setSlow(leavingLogin);
    setPhase('exit');
    timer.current = setTimeout(() => {
      setShown({ key: location.key, path: location.pathname, children });
      setPhase('enter');
    }, leavingLogin ? LOGIN_EXIT_MS : EXIT_MS);
    return () => clearTimeout(timer.current);
    // `children` is deliberately not a dependency: a parent re-render must not
    // restart the animation mid-fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return (
    <div className={`page page-${phase}${slow ? ' page-slow' : ''}`} key={shown.key}>
      {shown.children}
    </div>
  );
}
