import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

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
      const result = await signIn(employeeNumber, pin);
      navigate(result.employee.role === 'admin' ? '/admin' : '/today', { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not sign in');
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-card__brand">
          <div className="login-card__mark">H</div>
          <div>
            <div>HMA Tracker</div>
            <div className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}>
              Hendrickson · Navarre
            </div>
          </div>
        </div>

        <h1>Sign in</h1>
        <p className="muted">Use your work ID and the PIN you set up.</p>

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
        <p className="muted center" style={{ fontSize: '.8rem' }}>
          Forgot your PIN? See Dane to reset it.
        </p>
      </form>
    </div>
  );
}
