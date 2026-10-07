import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ingestPlan } from '../lib/queries.js';
import InfoIcon from '../components/InfoIcon.jsx';

/**
 * The roster intake: paste the plan the Tracker's "→ Cadence" button copied, and
 * applying it adds that employee and their programme here -- or updates them,
 * if the badge number is already on the roster.
 *
 * REAL DATA SINCE 2026-10-07. Cadence-Admin moved inside the suite (owner: "Yes,
 * move Cadence-Admin inside the suite") and writes to the suite's store, so this
 * page stopped being the demo affordance it was written as. It used to open with
 * a fictional sample plan already filled in, a "Reset to sample" button and a
 * note promising a demo dataset: one click would have put a made-up employee on
 * the specialist's actual roster. It now starts empty and offers no sample.
 */

export default function AdminImportPlan() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onApply() {
    setBusy(true); setResult(null); setErrors(null); setError(null);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      setError('That isn’t valid JSON.');
      setBusy(false);
      return;
    }
    try {
      const res = await ingestPlan(payload);
      setResult(res);
    } catch (err) {
      if (Array.isArray(err.errors)) setErrors(err.errors);       // PlanValidationError (422)
      else if (err.name === 'SchemaVersionError') setError(err.message); // (409)
      else setError(err.message ?? 'Ingest failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">
        Import a Plan
        <InfoIcon
          label="what this screen is for"
          text="Adds the employee and their plan to this roster, or updates them if their badge number is already here. Paste what the Tracker's → Cadence button copied."
        />
      </h1>

      <textarea
        className="import-editor"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="import-actions">
        {/* Rule 5: disabled with its reason, rather than an error after the click. */}
        <button
          className="btn btn-inline"
          onClick={onApply}
          disabled={busy || !text.trim()}
          title={text.trim() ? 'Apply this plan to the roster' : 'Paste a plan first'}
        >
          {busy ? 'Applying…' : 'Apply plan'}
        </button>
      </div>

      {error && <div className="login-error" style={{ marginTop: 16 }}>{error}</div>}

      {errors && (
        <div className="import-errors">
          <strong>Rejected — {errors.length} problem{errors.length === 1 ? '' : 's'}:</strong>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {result && (
        <div className="import-result">
          <div className="import-result__title">✓ Plan applied</div>
          <dl>
            <div><dt>Program</dt><dd>{result.program_id}</dd></div>
            <div><dt>Employee</dt><dd>{result.employee_id}</dd></div>
            <div>
              <dt>Account</dt>
              <dd>
                {result.created_account
                  ? <>New account created · temp PIN <strong>{result.temp_pin}</strong> (they set their own on first login)</>
                  : 'Existing account updated'}
              </dd>
            </div>
          </dl>

          {/* Exercises the plan named that neither it nor the bundled library
              could describe. Empty on every ordinary plan.

              This is the cost of reversing E12 (2026-09-15): the QR carries
              identity and dosage, and the text comes from
              `src/lib/data/exerciseLibrary.js`, which is generated from the
              Tracker. An exercise added there and not regenerated here has no
              description anywhere. The receiver reports it rather than refusing
              the plan -- one unrecognised id must not cost an employee their
              other seven exercises -- so this is the only place it surfaces,
              and without it the ingest would be reporting into nothing. */}
          {result.unresolved_exercises?.length > 0 && (
            <div className="import-result__warn">
              <strong>
                {result.unresolved_exercises.length} exercise
                {result.unresolved_exercises.length === 1 ? '' : 's'} could not be described:
              </strong>{' '}
              {result.unresolved_exercises.join(', ')}.
              <div>
                The plan applied and every other exercise is fine. These are in the Tracker but
                not in this app&rsquo;s library yet — regenerate it
                (<code>node tools/generate-exercise-library.mjs --write</code>) and redeploy.
              </div>
            </div>
          )}

          <button className="btn btn-inline" onClick={() => navigate(`/admin/employee/${result.employee_id}`)}>
            View employee →
          </button>
        </div>
      )}
    </>
  );
}
