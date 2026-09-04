import { useState } from 'react';
import QRCode from 'qrcode';

import { buildPlanQr, PLAN_ECC_LEVEL, MAX_QR_BYTES, PlanQrError } from '../lib/qr/planQr.js';
import { toKeyIdHex } from '../lib/qr/envelope.js';
import { recordIssuedPlanKey } from '../lib/queries.js';

/* Where the employee's phone lands when it scans the plan code.
 *
 * Defaults to this origin because today one build serves both admin and client;
 * the client/admin split is still ahead of us. It is editable because the base
 * URL is part of what the QR encodes, so a long host eats capacity that the plan
 * needs -- which is exactly the sort of thing that only shows up on the printed
 * sheet, at the printer, with an employee waiting. */
function defaultBaseUrl() {
  const configured = import.meta.env?.VITE_CLIENT_BASE_URL;
  if (configured) return String(configured).trim();
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

/* The payload carries either a single `name` or first/last, depending on which
 * side of the pipeline built it. Stored only so the admin can recognise a row
 * later -- the badge number is the identifier that matters. */
function displayName(employee) {
  if (!employee) return null;
  if (employee.name) return employee.name;
  const joined = `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim();
  return joined || null;
}

async function renderQr(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: PLAN_ECC_LEVEL,
    margin: 2,
    scale: 6,
  });
}

export default function AdminIssuePlan() {
  const [text, setText] = useState('');
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [issued, setIssued] = useState(null);
  const [codes, setCodes] = useState(null);
  const [errors, setErrors] = useState(null);
  const [error, setError] = useState(null);
  const [tooLarge, setTooLarge] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setIssued(null); setCodes(null); setErrors(null); setError(null); setTooLarge(null);
  }

  async function onIssue() {
    setBusy(true);
    reset();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      setError('That isn’t valid JSON.');
      setBusy(false);
      return;
    }

    try {
      const result = await buildPlanQr(payload, { baseUrl });

      /* Persist the key BEFORE showing the codes.
       *
       * The phone encrypts its progress report with this key, so a key that is
       * printed but not stored produces a return nobody can ever open -- and
       * nothing about the printed sheet would look wrong. Storing first means a
       * storage failure stops the issue instead of silently issuing a dead key. */
      /* Stored as hex, which is the form a return is looked up by. buildPlanQr
       * hands back the raw bytes and returnKeyId() produces hex, so storing the
       * Uint8Array here would serialise to {"0":206,…} and never match. */
      const keyIdHex = toKeyIdHex(result.keyId);

      await recordIssuedPlanKey({
        keyId: keyIdHex,
        keyB64: result.keyB64,
        planId: payload.plan_id ?? null,
        employeeNumber: payload.employee?.employee_number ?? null,
        employeeName: displayName(payload.employee),
      });

      const [pairImg, planImg] = await Promise.all([
        renderQr(result.pairUrl),
        renderQr(result.planUrl),
      ]);

      setIssued(result);
      setCodes({ pairImg, planImg });
    } catch (err) {
      if (err instanceof PlanQrError && err.code === 'too_large') {
        setTooLarge({ message: err.message, detail: err.detail ?? {} });
      } else if (err instanceof PlanQrError && err.code === 'invalid_payload') {
        if (Array.isArray(err.detail)) setErrors(err.detail);
        else setError(err.message);
      } else {
        setError(err.message ?? 'Could not build the codes.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Issue a plan</h1>
      <p className="page-subtitle">
        Turn a Tracker plan payload into the two codes on the employee’s sheet. Nothing leaves
        this machine.
      </p>

      <div className="import-note">
        <strong>Two codes, and the order matters.</strong> The employee scans the{' '}
        <strong>pairing code first</strong> — it carries the key — then the{' '}
        <strong>plan code</strong>, which is encrypted with it. Scanning them the other way round
        gives them a plan their phone cannot open.
      </div>

      <label className="field-label" htmlFor="issue-base-url">Where the phone lands</label>
      <input
        id="issue-base-url"
        className="import-input"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://cadence.example.com"
        spellCheck={false}
      />
      <p className="field-hint">
        This is inside the QR, so a longer address leaves less room for the plan.
      </p>

      <label className="field-label" htmlFor="issue-payload">Plan payload (contract v1)</label>
      <textarea
        id="issue-payload"
        className="import-editor"
        spellCheck={false}
        value={text}
        placeholder="Paste the plan payload from the Tracker…"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="import-actions">
        <button className="btn btn-inline" onClick={onIssue} disabled={busy || !text.trim()}>
          {busy ? 'Building…' : 'Generate codes'}
        </button>
      </div>

      {error && <div className="login-error" style={{ marginTop: 16 }}>{error}</div>}

      {errors && (
        <div className="import-errors">
          <strong>Cadence would reject this plan — {errors.length} problem
            {errors.length === 1 ? '' : 's'}:</strong>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {tooLarge && (
        <div className="import-errors">
          <strong>Too big for one code — nothing was issued.</strong>
          <p>{tooLarge.message}</p>
          <p>
            Over by <strong>{Math.max(0, (tooLarge.detail.planBytes ?? 0) - MAX_QR_BYTES)} bytes</strong>
            {typeof tooLarge.detail.exercises === 'number' && (
              <> across {tooLarge.detail.exercises} exercise
                {tooLarge.detail.exercises === 1 ? '' : 's'}</>
            )}.
            Shorten the instruction text first — it compresses worst when every exercise says
            something different — then drop exercises, then shorten the address above.
          </p>
        </div>
      )}

      {issued && codes && (
        <div className="import-result">
          <div className="import-result__title">✓ Codes ready</div>

          <div className="qr-sheet">
            <figure className="qr-sheet__code">
              <img src={codes.pairImg} alt="Pairing code" />
              <figcaption><strong>1. Pairing code</strong><br />Scan this first</figcaption>
            </figure>
            <figure className="qr-sheet__code qr-sheet__code--plan">
              <img src={codes.planImg} alt="Plan code" />
              <figcaption><strong>2. Plan code</strong><br />Scan this second</figcaption>
            </figure>
          </div>

          <dl>
            <div><dt>Key id</dt><dd><code>{toKeyIdHex(issued.keyId)}</code></dd></div>
            <div>
              <dt>Plan code size</dt>
              <dd>
                {issued.planBytes} of {issued.capacity} bytes
                {' '}· <strong>{issued.headroom}</strong> to spare
              </dd>
            </div>
          </dl>

          <p className="field-hint">
            The key is stored on this machine so a returned progress report can be opened later.
            It is not recoverable from the printed sheet alone, so re-issuing a lost plan means
            issuing a new pairing code too.
          </p>
        </div>
      )}
    </>
  );
}
