import { describe, it, expect } from 'vitest';
import {
  validatePlanPayload,
  SUPPORTED_SCHEMA_VERSION,
} from '../src/lib/data/planValidation.js';

// A known-good contract-v1 payload; individual tests clone + break one field.
function validPlan() {
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    plan_id: 'plan-abc-1',
    generated_at: '2026-07-02T14:03:00Z',
    employee: { employee_number: '4412', name: 'Maria Santos' },
    assessment: { assessment_date: '2026-07-02', assessment_type: 'Initial', total_score: 9 },
    schedule: { work_days: [1, 2, 3, 4, 5], session_budget_sec: 1200 },
    exercises: [
      {
        source_exercise_id: 'l1', name: 'Hip Flexor Stretch',
        movement_category: 'lunge', exercise_type: 'flexibility',
        default_prescription: '2x30 sec', duration_sec: 160,
        days: [1, 3, 5], sort_order: 0, image_ref: 'x.png',
      },
    ],
  };
}

describe('validatePlanPayload (contract v1)', () => {
  it('accepts a well-formed payload', () => {
    expect(validatePlanPayload(validPlan())).toEqual([]);
  });

  it('rejects a non-object payload', () => {
    expect(validatePlanPayload(null).length).toBeGreaterThan(0);
    expect(validatePlanPayload('nope').length).toBeGreaterThan(0);
  });

  it('requires plan_id', () => {
    const p = validPlan();
    delete p.plan_id;
    expect(validatePlanPayload(p)).toContain('plan_id is required (string).');
  });

  it('requires employee.employee_number', () => {
    const p = validPlan();
    p.employee = {};
    expect(validatePlanPayload(p).some((e) => e.includes('employee_number'))).toBe(true);
  });

  it('requires a non-empty schedule.work_days of ISO weekdays', () => {
    const p = validPlan();
    p.schedule.work_days = [];
    expect(validatePlanPayload(p).some((e) => e.includes('work_days'))).toBe(true);

    const p2 = validPlan();
    p2.schedule.work_days = [0, 8];
    expect(validatePlanPayload(p2).some((e) => e.includes('work_days'))).toBe(true);
  });

  it('requires a non-empty exercises array', () => {
    const p = validPlan();
    p.exercises = [];
    expect(validatePlanPayload(p)).toContain('exercises must be a non-empty array.');
  });

  it('rejects an unknown movement_category', () => {
    const p = validPlan();
    p.exercises[0].movement_category = 'torso_rotation'; // old/renamed enum
    expect(validatePlanPayload(p).some((e) => e.includes('movement_category'))).toBe(true);
  });

  it('rejects an unknown exercise_type', () => {
    const p = validPlan();
    p.exercises[0].exercise_type = 'cardio';
    expect(validatePlanPayload(p).some((e) => e.includes('exercise_type'))).toBe(true);
  });

  it('rejects exercise days not contained in schedule.work_days', () => {
    const p = validPlan();
    p.schedule.work_days = [1, 3, 5];
    p.exercises[0].days = [1, 6]; // 6 (Sat) not a work day
    expect(validatePlanPayload(p).some((e) => e.includes('not in schedule.work_days'))).toBe(true);
  });

  it('rejects duplicate source_exercise_id', () => {
    const p = validPlan();
    p.exercises.push({ ...p.exercises[0], sort_order: 1 });
    expect(validatePlanPayload(p).some((e) => e.includes('duplicated'))).toBe(true);
  });

  it('rejects a malformed assessment_date', () => {
    const p = validPlan();
    p.assessment.assessment_date = '07/02/2026';
    expect(validatePlanPayload(p).some((e) => e.includes('assessment_date'))).toBe(true);
  });
});
