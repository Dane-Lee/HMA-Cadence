/**
 * Cadence data-layer contract.
 *
 * Every backend adapter (local, and any future ATI-sanctioned-DB adapter) must
 * export exactly these async functions with these argument and return shapes.
 * Views and the auth provider only ever talk to the adapter through this
 * surface — never to a database client directly — so the backend can be swapped
 * with no changes above this layer.
 *
 * This file is documentation only (JSDoc typedefs); it has no runtime code.
 *
 * ── Auth ────────────────────────────────────────────────────────────
 * authenticate(employeeNumber: string, pin: string)
 *   → Promise<Employee>            // { id, employee_number, name, role, active,
 *                                   //   must_change_pin, notification_time,
 *                                   //   notification_enabled }
 *   Verifies the PIN against a bcrypt hash; never returns pin_hash.
 *   throws Error('Employee not found' | 'This account is inactive' | 'Incorrect PIN')
 *
 * changePin({ employeeId, newPin })
 *   → Promise<Employee>            // updated employee, must_change_pin=false
 *   Validates newPin (see ../pin.js), stores a fresh bcrypt hash, and clears
 *   must_change_pin. Backs the forced first-login PIN-change flow.
 *   throws Error(<validation reason>)
 *
 * ── Employee-facing ─────────────────────────────────────────────────
 * fetchActiveProgram(employeeId: string)
 *   → Promise<Program | null>
 *     Program = { ...programRow, assignments: Assignment[] }
 *     Assignment = { assignmentId, prescription, days: number[], durationSec,
 *                    sortOrder, id, source_exercise_id, name, description,
 *                    default_prescription, default_duration_sec,
 *                    movement_category, exercise_type, image_filename, image_url }
 *
 * fetchTodayCheckIn(employeeId: string, programId: string)
 *   → Promise<CheckIn | null>
 *     CheckIn = { id, date, completed_at, ended_early,
 *                 completions: { exercise_assignment_id, completed, completed_at }[] }
 *
 * toggleExerciseComplete({ employeeId, programId, assignmentId, completed })
 *   → Promise<string>              // the (get-or-created) check_in id
 *
 * endSessionEarly(checkInId: string) → Promise<void>
 *
 * ── Feedback + pain ─────────────────────────────────────────────────
 * submitFeedback({ employeeId, assignmentId, rating })  → Promise<void>
 * reportPain({ employeeId, assignmentId, programId, category }) → Promise<void>
 *
 * ── Admin ───────────────────────────────────────────────────────────
 * fetchAdminEmployeeList()
 *   → Promise<AdminEmployee[]>     // sorted by name; role=employee, active only
 *     AdminEmployee = { id, employee_number, name, active, program|null,
 *                       completedInstances, scheduledInstances, scheduledDays,
 *                       compliancePct, unresolvedPainCount }
 *
 * fetchUnresolvedPainReports()
 *   → Promise<PainReport[]>        // newest first, resolved=false only
 *     PainReport = { id, category, reported_at, acknowledged, resolved,
 *                    employee: { id, name, employee_number },
 *                    assignment: { id, exercise: { id, name, movement_category } } }
 *
 * ── Deferred to the sanctioned adapter (NOT buildable on local) ──────
 * These need the approved backend and are intentionally out of scope until
 * ATI names one:
 *   • Server-side PIN verification + short-lived token/JWT minting. The local
 *     adapter compares bcrypt hashes client-side (fine for fictional data); a
 *     real backend must never ship pin_hash to the client.
 *   • Row-level security keyed to the token's employee_id/role claims.
 *   • Schema: the sanctioned DB needs `employees.must_change_pin boolean`
 *     (the reference SQL migrations predate this flag).
 */
export const DATA_LAYER_FUNCTIONS = [
  'authenticate',
  'changePin',
  'fetchActiveProgram',
  'fetchTodayCheckIn',
  'toggleExerciseComplete',
  'endSessionEarly',
  'submitFeedback',
  'reportPain',
  'fetchAdminEmployeeList',
  'fetchUnresolvedPainReports',
];
