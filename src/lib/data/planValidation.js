/**
 * Plan Payload validation — contract v1.
 *
 * Mirrors docs/plan-payload-contract.md. Given a parsed payload, returns an
 * array of human-readable error strings ([] means valid). Adapters run this
 * before expanding a plan so an out-of-spec push is rejected wholesale (the
 * Edge Function's 422 behavior) instead of writing partial garbage.
 *
 * Kept dependency-light (only the shared enums) so it can back both the local
 * adapter and a future server-side receiver.
 */
import { MOVEMENT_CATEGORIES, EXERCISE_TYPES } from '../constants.js';

export const SUPPORTED_SCHEMA_VERSION = 1;

const MOVEMENT_KEYS = new Set(MOVEMENT_CATEGORIES.map((c) => c.key));
const TYPE_KEYS = new Set(EXERCISE_TYPES.map((t) => t.key));

const isWeekdayArray = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);

/** Thrown by ingestPlan when validation fails; carries the full error list. */
export class PlanValidationError extends Error {
  constructor(errors) {
    super(`Plan rejected: ${errors.length} problem${errors.length === 1 ? '' : 's'}`);
    this.name = 'PlanValidationError';
    this.errors = errors;
  }
}

/** Thrown when the payload's schema_version isn't supported (the 409 case). */
export class SchemaVersionError extends Error {
  constructor(got) {
    super(`Unsupported schema_version ${got} (this receiver supports ${SUPPORTED_SCHEMA_VERSION}).`);
    this.name = 'SchemaVersionError';
    this.schemaVersion = got;
  }
}

export function validatePlanPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return ['Payload must be a JSON object.'];

  const { employee, assessment, schedule, exercises } = payload;

  if (!payload.plan_id || typeof payload.plan_id !== 'string') {
    errors.push('plan_id is required (string).');
  }

  if (!employee || typeof employee !== 'object') {
    errors.push('employee is required.');
  } else if (!employee.employee_number || typeof employee.employee_number !== 'string') {
    errors.push('employee.employee_number is required (badge #).');
  }

  if (!schedule || !isWeekdayArray(schedule.work_days)) {
    errors.push('schedule.work_days must be a non-empty array of ISO weekdays (1–7).');
  }

  if (assessment && assessment.assessment_date && !/^\d{4}-\d{2}-\d{2}$/.test(assessment.assessment_date)) {
    errors.push('assessment.assessment_date must be YYYY-MM-DD.');
  }

  if (!Array.isArray(exercises) || exercises.length === 0) {
    errors.push('exercises must be a non-empty array.');
  } else {
    const seenSources = new Set();
    exercises.forEach((ex, i) => {
      const at = `exercises[${i}]`;
      if (!ex || typeof ex !== 'object') { errors.push(`${at} must be an object.`); return; }
      if (!ex.source_exercise_id) errors.push(`${at}.source_exercise_id is required.`);
      else if (seenSources.has(ex.source_exercise_id)) {
        errors.push(`${at}.source_exercise_id "${ex.source_exercise_id}" is duplicated.`);
      } else seenSources.add(ex.source_exercise_id);

      if (!ex.name) errors.push(`${at}.name is required.`);
      if (!MOVEMENT_KEYS.has(ex.movement_category)) {
        errors.push(`${at}.movement_category "${ex.movement_category}" is not a known category.`);
      }
      if (!TYPE_KEYS.has(ex.exercise_type)) {
        errors.push(`${at}.exercise_type "${ex.exercise_type}" is not a known type.`);
      }
      if (!isWeekdayArray(ex.days)) {
        errors.push(`${at}.days must be a non-empty array of ISO weekdays (1–7).`);
      } else if (schedule && isWeekdayArray(schedule.work_days)) {
        const work = new Set(schedule.work_days);
        if (!ex.days.every((d) => work.has(d))) {
          errors.push(`${at}.days includes a weekday not in schedule.work_days.`);
        }
      }
    });
  }

  return errors;
}
