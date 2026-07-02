-- ═══════════════════════════════════════════════════════════════════
-- HMA Cadence — Migration 0004: plan intake
-- The receiving half of the Tracker → Cadence push (contract v1).
--   • programs.source_plan_id — idempotency key (one program per plan_id)
--   • plan_ingest_log         — audit trail of every push attempt
--   • apply_plan(payload)     — atomic, security-definer expansion of a
--                               plan payload into employee/library/program/
--                               assignments. Callable only by service_role.
-- Run in the Supabase SQL editor AFTER 0003.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── idempotency key ─────────────────────────────────────────────────
alter table programs add column source_plan_id text unique;

-- ── audit log ───────────────────────────────────────────────────────
create table plan_ingest_log (
  id              uuid primary key default gen_random_uuid(),
  plan_id         text not null,
  schema_version  int,
  employee_number text,
  program_id      uuid references programs(id) on delete set null,
  status          text not null,          -- 'applied' | 'duplicate' | 'error'
  created_account boolean not null default false,
  error           text,
  received_at     timestamptz not null default now()
);
create index idx_ingest_log_plan on plan_ingest_log(plan_id);
create index idx_ingest_log_received on plan_ingest_log(received_at desc);

alter table plan_ingest_log enable row level security;
-- Dev-permissive read for the admin app; writes happen via apply_plan (definer).
create policy dev_ingest_log_all on plan_ingest_log for all using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════════
-- apply_plan: atomic expansion of one plan payload (contract v1).
-- Returns a jsonb result; NEVER raises to the caller — validation and
-- runtime errors are caught, the data changes rolled back, the attempt
-- logged, and an {status:'error'} object returned.
-- ═══════════════════════════════════════════════════════════════════
create or replace function apply_plan(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions   -- 'extensions' so pgcrypto crypt()/gen_salt() resolve
as $$
declare
  v_schema_version int  := (payload->>'schema_version')::int;
  v_plan_id        text := payload->>'plan_id';
  v_emp            jsonb := payload->'employee';
  v_assess         jsonb := payload->'assessment';
  v_sched          jsonb := payload->'schedule';
  v_emp_number     text := v_emp->>'employee_number';
  v_employee_id    uuid;
  v_program_id     uuid;
  v_created_account boolean := false;
  v_temp_pin       text := null;
  v_work_days      int[];
  ex               jsonb;
  v_lib_id         uuid;
  v_sort           int := 0;
begin
  -- ── validation ──
  if v_schema_version is distinct from 1 then
    raise exception 'unsupported schema_version: %', coalesce(v_schema_version::text, 'null');
  end if;
  if v_plan_id is null or v_emp_number is null then
    raise exception 'missing required plan_id or employee.employee_number';
  end if;
  if jsonb_typeof(payload->'exercises') is distinct from 'array'
     or jsonb_array_length(payload->'exercises') = 0 then
    raise exception 'payload has no exercises';
  end if;

  -- ── idempotency: this exact plan already applied? ──
  select id into v_program_id from programs where source_plan_id = v_plan_id;
  if v_program_id is not null then
    insert into plan_ingest_log(plan_id, schema_version, employee_number, program_id, status)
      values (v_plan_id, v_schema_version, v_emp_number, v_program_id, 'duplicate');
    return jsonb_build_object(
      'status','duplicate','plan_id',v_plan_id,
      'employee_id',(select employee_id from programs where id = v_program_id),
      'program_id',v_program_id,'created_account',false,'temp_pin',null);
  end if;

  -- ── employee: match by badge, else create with temp PIN ──
  select id into v_employee_id from employees where employee_number = v_emp_number;
  if v_employee_id is null then
    v_temp_pin := lpad((floor(random()*10000))::int::text, 4, '0');
    insert into employees(employee_number, name, pin_hash, role, active)
      values (v_emp_number, coalesce(v_emp->>'name', v_emp_number),
              crypt(v_temp_pin, gen_salt('bf')), 'employee', true)
      returning id into v_employee_id;
    v_created_account := true;
  else
    update employees set name = coalesce(v_emp->>'name', name)
      where id = v_employee_id;
  end if;

  -- ── exercise_library: upsert each exercise by stable source id ──
  for ex in select value from jsonb_array_elements(payload->'exercises') as t(value)
  loop
    insert into exercise_library(
        source_exercise_id, name, description, default_prescription,
        default_duration_sec, movement_category, exercise_type, image_filename, active)
      values (
        ex->>'source_exercise_id', ex->>'name', ex->>'instructions',
        ex->>'default_prescription', (ex->>'duration_sec')::int,
        (ex->>'movement_category')::movement_category,
        (ex->>'exercise_type')::exercise_type,
        ex->>'image_ref', true)
    on conflict (source_exercise_id) do update set
        name                 = excluded.name,
        description          = excluded.description,
        default_prescription = excluded.default_prescription,
        default_duration_sec = excluded.default_duration_sec,
        movement_category    = excluded.movement_category,
        exercise_type        = excluded.exercise_type,
        image_filename       = coalesce(excluded.image_filename, exercise_library.image_filename),
        active               = true,
        updated_at           = now();
  end loop;

  -- ── program: archive prior active, insert the new one ──
  update programs set status = 'archived'
    where employee_id = v_employee_id and status = 'active';

  select array(select jsonb_array_elements_text(v_sched->'work_days'))::int[]
    into v_work_days;

  insert into programs(
      employee_id, status, days_per_week, initial_assessment_date, follow_up_date,
      reassessment_date, notes, work_days, session_budget_sec, assessment_type,
      total_score, source_plan_id)
    values (
      v_employee_id, 'active',
      greatest(1, coalesce(array_length(v_work_days, 1), 0)),
      (v_assess->>'assessment_date')::date,
      nullif(v_assess->>'follow_up_date','')::date,
      nullif(v_assess->>'reassessment_date','')::date,
      v_assess->>'notes',
      coalesce(v_work_days, '{}'),
      (v_sched->>'session_budget_sec')::int,
      v_assess->>'assessment_type',
      nullif(v_assess->>'total_score','')::int,
      v_plan_id)
    returning id into v_program_id;

  -- ── assignments: link library exercises with per-weekday schedule ──
  for ex in select value from jsonb_array_elements(payload->'exercises') as t(value)
  loop
    select id into v_lib_id from exercise_library
      where source_exercise_id = ex->>'source_exercise_id';

    insert into exercise_assignments(
        program_id, exercise_library_id, prescription_override, days, sort_order)
      values (
        v_program_id, v_lib_id,
        nullif(ex->>'prescription_override', ''),
        array(select jsonb_array_elements_text(ex->'days'))::int[],
        coalesce((ex->>'sort_order')::int, v_sort));
    v_sort := v_sort + 1;
  end loop;

  insert into plan_ingest_log(
      plan_id, schema_version, employee_number, program_id, status, created_account)
    values (v_plan_id, v_schema_version, v_emp_number, v_program_id, 'applied', v_created_account);

  return jsonb_build_object(
    'status','applied','plan_id',v_plan_id,'employee_id',v_employee_id,
    'program_id',v_program_id,'created_account',v_created_account,'temp_pin',v_temp_pin);

exception when others then
  -- all data changes above are rolled back to function entry; log persists.
  insert into plan_ingest_log(plan_id, schema_version, employee_number, status, error)
    values (coalesce(v_plan_id,'?'), v_schema_version, v_emp_number, 'error', sqlerrm);
  return jsonb_build_object('status','error','plan_id',v_plan_id,'error',sqlerrm);
end;
$$;

-- Only the service_role (used by the ingest-plan Edge Function) may call this.
-- Prevents anyone holding the anon key from injecting plans directly.
revoke all on function apply_plan(jsonb) from public;
grant execute on function apply_plan(jsonb) to service_role;

commit;
