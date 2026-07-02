-- ═══════════════════════════════════════════════════════════════════
-- HMA Cadence — Migration 0003: integration fidelity
-- Aligns the schema with the Tracker → Cadence plan payload contract v1
-- (docs/plan-payload-contract.md):
--   • canonical HMA movement-category names
--   • full 5-type clinical exercise vocabulary
--   • verbatim prescriptions (drop the lossy sets/reps split)
--   • stable source_exercise_id match key
--   • per-weekday scheduling on programs + assignments
--   • layered (exercise → day → week) compliance views
-- Run in the Supabase SQL editor AFTER 0001 and 0002.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0. Clear demo exercise/program data ─────────────────────────────
-- The 0002 sample library/program rows use the old shape and lack the
-- new NOT NULL keys. They are throwaway (real data arrives via plan
-- pushes), so remove them. Employee accounts are kept.
delete from exercise_completions;
delete from check_ins;
delete from pain_reports;
delete from exercise_feedback;
delete from exercise_assignments;
delete from programs;
delete from exercise_library;

-- ── 1. Movement category → canonical HMA names ──────────────────────
alter type movement_category rename value 'torso_rotation'  to 'trunk_rotation';
alter type movement_category rename value 'circle_rotation' to 'cervical_rotation';

-- ── 2. Exercise type → 5 clinical types ─────────────────────────────
-- Old enum was (stretch, stability, strength). Replace wholesale; the
-- only table using it (exercise_library) is now empty, so no row cast
-- is evaluated.
alter type exercise_type rename to exercise_type_old;
create type exercise_type as enum (
  'flexibility',
  'mobility',
  'static_stabilization',
  'dynamic_stabilization',
  'strength'
);
alter table exercise_library
  alter column exercise_type type exercise_type
  using exercise_type::text::exercise_type;
drop type exercise_type_old;

-- ── 3. exercise_library: verbatim prescription + match key + image ref
alter table exercise_library
  add column source_exercise_id  text not null,      -- Tracker's stable id (l1, s3, sh7…)
  add column default_prescription text,              -- verbatim dosage e.g. "3x10 each side"
  add column default_duration_sec int,               -- EX_DURATION[id], drives scheduling
  add column image_filename       text,              -- reference now; image_url filled when binaries sync
  drop column default_sets,
  drop column default_reps;

alter table exercise_library
  add constraint exercise_library_source_uniq unique (source_exercise_id);

create index idx_library_source on exercise_library(source_exercise_id);

-- ── 4. programs: schedule + assessment context ──────────────────────
alter table programs
  add column work_days          int[] not null default '{}',  -- ISO weekdays the program uses
  add column session_budget_sec int,                          -- daily budget the schedule was fit to
  add column assessment_type    text,
  add column total_score        int;
-- days_per_week is retained; the intake sets it = cardinality(work_days).

-- ── 5. exercise_assignments: per-weekday schedule + verbatim override
alter table exercise_assignments
  add column days                 int[] not null default '{}', -- ISO weekdays this exercise is scheduled
  add column prescription_override text,
  drop column sets_override,
  drop column reps_override;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Layered compliance views (exercise → day → week)
--    Source of truth: exercise_completions, made weekday-aware.
--    Week = ISO week (Mon–Sun) containing current_date.
-- ═══════════════════════════════════════════════════════════════════
drop view if exists employee_weekly_compliance;

-- Per active program: scheduled instances (Σ scheduled weekdays across
-- assignments) and the set of scheduled weekdays this week.
create or replace view program_schedule_summary as
select
  p.id                                        as program_id,
  p.employee_id,
  p.work_days,
  coalesce(array_length(p.work_days, 1), 0)   as scheduled_days,
  coalesce(sum(cardinality(a.days)), 0)::int  as scheduled_instances
from programs p
left join exercise_assignments a on a.program_id = p.id
where p.status = 'active'
group by p.id, p.employee_id, p.work_days;

-- Exercise-level compliance for the current week. A completion counts
-- toward adherence only if it happened on a weekday the exercise was
-- actually scheduled (isodow ∈ assignment.days); distinct (assignment,
-- weekday) pairs prevent double-counting.
create or replace view employee_weekly_compliance as
with wk as (
  select date_trunc('week', current_date)::date               as wk_start,
         date_trunc('week', current_date)::date + interval '7 days' as wk_end
),
done as (
  select ci.program_id,
         count(distinct (ec.exercise_assignment_id,
                         extract(isodow from ci.date)::int))   as completed_instances
  from check_ins ci
  join exercise_completions ec
       on ec.check_in_id = ci.id and ec.completed
  join exercise_assignments a
       on a.id = ec.exercise_assignment_id
  cross join wk
  where ci.date >= wk.wk_start
    and ci.date <  wk.wk_end
    and extract(isodow from ci.date)::int = any(a.days)
  group by ci.program_id
)
select
  e.id                       as employee_id,
  e.employee_number,
  e.name,
  s.program_id,
  s.scheduled_days,
  s.scheduled_instances,
  coalesce(d.completed_instances, 0) as completed_instances,
  case when s.scheduled_instances > 0
    then least(100, round(100.0 * coalesce(d.completed_instances, 0)
                          / s.scheduled_instances))::int
    else 0
  end                        as compliance_pct_this_week
from employees e
join program_schedule_summary s on s.employee_id = e.id
left join done d               on d.program_id  = s.program_id
where e.active and e.role = 'employee';

-- Day-level rollup for the current week: for each date an active program
-- has scheduled work, how many exercises were scheduled vs completed, and
-- whether the day is fully complete.
create or replace view employee_day_compliance as
with wk as (
  select generate_series(
           date_trunc('week', current_date)::date,
           date_trunc('week', current_date)::date + interval '6 days',
           interval '1 day'
         )::date as d
),
sched as (
  select p.id as program_id, p.employee_id, wk.d as date,
         count(*) as scheduled_count
  from programs p
  join exercise_assignments a on a.program_id = p.id
  cross join wk
  where p.status = 'active'
    and extract(isodow from wk.d)::int = any(a.days)
  group by p.id, p.employee_id, wk.d
),
done as (
  select ci.program_id, ci.date,
         count(*) filter (where ec.completed) as completed_count
  from check_ins ci
  join exercise_completions ec on ec.check_in_id = ci.id
  join exercise_assignments a on a.id = ec.exercise_assignment_id
  where extract(isodow from ci.date)::int = any(a.days)
  group by ci.program_id, ci.date
)
select
  s.employee_id,
  s.program_id,
  s.date,
  extract(isodow from s.date)::int          as iso_weekday,
  s.scheduled_count,
  coalesce(d.completed_count, 0)            as completed_count,
  (coalesce(d.completed_count, 0) >= s.scheduled_count) as day_complete
from sched s
left join done d on d.program_id = s.program_id and d.date = s.date;

commit;
