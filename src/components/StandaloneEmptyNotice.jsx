import { useEffect, useState } from 'react';
import { hasAnyDeviceKey } from '../lib/qr/keystore.js';

/**
 * iOS gives a Home Screen web app its own storage jar, separate from Safari's —
 * neither localStorage nor IndexedDB crosses. Verified on a real device
 * 2026-08-31 (HANDOFF, and `public/storage-check.html` reproduces it).
 *
 * Cadence's only intake is the URL fragment, and a QR scanned with the camera
 * opens in Safari. So an employee who adds Cadence to their Home Screen lands in
 * a copy that cannot see the plan they already scanned, and nothing in the app
 * can move it across.
 *
 * Presenting a sign-in form there is dishonest: it looks like the way in, and it
 * is not. Say so instead.
 *
 * Shown only when BOTH hold — running standalone, and this copy has never been
 * paired. A paired Home Screen install is working as intended and gets nothing.
 */
export function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  // navigator.standalone is the iOS signal; the media query is the standard one.
  return (
    window.navigator.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

export default function StandaloneEmptyNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isStandaloneDisplay()) return undefined;

    let cancelled = false;
    hasAnyDeviceKey()
      .then((paired) => {
        if (!cancelled) setShow(!paired);
      })
      .catch(() => {
        // An unreadable keystore is itself a reason to warn, not to stay quiet.
        if (!cancelled) setShow(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <div className="install-notice" role="status">
      <strong>This app has no plan yet</strong>
      <p>
        If you already scanned your exercise sheet, it opened in Safari and stays
        there. This icon opens a separate copy that cannot see it.
      </p>
      <p>
        Open Cadence in <strong>Safari</strong> to reach your exercises.
      </p>
    </div>
  );
}
