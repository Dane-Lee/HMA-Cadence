import { useState } from 'react';

/** Show / hide for a PIN or password field.
 *
 * Owner, 2026-09-18: "I want one of those 'show password/hide password' icon
 * options in the password box on all of the programs that have passwords."
 *
 * Deliberately a plain button that returns the TYPE to its caller rather than
 * wrapping the input: Cadence's PIN fields already carry inputMode, maxLength
 * and a digits-only onChange, and a wrapper component would have to re-export
 * every one of them. `useReveal()` hands back the type and the button; the field
 * stays where it is.
 *
 * It never submits (`type="button"`), it is reachable by keyboard, and its
 * aria-label says what a press will DO, which is the same convention the sun /
 * moon toggle uses across the estate.
 */
export function useReveal() {
  const [shown, setShown] = useState(false);
  const button = (
    <button
      type="button"
      className="reveal-btn"
      aria-label={shown ? 'Hide PIN' : 'Show PIN'}
      title={shown ? 'Hide PIN' : 'Show PIN'}
      aria-pressed={shown}
      onClick={() => setShown((v) => !v)}
    >
      {shown ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
  return { type: shown ? 'text' : 'password', button };
}
