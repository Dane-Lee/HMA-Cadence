-- ═══════════════════════════════════════════════════════════════════
-- Seed data for development / first-run testing
-- Default PIN for seeded accounts is "1234"
-- bcrypt hash of "1234" with cost 10: $2b$10$YQq5jKvK3pBcN1G4F8/HkO9ZG7Z4kqDqJiPq5xQQOLMfXz3.cNQGW
--
-- ⚠ Replace these with real bcrypt hashes generated in the app once
-- the auth helper is integrated. For now this lets you log in and
-- click around.
-- ═══════════════════════════════════════════════════════════════════

-- Admin account (Dane)
insert into employees (employee_number, name, role, pin_hash)
values ('ADMIN001', 'Dane Lee', 'admin',
  '$2b$10$YQq5jKvK3pBcN1G4F8/HkO9ZG7Z4kqDqJiPq5xQQOLMfXz3.cNQGW')
on conflict (employee_number) do nothing;

-- Sample employees
insert into employees (employee_number, name, role, pin_hash) values
  ('4412', 'Maria Santos',   'employee', '$2b$10$YQq5jKvK3pBcN1G4F8/HkO9ZG7Z4kqDqJiPq5xQQOLMfXz3.cNQGW'),
  ('3287', 'James Kowalski', 'employee', '$2b$10$YQq5jKvK3pBcN1G4F8/HkO9ZG7Z4kqDqJiPq5xQQOLMfXz3.cNQGW'),
  ('2901', 'Tony Reeves',    'employee', '$2b$10$YQq5jKvK3pBcN1G4F8/HkO9ZG7Z4kqDqJiPq5xQQOLMfXz3.cNQGW')
on conflict (employee_number) do nothing;

-- Sample exercise library entries (one per movement category for demo)
insert into exercise_library (name, description, default_sets, default_reps, movement_category, exercise_type) values
  ('90/90 Hip Stretch',
   'Sit with both knees bent at 90 degrees, front leg to the side, back leg behind. Hinge forward over the front leg.',
   2, '30 sec hold/side', 'lunge', 'stretch'),
  ('Glute Bridge',
   'Lie on your back, knees bent, feet flat. Drive through heels to lift hips. Squeeze glutes at the top.',
   3, '12 reps', 'single_leg_dip', 'strength'),
  ('Wall Slide',
   'Stand with back against wall, arms in goalpost position. Slide arms overhead while keeping contact with the wall.',
   2, '10 reps', 'shoulder_reach', 'stability'),
  ('Cat-Cow',
   'On hands and knees. Alternate between arching (cow) and rounding (cat) your spine. Move slowly and breathe.',
   2, '10 reps', 'torso_rotation', 'stretch'),
  ('Open Book',
   'Side-lying, knees stacked. Rotate top arm across body, opening the chest while keeping knees together.',
   2, '8 reps/side', 'circle_rotation', 'stretch')
on conflict do nothing;

-- Sample program for Maria
do $$
declare
  v_emp_id uuid;
  v_admin_id uuid;
  v_program_id uuid;
  v_lib_id uuid;
begin
  select id into v_emp_id from employees where employee_number = '4412';
  select id into v_admin_id from employees where employee_number = 'ADMIN001';

  if v_emp_id is not null then
    insert into programs (employee_id, days_per_week, initial_assessment_date, follow_up_date, created_by)
    values (v_emp_id, 3, current_date - interval '14 days', current_date + interval '28 days', v_admin_id)
    returning id into v_program_id;

    for v_lib_id in select id from exercise_library limit 4 loop
      insert into exercise_assignments (program_id, exercise_library_id, sort_order)
      values (v_program_id, v_lib_id, (select count(*) from exercise_assignments where program_id = v_program_id));
    end loop;
  end if;
end $$;
