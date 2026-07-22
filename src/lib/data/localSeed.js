/**
 * Local seed data — FICTIONAL personas only.
 *
 * ⚠ COMPLIANCE: This app must never hold real employee/health data in a
 * personal/offline store, and PHI must never be sent to any AI platform.
 * Everything here is invented for development and demos. Do not paste real
 * employee data into this file.
 *
 * The shape mirrors the SQL tables (supabase/migrations 0001/0003/0004) so the
 * local adapter and a future ATI-sanctioned-DB adapter stay swap-compatible:
 *   employees, exercise_library, programs, exercise_assignments,
 *   check_ins, exercise_completions, exercise_feedback, pain_reports.
 *
 * Dates (check-ins, assessment/follow-up) are computed relative to "today" so
 * weekly-compliance numbers are always meaningful whenever the app is run.
 */

// ── date helpers ────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** ISO weekday (1=Mon … 7=Sun) for a Date, derived from its UTC day. */
function isoDow(d) {
  return ((d.getUTCDay() + 6) % 7) + 1;
}

/** Monday (UTC) of the ISO week containing `ref`. */
function mondayOf(ref) {
  const d = new Date(isoDate(ref) + 'T00:00:00Z');
  return new Date(d.getTime() - (isoDow(d) - 1) * DAY_MS);
}

/**
 * The dates from this week's Monday through `ref` (inclusive) whose ISO
 * weekday is in `weekdays`. Used to lay down realistic past check-ins without
 * inventing future ones.
 */
function completedDatesThisWeek(ref, weekdays) {
  const monday = mondayOf(ref);
  const todayDow = isoDow(new Date(isoDate(ref) + 'T00:00:00Z'));
  const out = [];
  for (let i = 0; i < todayDow; i++) {
    const day = new Date(monday.getTime() + i * DAY_MS);
    const dow = isoDow(day);
    if (weekdays.includes(dow)) out.push({ date: isoDate(day), isodow: dow });
  }
  return out;
}

// ── static catalog (fictional exercise library) ─────────────────────
// source_exercise_id matches the Tracker's stable ids (l1, s3, sh1…).
const LIBRARY = [
  { id: 'lib-l1',  source_exercise_id: 'l1',  name: 'Hip Flexor Stretch',
    description: 'Lie on a table at 45° with one leg hanging off. Let the leg hang to feel a stretch in the front of the hip.',
    default_prescription: '2x30 sec hold each side', default_duration_sec: 160,
    movement_category: 'lunge', exercise_type: 'flexibility',
    image_filename: 'Hip Flexor Stretch off of Table.png', image_url: null },
  { id: 'lib-l3',  source_exercise_id: 'l3',  name: 'Reverse Lunge',
    description: 'Hands behind head, step one foot back and bend both knees to ~90°. Drive through the front foot to stand.',
    default_prescription: '3x10 each side', default_duration_sec: 310,
    movement_category: 'lunge', exercise_type: 'strength',
    image_filename: 'Reverse Lunge.png', image_url: null },
  { id: 'lib-s3',  source_exercise_id: 's3',  name: 'Bridge',
    description: 'On your back, knees bent. Squeeze glutes and lift hips until hips align with knees and shoulders.',
    default_prescription: '3x10-15', default_duration_sec: 258,
    movement_category: 'single_leg_dip', exercise_type: 'strength',
    image_filename: 'Bridge.png', image_url: null },
  { id: 'lib-s5',  source_exercise_id: 's5',  name: 'Single Leg Balance',
    description: 'Stand on one leg with a slight knee bend. Hold steady, keeping hips level.',
    default_prescription: '3x30 sec each side', default_duration_sec: 200,
    movement_category: 'single_leg_dip', exercise_type: 'dynamic_stabilization',
    image_filename: null, image_url: null },
  { id: 'lib-sh1', source_exercise_id: 'sh1', name: 'Doorway Pec Stretch',
    description: 'Forearms on a doorframe, elbows at 90°. Shift weight forward until you feel a chest stretch.',
    default_prescription: '2x30 sec', default_duration_sec: 120,
    movement_category: 'shoulder_reach', exercise_type: 'flexibility',
    image_filename: null, image_url: null },
  { id: 'lib-sh4', source_exercise_id: 'sh4', name: 'Wall Slide',
    description: 'Back against a wall, arms in a goalpost. Slide arms overhead keeping contact with the wall.',
    default_prescription: '2x10', default_duration_sec: 150,
    movement_category: 'shoulder_reach', exercise_type: 'mobility',
    image_filename: null, image_url: null },
  { id: 'lib-t2',  source_exercise_id: 't2',  name: 'Open Book',
    description: 'Side-lying, knees stacked. Rotate the top arm across the body, opening the chest, keeping knees together.',
    default_prescription: '2x8 each side', default_duration_sec: 140,
    movement_category: 'trunk_rotation', exercise_type: 'mobility',
    image_filename: null, image_url: null },
  { id: 'lib-c2',  source_exercise_id: 'c2',  name: 'Chin Tuck',
    description: 'Gently draw the chin straight back (making a “double chin”) without tilting the head. Hold, then release.',
    default_prescription: '2x10 hold 5 sec', default_duration_sec: 110,
    movement_category: 'cervical_rotation', exercise_type: 'static_stabilization',
    image_filename: null, image_url: null },
];

// ── personas ────────────────────────────────────────────────────────
// Each employee gets an active program, a set of assignments (with per-weekday
// schedule), and an "adherence" spec that lays down realistic past check-ins.
const ADMIN_ID = 'emp-admin';

const PERSONAS = [
  {
    employee: { id: 'emp-maria', employee_number: '4412', name: 'Maria Santos' },
    program: { id: 'prog-maria', work_days: [1, 3, 5], daysAgoAssessed: 14, followUpInDays: 28,
               assessment_type: 'Initial', total_score: 9 },
    assignments: [
      { id: 'asg-maria-l1',  lib: 'lib-l1',  days: [1, 3, 5], sort_order: 0 },
      { id: 'asg-maria-l3',  lib: 'lib-l3',  days: [1, 3, 5], sort_order: 1, prescription_override: '2x10 each side' },
      { id: 'asg-maria-s3',  lib: 'lib-s3',  days: [1, 3, 5], sort_order: 2 },
      { id: 'asg-maria-sh1', lib: 'lib-sh1', days: [1, 3, 5], sort_order: 3 },
    ],
    // Completes Monday fully; skips the rest → partial weekly compliance.
    completeWeekdays: [1],
  },
  {
    employee: { id: 'emp-james', employee_number: '3287', name: 'James Kowalski' },
    program: { id: 'prog-james', work_days: [1, 2, 3, 4, 5], daysAgoAssessed: 21, followUpInDays: 21,
               assessment_type: 'Initial', total_score: 7 },
    assignments: [
      { id: 'asg-james-s3',  lib: 'lib-s3',  days: [1, 2, 3, 4, 5], sort_order: 0 },
      { id: 'asg-james-s5',  lib: 'lib-s5',  days: [1, 3, 5],       sort_order: 1 },
      { id: 'asg-james-sh4', lib: 'lib-sh4', days: [1, 2, 3, 4, 5], sort_order: 2 },
      { id: 'asg-james-c2',  lib: 'lib-c2',  days: [2, 4],          sort_order: 3 },
    ],
    // Only a partial Monday session → low compliance.
    completeWeekdays: [1],
    partialOnFirstDay: true,
    // An unresolved pain report the admin queue should surface.
    painReports: [
      { assignment: 'asg-james-s5', category: 'pain_during', daysAgo: 1 },
    ],
  },
  {
    employee: { id: 'emp-tony', employee_number: '2901', name: 'Tony Reeves' },
    program: { id: 'prog-tony', work_days: [2, 4], daysAgoAssessed: 30, followUpInDays: 14,
               assessment_type: 'Follow-up', total_score: 12 },
    assignments: [
      { id: 'asg-tony-t2', lib: 'lib-t2', days: [2, 4], sort_order: 0 },
      { id: 'asg-tony-c2', lib: 'lib-c2', days: [2, 4], sort_order: 1 },
    ],
    // Completes every scheduled day so far → high compliance.
    completeWeekdays: [2, 4],
  },
];

/**
 * Build a fresh, fully-linked local database from the fictional personas.
 * Returns a plain object mirroring the SQL tables. Safe to JSON-serialize.
 */
export function buildSeedDb(now = new Date()) {
  const db = {
    employees: [],
    exercise_library: LIBRARY.map((e) => ({ ...e, active: true })),
    programs: [],
    exercise_assignments: [],
    check_ins: [],
    exercise_completions: [],
    exercise_feedback: [],
    pain_reports: [],
  };

  // Admin (fictional). No health data attached to the admin account.
  db.employees.push({
    id: ADMIN_ID, employee_number: 'ADMIN001', name: 'Dane Lee',
    pin: '1234', role: 'admin',
    notification_time: '07:00', notification_enabled: true, active: true,
  });

  const nowIso = now.toISOString();

  for (const persona of PERSONAS) {
    const { employee, program, assignments, completeWeekdays,
            partialOnFirstDay, painReports } = persona;

    db.employees.push({
      id: employee.id, employee_number: employee.employee_number, name: employee.name,
      pin: '1234', role: 'employee',
      notification_time: '07:00', notification_enabled: true, active: true,
    });

    const assessDate = isoDate(new Date(now.getTime() - program.daysAgoAssessed * DAY_MS));
    const followUp   = isoDate(new Date(now.getTime() + program.followUpInDays * DAY_MS));

    db.programs.push({
      id: program.id, employee_id: employee.id, status: 'active',
      days_per_week: program.work_days.length,
      initial_assessment_date: assessDate,
      follow_up_date: followUp, reassessment_date: null,
      created_by: ADMIN_ID, notes: null,
      work_days: program.work_days, session_budget_sec: 1200,
      assessment_type: program.assessment_type, total_score: program.total_score,
      source_plan_id: null,
    });

    for (const a of assignments) {
      db.exercise_assignments.push({
        id: a.id, program_id: program.id, exercise_library_id: a.lib,
        days: a.days, prescription_override: a.prescription_override ?? null,
        sort_order: a.sort_order,
      });
    }

    // Lay down realistic past check-ins for this week.
    const dates = completedDatesThisWeek(now, completeWeekdays);
    dates.forEach(({ date, isodow }, dayIdx) => {
      const checkInId = `ci-${employee.id}-${date}`;
      db.check_ins.push({
        id: checkInId, employee_id: employee.id, program_id: program.id,
        date, completed_at: `${date}T12:00:00Z`, ended_early: false,
      });

      // Which assignments were scheduled on this weekday.
      const scheduled = assignments.filter((a) => a.days.includes(isodow));
      // Optionally leave the first day partial to model a lapsed employee.
      const toComplete = partialOnFirstDay && dayIdx === 0
        ? scheduled.slice(0, Math.ceil(scheduled.length / 2))
        : scheduled;

      for (const a of toComplete) {
        db.exercise_completions.push({
          id: `ec-${a.id}-${date}`, check_in_id: checkInId,
          exercise_assignment_id: a.id, completed: true,
          completed_at: `${date}T12:00:00Z`,
        });
      }
    });

    for (const pr of painReports ?? []) {
      const reportedAt = isoDate(new Date(now.getTime() - pr.daysAgo * DAY_MS));
      db.pain_reports.push({
        id: `pr-${employee.id}-${pr.assignment}`, employee_id: employee.id,
        exercise_assignment_id: pr.assignment, program_id: program.id,
        category: pr.category, reported_at: `${reportedAt}T12:00:00Z`,
        acknowledged: false, resolved: false, admin_notes: null, resolved_at: null,
      });
    }
  }

  return db;
}
