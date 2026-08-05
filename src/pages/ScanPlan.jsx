import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import StatusCard from '../components/StatusCard.jsx';
import { readQrFragment } from '../lib/qr/fragment.js';
import { applyPlanEnvelope } from '../lib/qr/applyPlan.js';

/**
 * Plan intake (/plan) — reached by scanning the QR printed on an exercise sheet.
 *
 * Public on purpose: the employee may have no account yet. The account is
 * created by the receiver when the plan is applied, which can only happen on a
 * paired device — so the common first-time path here is `not_paired`, which is
 * a normal state, not an error. The envelope is kept and applied automatically
 * once the device is paired (see pending.js).
 */
export default function ScanPlan() {
  const { employee } = useAuth();
  const [state, setState] = useState({ phase: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const encoded = readQrFragment('p');
      if (!encoded) {
        setState({ phase: 'no_code' });
        return;
      }
      setState({ phase: 'done', ...(await applyPlanEnvelope(encoded)) });
    })();
  }, []);

  if (state.phase === 'working') return <StatusCard title="Opening your plan…" />;

  if (state.phase === 'no_code') {
    return (
      <StatusCard title="Nothing to open">
        <p>Scan the code on your printed exercise sheet with your camera.</p>
        <Link className="btn" to={employee ? '/today' : '/login'}>
          {employee ? 'Go to my exercises' : 'Sign in'}
        </Link>
      </StatusCard>
    );
  }

  switch (state.outcome) {
    case 'applied': {
      const created = state.result?.created_account;
      return (
        <StatusCard title="Your plan is ready" tone="success">
          {created ? (
            <p className="pair-pin">
              Your temporary PIN is <strong>{state.result.temp_pin}</strong>. You’ll pick your own
              the first time you sign in.
            </p>
          ) : (
            <p>Your exercises have been updated.</p>
          )}
          <Link className="btn" to={employee ? '/today' : '/login'}>
            {employee ? 'Go to my exercises' : 'Sign in'}
          </Link>
        </StatusCard>
      );
    }

    // The expected first-time path, and the reason this design works: the plan
    // is held on the device until an EIS rep pairs it.
    case 'not_paired':
      return (
        <StatusCard title="One step first">
          <p>
            Your plan is saved on this phone, but it can’t be opened until your EIS rep sets up
            this device. See them whenever it suits you — it takes a few seconds, and your plan
            will open automatically.
          </p>
          <p className="scan-note">
            In the meantime, use the printed sheet. Everything you need is on it.
          </p>
        </StatusCard>
      );

    case 'unsupported_version':
      return (
        <StatusCard title="Update needed" tone="error">
          <p>This plan needs a newer version of Cadence than this device has.</p>
        </StatusCard>
      );

    case 'decrypt_failed':
      return (
        <StatusCard title="This plan isn’t for this phone" tone="error">
          <p>Check that you scanned your own sheet. If it is yours, see your EIS rep.</p>
        </StatusCard>
      );

    default:
      return (
        <StatusCard title="That plan couldn’t be loaded" tone="error">
          <p>{state.message ?? 'Something in the plan wasn’t readable.'}</p>
          {state.errors && (
            <ul className="scan-errors">
              {state.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <p className="scan-note">Show this screen to your EIS rep.</p>
        </StatusCard>
      );
  }
}
