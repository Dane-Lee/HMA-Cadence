-- ═══════════════════════════════════════════════════════════════════
-- HMA Tracker — Initial schema
-- Run this in the Supabase SQL editor after creating the project.
-- Designed for forward compatibility with future ecosystem phases
-- (HMA scoring, auto-generated programs, AI scoring).
-- ═══════════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────
create type user_role as enum ('admin', 'employee');

create type movement_category as enum (
  'lunge',
  'single_leg_dip',
  'shoulder_reach',
  'torso_rotation',
  'circle_rotation'
);

create type exercise_type as enum ('stretch', 'stability', 'strength');

create type program_status as enum ('active', 'archived');

create type feedback_rating as enum ('thumbs_up', 'thumbs_down');

create type pain_category as enum ('pain_during', 'pain_after', 'discomfort', 'other');

-- ── employees ──────────────────────────────────────────────────────
-- Username = work badge / employee number. PIN-based auth handled in app
-- (PIN stored as bcrypt hash). Supabase Auth's email/password is bypassed
-- in favor of a custom flow that fits factory workflow.
create table employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text unique not null,
  name text not null,
  pin_hash text not null,                              -- bcrypt
  role user_role not null default 'employee',
  notification_time time default '07:00',              -- preferred reminder time
  notification_enabled boolean not null default true,
  push_subscription jsonb,                             -- web push subscription
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_employees_employee_number on employees(employee_number);
create index idx_employees_role on employees(role) where active = true;

-- ── exercise_library ───────────────────────────────────────────────
-- Master catalog of exercises. Reusable across programs. Seeded from
-- Dane's existing HMA tracker library.
create table exercise_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  default_sets int not null default 1,
  default_reps text not null default '10',             -- text to allow "30 sec hold", "15/side"
  movement_category movement_category not null,
  exercise_type exercise_type not null,
  image_url text,                                       -- supabase storage URL
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_library_category on exercise_library(movement_category) where active = true;
create index idx_library_type on exercise_library(exercise_type) where active = true;

-- ── programs ───────────────────────────────────────────────────────
-- A corrective exercise program assigned to an employee. When a follow-up
-- changes exercises, the old program is archived and a new one is created.
create table programs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  status program_status not null default 'active',
  days_per_week int not null check (days_per_week between 1 and 7),
  initial_assessment_date date not null,
  follow_up_date date,
  reassessment_date date,
  created_by uuid references employees(id),            -- the EIS who assigned it
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_programs_employee on programs(employee_id);
create index idx_programs_active on programs(employee_id, status) where status = 'active';
create index idx_programs_followup on programs(follow_up_date) where status = 'active';

-- Only one active program per employee at a time
create unique index idx_programs_one_active
  on programs(employee_id) where status = 'active';

-- ── exercise_assignments ───────────────────────────────────────────
-- Links library exercises into a specific program with optional overrides.
create table exercise_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  exercise_library_id uuid not null references exercise_library(id),
  sets_override int,
  reps_override text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_assignments_program on exercise_assignments(program_id);

-- ── check_ins ──────────────────────────────────────────────────────
-- One row per day the employee does a session. Multiple exercise_completions
-- belong to a single check_in.
create table check_ins (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  date date not null default current_date,
  completed_at timestamptz not null default now(),     -- when the session ended
  ended_early boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index idx_checkins_one_per_day
  on check_ins(employee_id, program_id, date);
create index idx_checkins_employee_date on check_ins(employee_id, date desc);

-- ── exercise_completions ───────────────────────────────────────────
create table exercise_completions (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null references check_ins(id) on delete cascade,
  exercise_assignment_id uuid not null references exercise_assignments(id),
  completed boolean not null default true,
  completed_at timestamptz not null default now()
);

create index idx_completions_checkin on exercise_completions(check_in_id);
create index idx_completions_assignment on exercise_completions(exercise_assignment_id);

-- ── exercise_feedback ──────────────────────────────────────────────
-- Thumbs up / thumbs down on a specific assignment. Prompted occasionally.
create table exercise_feedback (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  exercise_assignment_id uuid not null references exercise_assignments(id) on delete cascade,
  rating feedback_rating not null,
  date date not null default current_date,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_feedback_employee on exercise_feedback(employee_id);
create unique index idx_feedback_one_per_assignment
  on exercise_feedback(employee_id, exercise_assignment_id);

-- ── pain_reports ───────────────────────────────────────────────────
-- Higher priority than feedback. Always available on every exercise.
-- Triggers admin notification.
create table pain_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  exercise_assignment_id uuid not null references exercise_assignments(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  category pain_category not null,
  reported_at timestamptz not null default now(),
  acknowledged boolean not null default false,
  resolved boolean not null default false,
  admin_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_pain_unresolved on pain_reports(reported_at desc) where resolved = false;
create index idx_pain_employee on pain_reports(employee_id);

-- ═══════════════════════════════════════════════════════════════════
-- Helper views / functions
-- ═══════════════════════════════════════════════════════════════════

-- Weekly compliance: counts check-ins this week (Mon-Sun) per employee
create or replace view employee_weekly_compliance as
select
  e.id as employee_id,
  e.employee_number,
  e.name,
  p.id as program_id,
  p.days_per_week,
  count(c.id) filter (
    where c.date >= date_trunc('week', current_date)::date
      and c.date <  date_trunc('week', current_date)::date + interval '7 days'
  )::int as sessions_this_week,
  (case when p.days_per_week > 0
    then least(100, round(
      100.0 * count(c.id) filter (
        where c.date >= date_trunc('week', current_date)::date
          and c.date <  date_trunc('week', current_date)::date + interval '7 days'
      ) / p.days_per_week
    ))::int
    else 0
  end) as compliance_pct_this_week
from employees e
left join programs p on p.employee_id = e.id and p.status = 'active'
left join check_ins c on c.employee_id = e.id and c.program_id = p.id
where e.active = true and e.role = 'employee'
group by e.id, e.employee_number, e.name, p.id, p.days_per_week;

-- Updated-at trigger
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_employees_updated   before update on employees   for each row execute function set_updated_at();
create trigger trg_library_updated     before update on exercise_library for each row execute function set_updated_at();
create trigger trg_programs_updated    before update on programs    for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════
-- NOTE: Because we're using a custom PIN flow (not Supabase Auth),
-- access is enforced via a session JWT we mint server-side, or via
-- a service-role key from a trusted backend. For Phase 1 simplicity
-- the app uses the service-role key from a small backend endpoint OR
-- the anon key with carefully scoped RPC functions.
--
-- Below we set up the policies assuming we'll later mint a JWT with
-- claims { employee_id, role }. Until then, RLS is enabled but allows
-- service-role to bypass.
-- ═══════════════════════════════════════════════════════════════════

alter table employees             enable row level security;
alter table exercise_library      enable row level security;
alter table programs              enable row level security;
alter table exercise_assignments  enable row level security;
alter table check_ins             enable row level security;
alter table exercise_completions  enable row level security;
alter table exercise_feedback     enable row level security;
alter table pain_reports          enable row level security;

-- Placeholder permissive policies for development.
-- TODO before production: replace with JWT-claim-based policies.
create policy dev_employees_all       on employees             for all using (true) with check (true);
create policy dev_library_all         on exercise_library      for all using (true) with check (true);
create policy dev_programs_all        on programs              for all using (true) with check (true);
create policy dev_assignments_all     on exercise_assignments  for all using (true) with check (true);
create policy dev_checkins_all        on check_ins             for all using (true) with check (true);
create policy dev_completions_all     on exercise_completions  for all using (true) with check (true);
create policy dev_feedback_all        on exercise_feedback     for all using (true) with check (true);
create policy dev_pain_all            on pain_reports          for all using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════════
-- Storage bucket for exercise demo images
-- ═══════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('exercise-images', 'exercise-images', true)
on conflict (id) do nothing;
