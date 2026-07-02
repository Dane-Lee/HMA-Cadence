/**
 * Centralized Supabase data access.
 * All component-facing functions live here so views stay clean and
 * the SQL/Supabase API surface is easy to refactor later.
 */
import { supabase } from './supabase.js';

// ─────────────────────────────────────────────────────────────────
// Programs / assignments (employee-facing)
// ─────────────────────────────────────────────────────────────────

/** Fetch the active program for an employee, including assigned exercises. */
export async function fetchActiveProgram(employeeId) {
  const { data: program, error: pErr } = await supabase
    .from('programs')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .maybeSingle();

  if (pErr) throw pErr;
  if (!program) return null;

  const { data: assignments, error: aErr } = await supabase
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
      // verbatim clinical dosage (per-assignment override, else library default)
      prescription: a.prescription_override ?? a.exercise.default_prescription,
      days: a.days ?? [],                       // ISO weekdays this exercise is scheduled
      durationSec: a.exercise.default_duration_sec,
      sortOrder: a.sort_order,
      ...a.exercise,
    })),
  };
}

/** Get today's check-in (if any) with completions, for an employee+program. */
export async function fetchTodayCheckIn(employeeId, programId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: checkIn, error } = await supabase
    .from('check_ins')
    .select('id, date, completed_at, ended_early')
    .eq('employee_id', employeeId)
    .eq('program_id', programId)
    .eq('date', today)
    .maybeSingle();

  if (error) throw error;
  if (!checkIn) return null;

  const { data: completions, error: cErr } = await supabase
    .from('exercise_completions')
    .select('exercise_assignment_id, completed, completed_at')
    .eq('check_in_id', checkIn.id);

  if (cErr) throw cErr;
  return { ...checkIn, completions: completions ?? [] };
}

/** Mark a single exercise as complete. Creates the check-in lazily. */
export async function toggleExerciseComplete({ employeeId, programId, assignmentId, completed }) {
  const today = new Date().toISOString().slice(0, 10);

  // Get-or-create today's check-in
  let { data: checkIn } = await supabase
    .from('check_ins')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('program_id', programId)
    .eq('date', today)
    .maybeSingle();

  if (!checkIn) {
    const { data: created, error } = await supabase
      .from('check_ins')
      .insert({ employee_id: employeeId, program_id: programId, date: today })
      .select('id')
      .single();
    if (error) throw error;
    checkIn = created;
  }

  // Upsert completion
  const { error: upErr } = await supabase
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

/** End session early without finishing remaining exercises. */
export async function endSessionEarly(checkInId) {
  if (!checkInId) return;
  const { error } = await supabase
    .from('check_ins')
    .update({ ended_early: true, completed_at: new Date().toISOString() })
    .eq('id', checkInId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────
// Feedback + pain
// ─────────────────────────────────────────────────────────────────

export async function submitFeedback({ employeeId, assignmentId, rating }) {
  const { error } = await supabase
    .from('exercise_feedback')
    .upsert(
      { employee_id: employeeId, exercise_assignment_id: assignmentId, rating },
      { onConflict: 'employee_id,exercise_assignment_id' },
    );
  if (error) throw error;
}

export async function reportPain({ employeeId, assignmentId, programId, category }) {
  const { error } = await supabase
    .from('pain_reports')
    .insert({
      employee_id: employeeId,
      exercise_assignment_id: assignmentId,
      program_id: programId,
      category,
    });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────
// Admin views
// ─────────────────────────────────────────────────────────────────

/** Employee list with compliance % this week, follow-up date, pain alerts. */
export async function fetchAdminEmployeeList() {
  const { data: employees, error: eErr } = await supabase
    .from('employees')
    .select('id, employee_number, name, active')
    .eq('role', 'employee')
    .eq('active', true)
    .order('name');
  if (eErr) throw eErr;

  const ids = employees.map((e) => e.id);
  if (ids.length === 0) return [];

  const [{ data: compliance }, { data: programs }, { data: painCounts }] = await Promise.all([
    supabase
      .from('employee_weekly_compliance')
      .select('employee_id, scheduled_days, scheduled_instances, completed_instances, compliance_pct_this_week')
      .in('employee_id', ids),
    supabase
      .from('programs')
      .select('id, employee_id, follow_up_date, initial_assessment_date, days_per_week')
      .in('employee_id', ids)
      .eq('status', 'active'),
    supabase
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
    // layered compliance: exercise-instance counts + derived %
    completedInstances: complianceMap[e.id]?.completed_instances ?? 0,
    scheduledInstances: complianceMap[e.id]?.scheduled_instances ?? 0,
    scheduledDays: complianceMap[e.id]?.scheduled_days ?? null,
    compliancePct: complianceMap[e.id]?.compliance_pct_this_week ?? 0,
    unresolvedPainCount: painMap[e.id] ?? 0,
  }));
}

export async function fetchUnresolvedPainReports() {
  const { data, error } = await supabase
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
