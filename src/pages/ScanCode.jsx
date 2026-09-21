import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import StatusCard from '../components/StatusCard.jsx';
import { ROUTE_FOR, parseQrPayload, setQrPayload } from '../lib/qr/fragment.js';
import InfoIcon from '../components/InfoIcon.jsx';

/**
 * In-app QR scanner (/scan).
 *
 * Exists because of a device fact, not a preference: iOS gives a Home Screen
 * web app its own storage jar, separate from Safari's (verified 2026-08-31).
 * A code scanned with the phone's camera opens in Safari, so an employee who
 * installed Cadence would have their plan land in a copy the app can never
 * reach — and nothing can move it across afterwards.
 *
 * Scanning *here* means the pairing key and the plan are written by the same
 * browsing context that will later read them, whichever context that is. That
 * is the whole point; it is not a convenience feature.
 *
 * On success this hands the payload to the existing routes rather than
 * reimplementing intake — `/pair` and `/plan` are unchanged and still handle a
 * camera-scanned code arriving as a URL fragment.
 */

// Scanning every animation frame burns battery for no benefit; a QR does not
// move that fast, and decode is the expensive part.
const SCAN_INTERVAL_MS = 120;

export default function ScanCode() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const lastScanRef = useRef(0);

  const [phase, setPhase] = useState('starting');
  const [detail, setDetail] = useState('');

  /** Release the camera. Safe to call repeatedly; the light must not stay on. */
  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    // getUserMedia needs a secure context. Say so plainly rather than letting
    // the permission call fail with something opaque.
    if (!window.isSecureContext) {
      setPhase('insecure');
      return undefined;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('unsupported');
      return undefined;
    }

    let cancelled = false;

    (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // Measured on the owner's iPhone, off the printed sheet, 2026-09-08.
            // Asking for no resolution gets iOS's default 640x480, and a plan
            // code -- ~165 modules across with the quiet zone, so roughly 3px a
            // module, right at jsQR's floor -- decoded in about 10% of frames.
            // At 10% the scanner reads as broken. Requesting 1080p took it to
            // ~50% and a lock-on inside a few hundred milliseconds. The jsQR
            // call itself was identical in both arms; this constraint was the
            // only variable, and it is worth 5x.
            //
            // `ideal`, not `exact`: a device that cannot manage this has to
            // still open a camera rather than fail closed.
            //
            // iOS returned the stream PORTRAIT (1080 wide x 1920 high), so the
            // short side is what binds. `{ ideal: 2560 }` may buy more and is
            // untested -- do not raise it without measuring the same way.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        // NotAllowedError is a decision, not a fault — word it differently.
        setPhase(err?.name === 'NotAllowedError' ? 'denied' : 'no_camera');
        setDetail(err?.name ?? '');
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      // iOS refuses to play inline without both of these set on the element.
      video.setAttribute('playsinline', 'true');
      video.setAttribute('muted', 'true');
      try {
        await video.play();
      } catch {
        /* autoplay rejection still leaves usable frames once the user taps */
      }
      if (!cancelled) setPhase('scanning');
      tick();
    })();

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      if (doneRef.current) return;

      const now = performance.now();
      if (now - lastScanRef.current < SCAN_INTERVAL_MS) return;
      lastScanRef.current = now;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);

      let image;
      try {
        image = ctx.getImageData(0, 0, w, h);
      } catch {
        return; // tainted canvas should be impossible here, but never throw in a loop
      }

      const result = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' });
      if (!result?.data) return;

      const payload = parseQrPayload(result.data);
      if (!payload) {
        // A real QR, but not one of ours. Keep scanning — the sheet may have
        // more than one code on it and the camera may have found the wrong one.
        setDetail('That code is not an HMA sheet code.');
        return;
      }

      doneRef.current = true;
      stop();
      setQrPayload(payload);
      navigate(ROUTE_FOR[payload.kind], { replace: true });
    }

    return () => {
      cancelled = true;
      stop();
    };
  }, [navigate, stop]);

  if (phase === 'insecure') {
    return (
      <StatusCard title="Camera needs a secure connection">
        <p>Open Cadence over https and try again.</p>
        <Link className="btn" to="/login">Back</Link>
      </StatusCard>
    );
  }

  if (phase === 'unsupported') {
    return (
      <StatusCard title="No camera available">
        <p role="alert">This browser will not give Cadence a camera. Open your sheet's code with the phone's camera app instead.</p>
        <Link className="btn" to="/login">Back</Link>
      </StatusCard>
    );
  }

  if (phase === 'denied') {
    return (
      <StatusCard title="Camera permission was declined">
        <p role="alert">
          Cadence needs the camera to read the code on your sheet. Allow camera
          access for this site in your browser settings, then come back.
        </p>
        <Link className="btn" to="/login">Back</Link>
      </StatusCard>
    );
  }

  if (phase === 'no_camera') {
    return (
      <StatusCard title="Could not start the camera">
        <p>Something else may be using it. {detail}</p>
        <Link className="btn" to="/login">Back</Link>
      </StatusCard>
    );
  }

  return (
    <div className="scan-wrap">
      <h1 className="scan-title">
        Scan Your Sheet
        <InfoIcon
          label="which code to scan first"
          text="Scan the pairing code first, then the plan code. Scanned the other way round the phone holds the plan and opens it the moment the pairing code arrives, so nothing is lost."
        />
      </h1>
      <p className="muted">Point the camera at a code on your printed sheet.</p>

      <div className="scan-frame">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="scan-video" playsInline muted />
        <div className="scan-reticle" aria-hidden="true" />
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <p className="muted center" style={{ fontSize: '.8rem' }}>
        {phase === 'starting' ? 'Starting the camera…' : detail || 'Looking for a code…'}
      </p>

      <Link className="btn btn-ghost" to="/login">Cancel</Link>
    </div>
  );
}
