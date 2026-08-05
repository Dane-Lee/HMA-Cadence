import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import StatusCard from '../components/StatusCard.jsx';
import { readQrFragment } from '../lib/qr/fragment.js';
import { fromBase64Url } from '../lib/qr/envelope.js';
import { storeDeviceKey } from '../lib/qr/keystore.js';
import { readPendingPlan } from '../lib/qr/pending.js';
import { applyPlanEnvelope } from '../lib/qr/applyPlan.js';

/**
 * Device pairing (/pair) — reached by scanning the key QR on the EIS laptop.
 *
 * Runs before sign-in: a brand-new employee has no account until their first
 * plan is applied, and applying it is exactly what this screen does once the key
 * lands. Sequence is store-key-then-drain-pending, so someone who scanned their
 * printed sheet weeks ago walks away from this screen with their program already
 * loaded and no reprint.
 */
export default function PairDevice() {
  const { employee } = useAuth();
  const [state, setState] = useState({ phase: 'working' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const encodedKey = readQrFragment('k');
      if (!encodedKey) {
        setState({ phase: 'no_code' });
        return;
      }

      let keyIdHex;
      try {
        keyIdHex = await storeDeviceKey(fromBase64Url(encodedKey));
      } catch {
        setState({ phase: 'bad_code' });
        return;
      }

      // Paired. Now apply anything that was waiting on this key.
      const pending = readPendingPlan();
      if (!pending) {
        setState({ phase: 'paired', keyIdHex });
        return;
      }

      const res = await applyPlanEnvelope(pending.encoded);
      setState(
        res.outcome === 'applied'
          ? { phase: 'paired_with_plan', keyIdHex, result: res.result }
          : { phase: 'paired', keyIdHex, planFailed: true },
      );
    })();
  }, []);

  if (state.phase === 'working') {
    return <StatusCard title="Setting up this device…" />;
  }

  if (state.phase === 'no_code') {
    return (
      <StatusCard title="Nothing to set up">
        <p>
          This link didn’t carry a setup code. Ask your EIS rep to show the setup code again,
          and scan it with your camera.
        </p>
      </StatusCard>
    );
  }

  if (state.phase === 'bad_code') {
    return (
      <StatusCard title="That setup code didn’t work" tone="error">
        <p>Ask your EIS rep to show it again. If it keeps failing, the code may be damaged.</p>
      </StatusCard>
    );
  }

  const created = state.result?.created_account;

  return (
    <StatusCard title="This device is set up" tone="success">
      {state.phase === 'paired_with_plan' ? (
        <>
          <p>Your exercise plan is loaded and ready.</p>
          {created && (
            <p className="pair-pin">
              Your temporary PIN is <strong>{state.result.temp_pin}</strong>. You’ll pick your own
              the first time you sign in.
            </p>
          )}
        </>
      ) : (
        <p>
          {state.planFailed
            ? 'Your device is set up, but the plan you scanned couldn’t be loaded. Scan the code on your sheet again.'
            : 'Scan the code on your exercise sheet and your plan will open here.'}
        </p>
      )}

      <p className="pair-keyid">
        Setup ID <code>{state.keyIdHex}</code>
      </p>

      <Link className="btn" to={employee ? '/today' : '/login'}>
        {employee ? 'Go to my exercises' : 'Sign in'}
      </Link>
    </StatusCard>
  );
}
