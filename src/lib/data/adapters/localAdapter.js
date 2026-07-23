/**
 * Local data adapter — no external database.
 *
 * Implements the full Cadence data-layer contract (see ../contract.js) against
 * a fictional dataset held in memory and persisted to localStorage. This is the
 * default backend so the whole app runs end-to-end with test data and zero
 * cloud dependency — the arrangement ATI IT approved (build everything except
 * the banned parts: no Supabase DB, no PHI to any AI platform).
 *
 * When ATI names a sanctioned database, add a sibling adapter that fulfils the
 * same contract and select it in ../index.js; no page or component changes.
 *
 * Return shapes here are kept identical to the Supabase reference adapter
 * (./supabase.js) so the two are interchangeable.
 */
import bcrypt from 'bcryptjs';
import { buildSeedDb } from '../localSeed.js';
import { assertValidPin, PIN_COST } from '../pin.js';

const STORAGE_KEY = 'hma-cadence:local-db';
const DAY_MS = 86_400_000;

// ── store load/persist ──────────────────────────────────────────────
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through to a fresh seed */
  }
  const seeded = buildSeedDb();
  persist(seeded);
  return seeded;
}

let store = load();

function persist(next = store) {
  store = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* localStorage unavailable (e.g. private mode) — stay in-memory */
  }
}

/** Rebuild the fictional dataset from scratch. Handy for demos/dev. */
export function resetLocalDb() {
  store = buildSeedDb();
  persist();
}

// ── helpers ─────────────────────────────────────────────────────────
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Today's date (UTC-derived) as YYYY-MM-DD — matches check_ins.date. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon … 7=Sun) for a YYYY-MM-DD string. */
function isoDowOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** [Monday, nextMonday) bounds of the current ISO week, as YYYY-MM-DD. */
function weekBounds() {
  const t = new Date(today() + 'T00:00:00Z');
  const monday = new Date(t.getTime() - (isoDowOf(today()) - 1) * DAY_MS);
  const end = new Date(monday.getTime() + 7 * DAY_MS);
  return { start: monday.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

const activeProgramFor = (employeeId) =>
  store.programs.find((p) => p.employee_id === employeeId && p.status === 'active') ?? null;

const libraryById = (id) => store.exercise_library.find((e) => e.id === id) ?? null;

/**
 * Weekly compliance for one active program, mirroring the
 * employee_weekly_compliance SQL view (weekday-aware, distinct
 * (assignment, weekday) pairs).
 */
function complianceForProgram(program) {
  if (!program) return { scheduledInstances: 0, scheduledDays: 0, completedInstances: 0, compliancePct: 0 };

  const assignments = store.exercise_assignments.filter((a) => a.program_id === program.id);
  const scheduledInstances = assignments.reduce((sum, a) => sum + (a.days?.length ?? 0), 0);
  const scheduledDays = program.work_days?.length ?? 0;

  const daysById = Object.fromEntries(assignments.map((a) => [a.id, a.days ?? []]));
  const { start, end } = weekBounds();

  // distinct (assignment_id, isodow) pairs completed on a scheduled weekday
  const credited = new Set();
  for (const ci of store.check_ins) {
    if (ci.program_id !== program.id) continue;
    if (ci.date < start || ci.date >= end) continue;
    const dow = isoDowOf(ci.date);
    for (const ec of store.exercise_completions) {
      if (ec.check_in_id !== ci.id || !ec.completed) continue;
      if ((daysById[ec.exercise_assignment_id] ?? []).includes(dow)) {
        credited.add(`${ec.exercise_assignment_id}:${dow}`);
      }
    }
  }
  const completedInstances = credited.size;
  const compliancePct = scheduledInstances > 0
    ? Math.min(100, Math.round((100 * completedInstances) / scheduledInstances))
    : 0;

  return { scheduledInstances, scheduledDays, completedInstances, compliancePct };
}

// ─────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify badge + PIN against the stored bcrypt hash. Returns the employee
 * (without pin_hash) or throws with a user-facing message. Seeded accounts use
 * PIN "1234"; the new-hire persona (5567) uses temp PIN "0000".
 *
 * NOTE: in this local/dev adapter the compare runs client-side, which is fine
 * for fictional data. The sanctioned-DB adapter must verify server-side and
 * mint a short-lived token instead of trusting the client (see contract.js).
 */
export async function authenticate(employeeNumber, pin) {
  const emp = store.employees.find((e) => e.employee_number === employeeNumber.trim());
  if (!emp) throw new Error('Employee not found');
  if (!emp.active) throw new Error('This account is inactive');
  if (!bcrypt.compareSync(pin, emp.pin_hash)) throw new Error('Incorrect PIN');

  const { pin_hash, ...safe } = emp;
  return clone(safe);
}

/**
 * Set a new PIN and clear the must_change_pin flag. Used by the forced
 * first-login flow. Validates the PIN, stores a fresh bcrypt hash, and returns
 * the updated employee (without pin_hash).
 */
export async function changePin({ employeeId, newPin }) {
  assertValidPin(newPin);
  const emp = store.employees.find((e) => e.id === employeeId);
  if (!emp) throw new Error('Employee not found');

  emp.pin_hash = bcrypt.hashSync(newPin, PIN_COST);
  emp.must_change_pin = false;
  persist();

  const { pin_hash, ...safe } = emp;
  return clone(safe);
}

// ─────────────────────────────────────────────────────────────────────
// Programs / assignments (employee-facing)
// ─────────────────────────────────────────────────────────────────────

export async function fetchActiveProgram(employeeId) {
  const program = activeProgramFor(employeeId);
  if (!program) return null;

  const assignments = store.exercise_assignments
    .filter((a) => a.program_id === program.id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => {
      const ex = libraryById(a.exercise_library_id) ?? {};
      const feedback = store.exercise_feedback.find(
        (f) => f.employee_id === employeeId && f.exercise_assignment_id === a.id,
      )?.rating ?? null;
      return {
        assignmentId: a.id,
        prescription: a.prescription_override ?? ex.default_prescription,
        days: a.days ?? [],
        durationSec: ex.default_duration_sec,
        sortOrder: a.sort_order,
        feedback,
        ...clone(ex),
      };
    });

  return { ...clone(program), assignments };
}

export async function fetchTodayCheckIn(employeeId, programId) {
  const date = today();
  const checkIn = store.check_ins.find(
    (c) => c.employee_id === employeeId && c.program_id === programId && c.date === date,
  );
  if (!checkIn) return null;

  const completions = store.exercise_completions
    .filter((ec) => ec.check_in_id === checkIn.id)
    .map((ec) => ({
      exercise_assignment_id: ec.exercise_assignment_id,
      completed: ec.completed,
      completed_at: ec.completed_at,
    }));

  return { ...clone(checkIn), completions };
}

export async function toggleExerciseComplete({ employeeId, programId, assignmentId, completed }) {
  const date = today();

  let checkIn = store.check_ins.find(
    (c) => c.employee_id === employeeId && c.program_id === programId && c.date === date,
  );
  if (!checkIn) {
    checkIn = {
      id: uid(), employee_id: employeeId, program_id: programId, date,
      completed_at: new Date().toISOString(), ended_early: false,
    };
    store.check_ins.push(checkIn);
  }

  const existing = store.exercise_completions.find(
    (ec) => ec.check_in_id === checkIn.id && ec.exercise_assignment_id === assignmentId,
  );
  if (existing) {
    existing.completed = completed;
    existing.completed_at = new Date().toISOString();
  } else {
    store.exercise_completions.push({
      id: uid(), check_in_id: checkIn.id, exercise_assignment_id: assignmentId,
      completed, completed_at: new Date().toISOString(),
    });
  }

  persist();
  return checkIn.id;
}

export async function endSessionEarly(checkInId) {
  if (!checkInId) return;
  const checkIn = store.check_ins.find((c) => c.id === checkInId);
  if (checkIn) {
    checkIn.ended_early = true;
    checkIn.completed_at = new Date().toISOString();
    persist();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Feedback + pain
// ─────────────────────────────────────────────────────────────────────

export async function submitFeedback({ employeeId, assignmentId, rating }) {
  const existing = store.exercise_feedback.find(
    (f) => f.employee_id === employeeId && f.exercise_assignment_id === assignmentId,
  );
  if (existing) {
    existing.rating = rating;
    existing.date = today();
  } else {
    store.exercise_feedback.push({
      id: uid(), employee_id: employeeId, exercise_assignment_id: assignmentId,
      rating, date: today(), acknowledged: false,
    });
  }
  persist();
}

export async function reportPain({ employeeId, assignmentId, programId, category }) {
  store.pain_reports.push({
    id: uid(), employee_id: employeeId, exercise_assignment_id: assignmentId,
    program_id: programId, category, reported_at: new Date().toISOString(),
    acknowledged: false, resolved: false, admin_notes: null, resolved_at: null,
  });
  persist();
}

// ─────────────────────────────────────────────────────────────────────
// Admin views
// ─────────────────────────────────────────────────────────────────────

export async function fetchAdminEmployeeList() {
  const employees = store.employees
    .filter((e) => e.role === 'employee' && e.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return employees.map((e) => {
    const program = activeProgramFor(e.id);
    const c = complianceForProgram(program);
    const unresolvedPainCount = store.pain_reports.filter(
      (p) => p.employee_id === e.id && !p.resolved,
    ).length;

    return {
      id: e.id,
      employee_number: e.employee_number,
      name: e.name,
      active: e.active,
      program: program
        ? {
            id: program.id,
            employee_id: program.employee_id,
            follow_up_date: program.follow_up_date,
            initial_assessment_date: program.initial_assessment_date,
            days_per_week: program.days_per_week,
          }
        : null,
      completedInstances: c.completedInstances,
      scheduledInstances: c.scheduledInstances,
      scheduledDays: c.scheduledDays,
      compliancePct: c.compliancePct,
      unresolvedPainCount,
    };
  });
}

/** Shape one stored pain_report row into the contract's PainReport. */
function shapePainReport(p) {
  const employee = store.employees.find((e) => e.id === p.employee_id) ?? null;
  const assignment = store.exercise_assignments.find(
    (a) => a.id === p.exercise_assignment_id,
  ) ?? null;
  const exercise = assignment ? libraryById(assignment.exercise_library_id) : null;

  return {
    id: p.id,
    category: p.category,
    reported_at: p.reported_at,
    acknowledged: p.acknowledged,
    resolved: p.resolved,
    resolved_at: p.resolved_at ?? null,
    admin_notes: p.admin_notes ?? null,
    employee: employee
      ? { id: employee.id, name: employee.name, employee_number: employee.employee_number }
      : null,
    assignment: assignment
      ? {
          id: assignment.id,
          exercise: exercise
            ? { id: exercise.id, name: exercise.name, movement_category: exercise.movement_category }
            : null,
        }
      : null,
  };
}

export async function fetchUnresolvedPainReports() {
  return store.pain_reports
    .filter((p) => !p.resolved)
    .sort((a, b) => (a.reported_at < b.reported_at ? 1 : -1))
    .map(shapePainReport);
}

/**
 * Full drill-down for one employee: program, overall weekly compliance, the
 * per-exercise adherence breakdown (completed vs scheduled instances this week,
 * latest feedback, unresolved pain), and the complete pain history. Backs the
 * admin employee-detail / program-review page.
 */
export async function fetchAdminEmployeeDetail(employeeId) {
  const emp = store.employees.find((e) => e.id === employeeId && e.role === 'employee');
  if (!emp) throw new Error('Employee not found');

  const program = activeProgramFor(employeeId);
  const compliance = complianceForProgram(program);

  // Rebuild the credited (assignment_id, isodow) set for this week so each
  // assignment's completed-instance count matches the weekly compliance view.
  const credited = new Set();
  let programAssignments = [];
  if (program) {
    programAssignments = store.exercise_assignments.filter((a) => a.program_id === program.id);
    const daysById = Object.fromEntries(programAssignments.map((a) => [a.id, a.days ?? []]));
    const { start, end } = weekBounds();
    for (const ci of store.check_ins) {
      if (ci.program_id !== program.id) continue;
      if (ci.date < start || ci.date >= end) continue;
      const dow = isoDowOf(ci.date);
      for (const ec of store.exercise_completions) {
        if (ec.check_in_id !== ci.id || !ec.completed) continue;
        if ((daysById[ec.exercise_assignment_id] ?? []).includes(dow)) {
          credited.add(`${ec.exercise_assignment_id}:${dow}`);
        }
      }
    }
  }

  const feedbackFor = (assignmentId) =>
    store.exercise_feedback.find(
      (f) => f.employee_id === employeeId && f.exercise_assignment_id === assignmentId,
    )?.rating ?? null;

  const unresolvedByAssignment = {};
  for (const p of store.pain_reports) {
    if (p.employee_id === employeeId && !p.resolved) {
      unresolvedByAssignment[p.exercise_assignment_id] =
        (unresolvedByAssignment[p.exercise_assignment_id] ?? 0) + 1;
    }
  }

  const assignments = programAssignments
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => {
      const ex = libraryById(a.exercise_library_id) ?? {};
      const days = a.days ?? [];
      const completedCount = days.filter((d) => credited.has(`${a.id}:${d}`)).length;
      return {
        assignmentId: a.id,
        name: ex.name,
        movement_category: ex.movement_category,
        exercise_type: ex.exercise_type,
        prescription: a.prescription_override ?? ex.default_prescription,
        days,
        scheduledCount: days.length,
        completedCount,
        feedback: feedbackFor(a.id),
        unresolvedPainCount: unresolvedByAssignment[a.id] ?? 0,
      };
    });

  const painReports = store.pain_reports
    .filter((p) => p.employee_id === employeeId)
    .sort((a, b) => (a.reported_at < b.reported_at ? 1 : -1))
    .map(shapePainReport);

  return {
    employee: {
      id: emp.id,
      employee_number: emp.employee_number,
      name: emp.name,
      active: emp.active,
      notification_time: emp.notification_time,
      notification_enabled: emp.notification_enabled,
    },
    program: program ? clone(program) : null,
    compliance,
    assignments,
    painReports,
  };
}

export async function acknowledgePain(reportId) {
  const p = store.pain_reports.find((r) => r.id === reportId);
  if (!p) throw new Error('Report not found');
  p.acknowledged = true;
  persist();
  return shapePainReport(p);
}

export async function resolvePain(reportId) {
  const p = store.pain_reports.find((r) => r.id === reportId);
  if (!p) throw new Error('Report not found');
  p.resolved = true;
  p.acknowledged = true; // resolving implies it was seen
  p.resolved_at = new Date().toISOString();
  persist();
  return shapePainReport(p);
}
