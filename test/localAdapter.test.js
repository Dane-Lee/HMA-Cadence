import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../src/lib/data/adapters/localAdapter.js';
import { PlanValidationError, SchemaVersionError } from '../src/lib/data/planValidation.js';

// Pin "now" to a fixed Thursday (ISO weekday 4) so the seed's this-week
// check-ins and the weekly-compliance math are fully deterministic. The store
// is re-seeded under this clock before every test.
const FIXED_NOW = new Date('2026-07-23T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  db.resetLocalDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('authenticate', () => {
  it('accepts the seeded PIN and never returns the hash', async () => {
    const emp = await db.authenticate('4412', '1234');
    expect(emp.name).toBe('Maria Santos');
    expect(emp.role).toBe('employee');
    expect(emp.pin_hash).toBeUndefined();
  });

  it('rejects a wrong PIN', async () => {
    await expect(db.authenticate('4412', '9999')).rejects.toThrow('Incorrect PIN');
  });

  it('rejects an unknown badge', async () => {
    await expect(db.authenticate('0000', '1234')).rejects.toThrow('Employee not found');
  });

  it('authenticates the new-hire temp PIN and flags a required change', async () => {
    const emp = await db.authenticate('5567', '0000');
    expect(emp.must_change_pin).toBe(true);
  });
});

describe('changePin', () => {
  it('sets a new PIN, clears must_change_pin, and lets the new PIN log in', async () => {
    const hire = await db.authenticate('5567', '0000');
    const updated = await db.changePin({ employeeId: hire.id, newPin: '8642' });
    expect(updated.must_change_pin).toBe(false);

    await expect(db.authenticate('5567', '0000')).rejects.toThrow('Incorrect PIN');
    const relogin = await db.authenticate('5567', '8642');
    expect(relogin.id).toBe(hire.id);
  });

  it('rejects an invalid PIN', async () => {
    const hire = await db.authenticate('5567', '0000');
    await expect(db.changePin({ employeeId: hire.id, newPin: '12' })).rejects.toThrow();
    await expect(db.changePin({ employeeId: hire.id, newPin: '1234' })).rejects.toThrow(); // weak
  });
});

describe('weekly compliance (fixed Thursday)', () => {
  it('computes each persona’s compliance deterministically', async () => {
    const list = await db.fetchAdminEmployeeList();
    const byBadge = Object.fromEntries(list.map((e) => [e.employee_number, e]));

    // Tony completes both scheduled weekdays (Tue+Thu) → 100%.
    expect(byBadge['2901'].compliancePct).toBe(100);
    // Maria completes Monday only of a Mon/Wed/Fri × 4-exercise plan → 4/12.
    expect(byBadge['4412'].compliancePct).toBe(33);
    // James: one partial Monday session of a 15-instance week → 2/15.
    expect(byBadge['3287'].compliancePct).toBe(13);
  });

  it('surfaces James’s unresolved pain report in the admin list', async () => {
    const list = await db.fetchAdminEmployeeList();
    const james = list.find((e) => e.employee_number === '3287');
    expect(james.unresolvedPainCount).toBe(1);
  });
});

describe('fetchAdminEmployeeDetail', () => {
  it('returns program, per-exercise adherence, and pain flagged on the right exercise', async () => {
    const list = await db.fetchAdminEmployeeList();
    const jamesId = list.find((e) => e.employee_number === '3287').id;
    const detail = await db.fetchAdminEmployeeDetail(jamesId);

    expect(detail.program).not.toBeNull();
    expect(detail.assignments.length).toBeGreaterThan(0);

    const painful = detail.assignments.filter((a) => a.unresolvedPainCount > 0);
    expect(painful).toHaveLength(1);
    expect(painful[0].name).toBe('Single Leg Balance');

    // Every adherence row never reports more completed than scheduled.
    for (const a of detail.assignments) {
      expect(a.completedCount).toBeLessThanOrEqual(a.scheduledCount);
    }
  });

  it('throws for an unknown employee', async () => {
    await expect(db.fetchAdminEmployeeDetail('nope')).rejects.toThrow('Employee not found');
  });
});

describe('pain actions', () => {
  it('resolve drops the report from the unresolved queue', async () => {
    const before = await db.fetchUnresolvedPainReports();
    expect(before.length).toBe(1);

    await db.resolvePain(before[0].id);
    const after = await db.fetchUnresolvedPainReports();
    expect(after.length).toBe(0);
  });

  it('acknowledge marks the report seen but keeps it in the queue', async () => {
    const [report] = await db.fetchUnresolvedPainReports();
    const updated = await db.acknowledgePain(report.id);
    expect(updated.acknowledged).toBe(true);

    const still = await db.fetchUnresolvedPainReports();
    expect(still.map((r) => r.id)).toContain(report.id);
  });
});

describe('feedback', () => {
  it('records a rating and returns it on the active program', async () => {
    const maria = await db.authenticate('4412', '1234');
    const program = await db.fetchActiveProgram(maria.id);
    const assignmentId = program.assignments[0].assignmentId;

    await db.submitFeedback({ employeeId: maria.id, assignmentId, rating: 'thumbs_up' });

    const reloaded = await db.fetchActiveProgram(maria.id);
    const target = reloaded.assignments.find((a) => a.assignmentId === assignmentId);
    expect(target.feedback).toBe('thumbs_up');
  });
});

describe('ingestPlan (Tracker → Cadence, contract v1)', () => {
  function newHirePlan(overrides = {}) {
    return {
      schema_version: 1,
      plan_id: 'test-plan-6001',
      generated_at: FIXED_NOW.toISOString(),
      employee: { employee_number: '6001', name: 'Alex Nguyen' },
      assessment: { assessment_date: '2026-07-23', assessment_type: 'Initial', total_score: 8, follow_up_date: '2026-09-01' },
      schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
      exercises: [
        { source_exercise_id: 's3', name: 'Bridge', instructions: '...', movement_category: 'single_leg_dip', exercise_type: 'strength', default_prescription: '3x10', duration_sec: 258, days: [1, 3, 5], sort_order: 0, image_ref: 'Bridge.png' },
        { source_exercise_id: 'c2', name: 'Chin Tuck', instructions: '...', movement_category: 'cervical_rotation', exercise_type: 'static_stabilization', default_prescription: '2x10', duration_sec: 110, days: [2, 4], sort_order: 1, image_ref: null },
      ],
      ...overrides,
    };
  }

  it('creates a new account with a temp PIN that authenticates and must be changed', async () => {
    const res = await db.ingestPlan(newHirePlan());
    expect(res.status).toBe('applied');
    expect(res.created_account).toBe(true);
    expect(res.temp_pin).toMatch(/^\d{4}$/);

    const emp = await db.authenticate('6001', res.temp_pin);
    expect(emp.id).toBe(res.employee_id);
    expect(emp.must_change_pin).toBe(true);

    const program = await db.fetchActiveProgram(res.employee_id);
    expect(program.assignments).toHaveLength(2);
    expect(program.work_days).toEqual([1, 2, 3, 4, 5]);
  });

  it('is idempotent by plan_id (re-apply updates in place, no duplicate program)', async () => {
    const first = await db.ingestPlan(newHirePlan());
    const second = await db.ingestPlan(newHirePlan());
    expect(second.program_id).toBe(first.program_id);
    expect(second.created_account).toBe(false);

    const program = await db.fetchActiveProgram(first.employee_id);
    expect(program.assignments).toHaveLength(2);
  });

  it('updates an existing employee without creating an account or temp PIN', async () => {
    const res = await db.ingestPlan(newHirePlan({ plan_id: 'maria-replan', employee: { employee_number: '4412', name: 'Maria Santos' } }));
    expect(res.created_account).toBe(false);
    expect(res.temp_pin).toBeNull();
    // Maria's existing seeded PIN still works (intake never touches an existing PIN).
    await expect(db.authenticate('4412', '1234')).resolves.toBeTruthy();
  });

  it('archives the prior active program when a new plan lands', async () => {
    const maria = await db.authenticate('4412', '1234');
    const before = await db.fetchActiveProgram(maria.id);
    await db.ingestPlan(newHirePlan({ plan_id: 'maria-replan-2', employee: { employee_number: '4412', name: 'Maria Santos' } }));
    const after = await db.fetchActiveProgram(maria.id);
    expect(after.id).not.toBe(before.id); // a different, freshly-created active program
  });

  it('rejects an unsupported schema_version (409)', async () => {
    await expect(db.ingestPlan(newHirePlan({ schema_version: 2 }))).rejects.toBeInstanceOf(SchemaVersionError);
  });

  it('rejects an invalid payload wholesale (422)', async () => {
    await expect(db.ingestPlan(newHirePlan({ exercises: [] }))).rejects.toBeInstanceOf(PlanValidationError);
  });
});
