import { useState } from 'react';

import {
  openPastedReturns,
  summariseReturn,
  RETURN_OUTCOME,
} from '../lib/return/openReturns.js';
import { fetchIssuedPlanKey, bindRecognitionKey } from '../lib/queries.js';
import InfoIcon from '../components/InfoIcon.jsx';

const OUTCOME_LABEL = {
  [RETURN_OUTCOME.OPENED]: 'Opened',
  [RETURN_OUTCOME.UNKNOWN_KEY]: 'Not issued from this machine',
  [RETURN_OUTCOME.UNREADABLE]: 'Could not be opened',
  [RETURN_OUTCOME.NOT_A_RETURN]: 'Not a progress report',
  [RETURN_OUTCOME.MALFORMED]: 'Damaged in transit',
};

const OUTCOME_HELP = {
  [RETURN_OUTCOME.UNKNOWN_KEY]:
    'The email is fine — this machine just never issued that plan. Check the other computer, ' +
    'or whether this browser’s data has been cleared since the plan went out.',
  [RETURN_OUTCOME.UNREADABLE]:
    'The key on record does not open it. Most likely the plan was re-issued after this report ' +
    'was sent.',
  [RETURN_OUTCOME.NOT_A_RETURN]:
    'It decrypted, so it is genuinely from this employee, but the contents are not a report this ' +
    'version understands — most likely their app is a different version.',
  [RETURN_OUTCOME.MALFORMED]:
    'The block is incomplete. Ask them to forward the original email rather than a copy of it.',
};

function who(issued) {
  if (!issued) return null;
  const name = issued.employeeName;
  const badge = issued.employeeNumber;
  if (name && badge) return `${name} · ${badge}`;
  return name || badge || null;
}

export default function AdminReturns() {
  const [text, setText] = useState('');
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onOpen() {
    setBusy(true);
    setReport(null);
    setError(null);
    try {
      setReport(await openPastedReturns(text, { fetchIssuedPlanKey, bindRecognitionKey }));
    } catch (err) {
      setError(err.message ?? 'Could not read that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Progress Reports</h1>
      <p className="page-subtitle">
        Paste an employee’s email here. Nothing leaves this machine.
      </p>

      <div className="import-note">
        Paste the <strong>whole email</strong> — headers, quoting and all. Several reports in one
        forwarded thread is fine, and a repeated block from a reply chain is only counted once.
      </div>

      <label className="field-label" htmlFor="returns-paste">The email</label>
      <textarea
        id="returns-paste"
        className="import-editor"
        spellCheck={false}
        value={text}
        placeholder="Paste the email…"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="import-actions">
        <button className="btn btn-inline" onClick={onOpen} disabled={busy || !text.trim()}>
          {busy ? 'Opening…' : 'Open reports'}
        </button>
      </div>

      {error && <div className="login-error" style={{ marginTop: 16 }}>{error}</div>}

      {report && report.found === 0 && (
        <div className="import-errors" role="alert">
          <strong>No report found in that.</strong>
          <p role="alert">
            A report is a block between <code>-----BEGIN HMA REPORT-----</code> and
            {' '}<code>-----END HMA REPORT-----</code>. If the email looks right, it may have been
            truncated — ask them to forward the original rather than paste a copy.
          </p>
        </div>
      )}

      {report && report.found > 0 && (
        <div className="import-result">
          <div className="import-result__title">
            {report.opened.length} of {report.found} report{report.found === 1 ? '' : 's'} opened
            <InfoIcon
              label="what opening a report does"
              text="Opening a report links this employee's device to their record, so later reports are recognised even after a re-assessment issues them a new plan."
            />
          </div>

          <ul className="returns-list">
            {report.results.map((r, i) => {
              const summary = summariseReturn(r.payload);
              const person = who(r.issued);
              return (
                <li key={i} className={`returns-item returns-item--${r.outcome}`}>
                  <div className="returns-item__head">
                    <strong>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</strong>
                    {person && <span className="returns-item__who"> — {person}</span>}
                  </div>

                  {summary && (
                    <div className="returns-item__counts">
                      {summary.completions} completion{summary.completions === 1 ? '' : 's'}
                      {' · '}
                      {/* Pain first in the eye even though it is second in the payload --
                          it is the one thing here that should not wait. */}
                      <strong className={summary.pain ? 'returns-pain' : undefined}>
                        {summary.pain} pain report{summary.pain === 1 ? '' : 's'}
                      </strong>
                      {' · '}
                      {summary.feedback} rating{summary.feedback === 1 ? '' : 's'}
                      {summary.generatedAt && (
                        <div className="field-hint">
                          Sent {new Date(summary.generatedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}

                  {OUTCOME_HELP[r.outcome] && (
                    <p className="field-hint">{OUTCOME_HELP[r.outcome]}</p>
                  )}

                  {r.keyId && (
                    <p className="field-hint">Key id <code>{r.keyId}</code></p>
                  )}
                </li>
              );
            })}
          </ul>

        </div>
      )}
    </>
  );
}
