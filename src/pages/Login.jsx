import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import StandaloneEmptyNotice from '../components/StandaloneEmptyNotice.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { useVeil } from '../components/PageTransition.jsx';
import { useReveal } from '../components/RevealButton.jsx';
import { clientLogo, clientLogoAlt, clientName } from '../lib/branding.js';

export default function Login() {
  const { signIn, loading } = useAuth();
  const navigate = useNavigate();
  const veil = useVeil();
  const pinReveal = useReveal();
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const { employee } = await signIn(employeeNumber, pin);
      const dest = employee.must_change_pin
        ? '/set-pin'
        : employee.role === 'admin' ? '/admin' : '/today';
      // The moment the owner asked for: the login fades to black, the first
      // real screen is swapped in underneath at the peak, and the veil lifts
      // over it. `reveal()` is in a finally so nothing can leave it down; the
      // veil also has its own watchdog. See PageTransition.jsx.
      try {
        await veil.cover();
        navigate(dest, { replace: true });
      } finally {
        veil.reveal();
      }
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    }
  }

  // Build settings, so an empty value removes the piece cleanly rather
  // than rendering a broken image or a stray separator.
  const site = clientName();
  const logo = clientLogo();
  const logoAlt = clientLogoAlt();

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* CO-BRANDED, WITH THE REAL MARKS. Owner, 2026-09-17: "You're not using
            the right H" -- this was a typed letter H in a red square, the same
            reproduction he ruled out for the ATI logo. It is the actual client
            mark now, and the ATI Worksite Solutions lockup beside it, because
            this is the one screen where the two companies meet: the client's
            people, ATI's programme.

            SPLIT TO THE CORNERS, 2026-09-24, ATI on the left: "Based on the
            other programs generally having their ATI Worksite Solutions logo in
            the left-aligned position, I want to keep the ATI logo in the
            left-aligned top corner and move the Hendrickson 'H' to the
            right-aligned top corner."

            EACH KEEPS ITS OWN WHITE PLATE. They shared one because both are
            black line art -- the client mark, and ATI's 2/C POSITIVE lockup,
            which is the guide's choice for a light ground (1.3). Splitting them
            onto a dark card without plates would have put black artwork on a
            near-black ground. The divider goes, because opposite corners
            already say they are two marks. */}
        <div className="login-card__brand">
          <span className="login-card__plate">
            <img src="/ati-logo-positive.png" alt="ATI Worksite Solutions" className="login-card__mark-ati" />
          </span>
          {logo ? (
            <span className="login-card__plate">
              <img src={logo} alt={logoAlt} className="login-card__mark-h" />
            </span>
          ) : null}
        </div>
        <div className="login-card__title">
          <div>HMA Cadence</div>
          {site ? <div className="muted login-card__site">{site}</div> : null}
        </div>

        <StandaloneEmptyNotice />

        {/* The toggle sits on the Sign In line and right-aligned, to
            counterbalance the title (owner, 2026-09-24). It vacated the brand
            row so the two marks could take the corners. */}
        <div className="login-card__signin">
          <h1>Sign In</h1>
          <ThemeToggle className="login-card__theme" />
        </div>

        <div className="field">
          <label className="label" htmlFor="empNum">Work ID</label>
          <input
            id="empNum"
            className="input"
            inputMode="numeric"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck="false"
            placeholder="e.g. 4412"
            value={employeeNumber}
            onChange={(e) => setEmployeeNumber(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="pin">PIN</label>
          <div className="secret">
            <input
              id="pin"
              className="input"
              type={pinReveal.type}
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
            {pinReveal.button}
          </div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="spacer-md" />

        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="spacer-sm" />
        <p className="muted center login-card__help">
          Forgot your PIN?
          <span className="info" tabIndex={0} role="tooltip" aria-label="See Dane to reset it.">
            i<span className="tip">See Dane to reset it.</span>
          </span>
        </p>
      </form>
    </div>
  );
}
