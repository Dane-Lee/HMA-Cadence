import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import StandaloneEmptyNotice from '../components/StandaloneEmptyNotice.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login() {
  const { signIn, loading } = useAuth();
  const navigate = useNavigate();
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
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        {/* CO-BRANDED, WITH THE REAL MARKS. Owner, 2026-09-17: "You're not using
            the right H" -- this was a typed letter H in a red square, the same
            reproduction he ruled out for the ATI logo. It is the actual
            Hendrickson mark now, and the ATI Worksite Solutions lockup beside
            it, because this is the one screen where the two companies meet:
            Hendrickson's people, ATI's programme. On the white plate the
            Hendrickson artwork needs (black line art), ATI's positive lockup
            sits beside it the way the app header already pairs them. */}
        <div className="login-card__brand">
          <div className="login-card__marks">
            <img src="/hendrickson-logo.jpg" alt="Hendrickson" className="login-card__mark-h" />
            <span className="login-card__divider" aria-hidden="true" />
            <img src="/ati-logo-positive.png" alt="ATI Worksite Solutions" className="login-card__mark-ati" />
          </div>
          <ThemeToggle className="login-card__theme" />
        </div>
        <div className="login-card__title">
          <div>HMA Cadence</div>
          <div className="muted login-card__site">Hendrickson · Navarre</div>
        </div>

        <StandaloneEmptyNotice />

        <h1>Sign In</h1>

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
          <input
            id="pin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="••••"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
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
