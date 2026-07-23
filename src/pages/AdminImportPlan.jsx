import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ingestPlan } from '../lib/queries.js';

/**
 * Dev/demo affordance for the Tracker → Cadence plan intake (contract v1).
 *
 * In production the Tracker POSTs a plan to the sanctioned backend's ingest
 * endpoint; there is no cross-app networking here. This page lets an admin
 * paste/apply a Plan Payload against the local receiver so the whole intake +
 * expansion flow is exercisable with FICTIONAL test data only.
 */

// A representative payload with a NEW badge # so applying it creates an account
// (and returns a temp PIN). Change employee_number to an existing badge to
// update that employee's program instead.
const SAMPLE_PLAN = {
  schema_version: 1,
  plan_id: 'demo-plan-6001-0001',
  generated_at: new Date().toISOString(),
  source: { app: 'hma-tracker', version: 'demo' },
  employee: {
    employee_number: '6001',
    first_name: 'Alex',
    last_name: 'Nguyen',
    name: 'Alex Nguyen',
    company: 'Hendrickson',
    department: 'Weld',
    shift: '2nd',
    location: 'Navarre, OH',
  },
  assessment: {
    assessment_date: new Date().toISOString().slice(0, 10),
    assessment_type: 'Initial',
    total_score: 8,
    follow_up_date: new Date(Date.now() + 42 * 86_400_000).toISOString().slice(0, 10),
    reassessment_date: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10),
    notes: 'Demo intake — fictional data only.',
  },
  schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
  exercises: [
    {
      source_exercise_id: 's3', name: 'Bridge',
      instructions: 'On your back, knees bent. Squeeze glutes and lift hips.',
      movement_category: 'single_leg_dip', exercise_type: 'strength',
      default_prescription: '3x10-15', prescription_override: null,
      duration_sec: 258, days: [1, 3, 5], sort_order: 0, image_ref: 'Bridge.png',
    },
    {
      source_exercise_id: 'sh4', name: 'Wall Slide',
      instructions: 'Back against a wall, arms in a goalpost, slide overhead.',
      movement_category: 'shoulder_reach', exercise_type: 'mobility',
      default_prescription: '2x10', prescription_override: null,
      duration_sec: 150, days: [1, 2, 3, 4, 5], sort_order: 1, image_ref: null,
    },
    {
      source_exercise_id: 'c2', name: 'Chin Tuck',
      instructions: 'Draw the chin straight back without tilting. Hold, release.',
      movement_category: 'cervical_rotation', exercise_type: 'static_stabilization',
      default_prescription: '2x10 hold 5 sec', prescription_override: null,
      duration_sec: 110, days: [2, 4], sort_order: 2, image_ref: null,
    },
  ],
};

export default function AdminImportPlan() {
  const navigate = useNavigate();
  const [text, setText] = useState(() => JSON.stringify(SAMPLE_PLAN, null, 2));
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function loadSample() {
    setText(JSON.stringify(SAMPLE_PLAN, null, 2));
    setResult(null); setErrors(null); setError(null);
  }

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
      <h1 className="page-title">Import a plan</h1>
      <p className="page-subtitle">
        Apply a Tracker plan payload (contract v1) to the local receiver. Test data only.
      </p>

      <div className="import-note">
        In production the Tracker sends this to the sanctioned backend — there’s no live
        connection here. Applying below writes to the local demo dataset so you can walk
        the full intake → program → compliance flow.
      </div>

      <textarea
        className="import-editor"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="import-actions">
        <button className="btn btn-inline" onClick={onApply} disabled={busy}>
          {busy ? 'Applying…' : 'Apply plan'}
        </button>
        <button className="btn btn-secondary btn-inline" onClick={loadSample} disabled={busy}>
          Reset to sample
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
          <button className="btn btn-inline" onClick={() => navigate(`/admin/employee/${result.employee_id}`)}>
            View employee →
          </button>
        </div>
      )}
    </>
  );
}
