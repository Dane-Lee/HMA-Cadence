/**
 * ⚠ REFERENCE ONLY — NOT ACTIVE.
 *
 * Supabase is prohibited as Cadence's database per ATI/Hendrickson IT
 * (2026-07-08 flag; 2026-07-22 clarification). This file is intentionally NOT
 * imported by ../index.js, so `@supabase/supabase-js` stays out of the active
 * bundle and this backend can never be selected by accident.
 *
 * It is preserved as the canonical reference for the data-layer contract: the
 * exact reads/writes, join shapes, and the weekday-aware compliance semantics
 * that any future ATI-SANCTIONED-DB adapter must reproduce. When that sanctioned
 * database exists, copy this file to a new adapter, repoint it at the approved
 * client, and select it in ../index.js. Do not re-enable Supabase.
 *
 * Every exported function mirrors ./localAdapter.js one-for-one (same args,
 * same return shapes).
 */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { assertValidPin, PIN_COST } from '../pin.js';
import {
  validatePlanPayload,
  PlanValidationError,
  SchemaVersionError,
  SUPPORTED_SCHEMA_VERSION,
} from '../planValidation.js';

// Lazily created so merely importing this reference file never constructs a
// client or requires env vars.
let _client = null;
function sb() {
  if (_client) return _client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  _client = createClient(
    url ?? 'https://placeholder.supabase.co',
    anonKey ?? 'placeholder',
    { auth: { persistSession: false } }, // we manage our own session
  );
  return _client;
}

// ─────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────
// NOTE: bcrypt.compareSync is shown here client-side to mirror the local
// adapter's behavior and keep the contract visible. In a real sanctioned-DB
// deployment, PIN verification and hashing MUST move server-side (an RPC/edge
// endpoint) that mints a short-lived token; the client should never receive
// pin_hash. See contract.js "Deferred to the sanctioned adapter".

export async function authenticate(employeeNumber, pin) {
  const { data, error } = await sb()
    .from('employees')
    .select('id, employee_number, name, role, pin_hash, must_change_pin, active, notification_time, notification_enabled')
    .eq('employee_number', employeeNumber.trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Employee not found');
  if (!data.active) throw new Error('This account is inactive');
  if (!bcrypt.compareSync(pin, data.pin_hash)) throw new Error('Incorrect PIN');

  const { pin_hash, ...employee } = data;
  return employee;
}

export async function changePin({ employeeId, newPin }) {
  assertValidPin(newPin);
  const { data, error } = await sb()
    .from('employees')
    .update({ pin_hash: bcrypt.hashSync(newPin, PIN_COST), must_change_pin: false })
    .eq('id', employeeId)
    .select('id, employee_number, name, role, must_change_pin, active, notification_time, notification_enabled')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateNotificationPrefs({ employeeId, notification_enabled, notification_time }) {
  const patch = {};
  if (typeof notification_enabled === 'boolean') patch.notification_enabled = notification_enabled;
  if (notification_time) patch.notification_time = notification_time;
  const { data, error } = await sb()
    .from('employees')
    .update(patch)
    .eq('id', employeeId)
    .select('id, employee_number, name, role, must_change_pin, active, notification_time, notification_enabled')
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Programs / assignments (employee-facing)
// ─────────────────────────────────────────────────────────────────────

export async function fetchActiveProgram(employeeId) {
  const { data: program, error: pErr } = await sb()
    .from('programs')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .maybeSingle();

  if (pErr) throw pErr;
  if (!program) return null;

  const { data: assignments, error: aErr } = await sb()
    .from('exercise_assignments')
    .select(`
      id, prescription_override, days, sort_order,
      exercise:exercise_library_id (
        id, source_exercise_id, name, description, default_prescription,
        default_duration_sec, movement_category, exercise_type,
        image_filename, image_url
      ),
      feedback:exercise_feedback ( rating )
    `)
    .eq('program_id', program.id)
    .eq('feedback.employee_id', employeeId)
    .order('sort_order', { ascending: true });

  if (aErr) throw aErr;

  return {
    ...program,
    assignments: (assignments ?? []).map((a) => ({
      assignmentId: a.id,
      prescription: a.prescription_override ?? a.exercise.default_prescription,
      days: a.days ?? [],
      durationSec: a.exercise.default_duration_sec,
      sortOrder: a.sort_order,
      feedback: a.feedback?.[0]?.rating ?? null,
      ...a.exercise,
    })),
  };
}

export async function fetchTodayCheckIn(employeeId, programId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: checkIn, error } = await sb()
    .from('check_ins')
    .select('id, date, completed_at, ended_early')
    .eq('employee_id', employeeId)
    .eq('program_id', programId)
    .eq('date', today)
    .maybeSingle();

  if (error) throw error;
  if (!checkIn) return null;

  const { data: completions, error: cErr } = await sb()
    .from('exercise_completions')
    .select('exercise_assignment_id, completed, completed_at')
    .eq('check_in_id', checkIn.id);

  if (cErr) throw cErr;
  return { ...checkIn, completions: completions ?? [] };
}

export async function toggleExerciseComplete({ employeeId, programId, assignmentId, completed }) {
  const today = new Date().toISOString().slice(0, 10);

  let { data: checkIn } = await sb()
    .from('check_ins')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('program_id', programId)
    .eq('date', today)
    .maybeSingle();

  if (!checkIn) {
    const { data: created, error } = await sb()
      .from('check_ins')
      .insert({ employee_id: employeeId, program_id: programId, date: today })
      .select('id')
      .single();
    if (error) throw error;
    checkIn = created;
  }

  const { error: upErr } = await sb()
    .from('exercise_completions')
    .upsert(
      {
        check_in_id: checkIn.id,
        exercise_assignment_id: assignmentId,
        completed,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'check_in_id,exercise_assignment_id' },
    );
  if (upErr) throw upErr;

  return checkIn.id;
}

export async function endSessionEarly(checkInId) {
  if (!checkInId) return;
  const { error } = await sb()
    .from('check_ins')
    .update({ ended_early: true, completed_at: new Date().toISOString() })
    .eq('id', checkInId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────
// Feedback + pain
// ─────────────────────────────────────────────────────────────────────

export async function submitFeedback({ employeeId, assignmentId, rating }) {
  const { error } = await sb()
    .from('exercise_feedback')
    .upsert(
      { employee_id: employeeId, exercise_assignment_id: assignmentId, rating },
      { onConflict: 'employee_id,exercise_assignment_id' },
    );
  if (error) throw error;
}

export async function reportPain({ employeeId, assignmentId, programId, category }) {
  const { error } = await sb()
    .from('pain_reports')
    .insert({
      employee_id: employeeId,
      exercise_assignment_id: assignmentId,
      program_id: programId,
      category,
    });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────
// Admin views
// ─────────────────────────────────────────────────────────────────────

export async function fetchAdminEmployeeList() {
  const { data: employees, error: eErr } = await sb()
    .from('employees')
    .select('id, employee_number, name, active')
    .eq('role', 'employee')
    .eq('active', true)
    .order('name');
  if (eErr) throw eErr;

  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return [];

  const [{ data: compliance }, { data: programs }, { data: painCounts }] = await Promise.all([
    sb()
      .from('employee_weekly_compliance')
      .select('employee_id, scheduled_days, scheduled_instances, completed_instances, compliance_pct_this_week')
      .in('employee_id', ids),
    sb()
      .from('programs')
      .select('id, employee_id, follow_up_date, initial_assessment_date, days_per_week')
      .in('employee_id', ids)
      .eq('status', 'active'),
    sb()
      .from('pain_reports')
      .select('employee_id, id', { count: 'exact' })
      .in('employee_id', ids)
      .eq('resolved', false),
  ]);

  const complianceMap = Object.fromEntries((compliance ?? []).map((c) => [c.employee_id, c]));
  const programMap    = Object.fromEntries((programs ?? []).map((p) => [p.employee_id, p]));
  const painMap       = (painCounts ?? []).reduce((acc, p) => {
    acc[p.employee_id] = (acc[p.employee_id] ?? 0) + 1;
    return acc;
  }, {});

  return employees.map((e) => ({
    ...e,
    program: programMap[e.id] ?? null,
    completedInstances: complianceMap[e.id]?.completed_instances ?? 0,
    scheduledInstances: complianceMap[e.id]?.scheduled_instances ?? 0,
    scheduledDays: complianceMap[e.id]?.scheduled_days ?? null,
    compliancePct: complianceMap[e.id]?.compliance_pct_this_week ?? 0,
    unresolvedPainCount: painMap[e.id] ?? 0,
  }));
}

const PAIN_REPORT_SELECT = `
  id, category, reported_at, acknowledged, resolved, resolved_at, admin_notes,
  employee:employee_id ( id, name, employee_number ),
  assignment:exercise_assignment_id (
    id,
    exercise:exercise_library_id ( id, name, movement_category )
  )
`;

export async function fetchAdminEmployeeDetail(employeeId) {
  const { data: employee, error: eErr } = await sb()
    .from('employees')
    .select('id, employee_number, name, active, notification_time, notification_enabled')
    .eq('id', employeeId)
    .eq('role', 'employee')
    .maybeSingle();
  if (eErr) throw eErr;
  if (!employee) throw new Error('Employee not found');

  const { data: program } = await sb()
    .from('programs')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .maybeSingle();

  const { data: compRow } = await sb()
    .from('employee_weekly_compliance')
    .select('scheduled_days, scheduled_instances, completed_instances, compliance_pct_this_week')
    .eq('employee_id', employeeId)
    .maybeSingle();

  const compliance = {
    scheduledDays: compRow?.scheduled_days ?? 0,
    scheduledInstances: compRow?.scheduled_instances ?? 0,
    completedInstances: compRow?.completed_instances ?? 0,
    compliancePct: compRow?.compliance_pct_this_week ?? 0,
  };

  let assignments = [];
  if (program) {
    // Per-assignment adherence is derived from the assignment-level weekly view
    // (one row per assignment with its scheduled/completed instance counts).
    const { data: rows } = await sb()
      .from('assignment_weekly_adherence')
      .select(`
        assignment_id, scheduled_count, completed_count, days,
        prescription, feedback_rating, unresolved_pain_count,
        exercise:exercise_library_id ( name, movement_category, exercise_type )
      `)
      .eq('program_id', program.id)
      .order('sort_order');
    assignments = (rows ?? []).map((r) => ({
      assignmentId: r.assignment_id,
      name: r.exercise?.name,
      movement_category: r.exercise?.movement_category,
      exercise_type: r.exercise?.exercise_type,
      prescription: r.prescription,
      days: r.days ?? [],
      scheduledCount: r.scheduled_count ?? 0,
      completedCount: r.completed_count ?? 0,
      feedback: r.feedback_rating ?? null,
      unresolvedPainCount: r.unresolved_pain_count ?? 0,
    }));
  }

  const { data: painReports } = await sb()
    .from('pain_reports')
    .select(PAIN_REPORT_SELECT)
    .eq('employee_id', employeeId)
    .order('reported_at', { ascending: false });

  return { employee, program: program ?? null, compliance, assignments, painReports: painReports ?? [] };
}

export async function fetchUnresolvedPainReports() {
  const { data, error } = await sb()
    .from('pain_reports')
    .select(PAIN_REPORT_SELECT)
    .eq('resolved', false)
    .order('reported_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function acknowledgePain(reportId) {
  const { data, error } = await sb()
    .from('pain_reports')
    .update({ acknowledged: true })
    .eq('id', reportId)
    .select(PAIN_REPORT_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function resolvePain(reportId) {
  const { data, error } = await sb()
    .from('pain_reports')
    .update({ resolved: true, acknowledged: true, resolved_at: new Date().toISOString() })
    .eq('id', reportId)
    .select(PAIN_REPORT_SELECT)
    .single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Plan intake (Tracker → Cadence)
// ─────────────────────────────────────────────────────────────────────

/**
 * Reference transport for contract v1. In production the Tracker (not this
 * client) POSTs the payload to the `ingest-plan` Edge Function, which validates
 * and expands it server-side with the service role — the anon key can't perform
 * the privileged upserts, and PIN hashing must not happen client-side. This
 * forwards to that endpoint so the reference mirrors docs §2 exactly.
 */
export async function ingestPlan(payload) {
  if (payload?.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new SchemaVersionError(payload?.schema_version);
  }
  const errors = validatePlanPayload(payload);
  if (errors.length) throw new PlanValidationError(errors);

  const base = import.meta.env.VITE_SUPABASE_URL;
  const secret = import.meta.env.VITE_INGEST_SHARED_SECRET;
  const res = await fetch(`${base}/functions/v1/ingest-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) throw new SchemaVersionError(payload?.schema_version);
  if (res.status === 422) throw new PlanValidationError(body.errors ?? ['Validation failed']);
  if (!res.ok) throw new Error(body.error ?? `Ingest failed (${res.status})`);
  return body;
}
