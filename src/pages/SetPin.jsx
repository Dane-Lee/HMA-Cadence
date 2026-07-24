import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { pinProblem, PIN_MIN, PIN_MAX } from '../lib/data/pin.js';

/**
 * Forced first-login PIN change. Reached when the signed-in employee still has
 * a temporary PIN (must_change_pin). They cannot leave until they set their own
 * PIN — on success the session's flag clears and they land on their home view.
 */
export default function SetPin() {
  const { employee, changePin } = useAuth();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const firstName = employee?.name?.split(' ')[0] ?? '';
  const homePath = employee?.role === 'admin' ? '/admin' : '/today';

  // Inline validity for the primary field (mismatch is checked on submit).
  const liveProblem = useMemo(() => (pin ? pinProblem(pin) : null), [pin]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    const problem = pinProblem(pin);
    if (problem) { setError(problem); return; }
    if (pin !== confirm) { setError('The two PINs do not match.'); return; }

    setSaving(true);
    try {
      await changePin(pin);
      navigate(homePath, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Could not set your PIN');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-card__brand">
          <div className="login-card__mark">H</div>
          <div>
            <div>HMA Cadence</div>
            <div className="muted" style={{ fontSize: '.8rem', fontWeight: 400 }}>
              Hendrickson · Navarre
            </div>
          </div>
        </div>

        <h1>Set your PIN</h1>
        <p className="muted">
          {firstName ? `Welcome, ${firstName}. ` : ''}
          You&rsquo;re using a temporary PIN. Choose a new {PIN_MIN}–{PIN_MAX} digit PIN
          to finish setting up your account.
        </p>

        <div className="field">
          <label className="label" htmlFor="newPin">New PIN</label>
          <input
            id="newPin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="••••"
            maxLength={PIN_MAX}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
          {liveProblem && (
            <div className="muted" style={{ fontSize: '.8rem', marginTop: 4 }}>{liveProblem}</div>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="confirmPin">Confirm PIN</label>
          <input
            id="confirmPin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            placeholder="••••"
            maxLength={PIN_MAX}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
            required
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="spacer-md" />

        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save PIN'}
        </button>

        <div className="spacer-sm" />
        <p className="muted center" style={{ fontSize: '.8rem' }}>
          Keep this PIN private. You&rsquo;ll use it to sign in from now on.
        </p>
      </form>
    </div>
  );
}
