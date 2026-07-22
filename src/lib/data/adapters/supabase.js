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
const DEV_PIN = '1234';

// Phase-1 client-side PIN check. Before production this must move to a
// server-side verifier that mints a JWT (see README auth-hardening TODO).
async function verifyPin(pin /*, pinHash */) {
  return pin === DEV_PIN; // temporary/permissive
}

export async function authenticate(employeeNumber, pin) {
  const { data, error } = await sb()
    .from('employees')
    .select('id, employee_number, name, role, pin_hash, active, notification_time, notification_enabled')
    .eq('employee_number', employeeNumber.trim())
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('Employee not found');
  if (!data.active) throw new Error('This account is inactive');

  const ok = await verifyPin(pin, data.pin_hash);
  if (!ok) throw new Error('Incorrect PIN');

  const { pin_hash, ...employee } = data;
  return employee;
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
      )
    `)
    .eq('program_id', program.id)
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

export async function fetchUnresolvedPainReports() {
  const { data, error } = await sb()
    .from('pain_reports')
    .select(`
      id, category, reported_at, acknowledged, resolved,
      employee:employee_id ( id, name, employee_number ),
      assignment:exercise_assignment_id (
        id,
        exercise:exercise_library_id ( id, name, movement_category )
      )
    `)
    .eq('resolved', false)
    .order('reported_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
