# HMA Cadence

Employee-facing PWA for tracking corrective exercise compliance at the Hendrickson (Navarre, OH) facility. Receives finished exercise plans pushed from the HMA Tracker (the EIS authoring tool) and is where an employee's program and daily/weekly schedule live once created. Part of the larger HMA ecosystem described in `memory/project-hma-ecosystem.md`.

- **Frontend:** React 19 + Vite 6
- **Backend:** Supabase (Postgres, Storage, Auth — custom PIN flow)
- **Routing:** React Router v7
- **PWA:** `vite-plugin-pwa` (offline shell + image cache)

---

## Integration with HMA Tracker

Cadence does **not** share a database with the HMA Tracker. The tracker stays a fully
offline, local-only app (single `index.html`, no cloud backend). The only link between
the two is a **one-way push**: when the EIS finalizes a corrective exercise program in
the tracker, the tracker sends one self-contained JSON **plan payload** to a thin intake
on Cadence's Supabase.

- **Contract:** one stable JSON payload shape (employee identity, program dates/schedule,
  and the exercises with sets/reps/category/type). Cadence owns expanding it into
  `programs` + `exercise_assignments`, upserting the exercises into `exercise_library`,
  and auto-creating the employee account (temp PIN) if needed.
- **Intake:** a Supabase **Edge Function** (guarded by a shared secret), not direct writes
  into the normalized tables — so Cadence's schema can evolve without breaking the tracker.
- **Idempotent:** each plan carries a client-generated `plan_id` (UUID); re-sends upsert
  rather than duplicate.
- **Outbox / offline-tolerant:** the tracker queues the push locally and auto-flushes when
  a connection is available; it never blocks the tracker's core workflow. A subtle
  indicator on the tracker notes any plan still waiting to sync.

> This supersedes the older "all apps share one Supabase" plan in
> `memory/project-hma-ecosystem.md` (its Phase 2/3). The tracker is not migrating to
> Supabase; only Cadence is cloud-backed.

---

## First-time setup

### 1. Create a Supabase project

1. Go to https://supabase.com → New project → name it `hma-cadence`.
2. Pick a region close to Ohio (`us-east-1` is fine).
3. Wait for it to provision (~2 min).
4. In **Project Settings → API**, copy:
   - **Project URL** → goes to `VITE_SUPABASE_URL`
   - **anon public** key → goes to `VITE_SUPABASE_ANON_KEY`

### 2. Set environment variables

```bash
cp .env.example .env
```

Fill in the two values from step 1.

### 3. Run the schema migration

In the Supabase dashboard, open **SQL Editor** and run, in order:

1. `supabase/migrations/0001_initial_schema.sql` — creates tables, enums, indexes, RLS, the compliance view, and the storage bucket.
2. `supabase/migrations/0002_seed_dev_data.sql` — seeds an admin (`ADMIN001` / PIN `1234`) and three sample employees (`4412`, `3287`, `2901`, all PIN `1234`).

> ⚠ The dev PIN check is intentionally permissive — it accepts `1234` for any seeded account. Before going to real users, swap `verifyPin()` in `src/lib/auth.jsx` for `bcryptjs.compareSync()` and hash real PINs.

### 4. Install + run

```bash
npm install
npm run dev
```

Open http://localhost:5174.

- Sign in as `ADMIN001` / `1234` → admin view.
- Sign in as `4412` / `1234` → employee view (Maria has a seeded program).

---

## Project structure

```
hma-cadence/
├── public/                       # static assets (favicon, PWA icons)
├── src/
│   ├── lib/
│   │   ├── supabase.js           # client + constants (movement categories, etc.)
│   │   ├── auth.jsx              # custom PIN auth provider + useAuth hook
│   │   └── queries.js            # all Supabase reads/writes
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── EmployeeShell.jsx     # header + main layout for employees
│   │   ├── EmployeeToday.jsx     # core daily checklist view
│   │   ├── AdminShell.jsx        # header + nav layout for admins
│   │   ├── AdminEmployees.jsx    # employee list with compliance + alerts
│   │   └── AdminPainQueue.jsx    # unresolved pain reports
│   ├── styles/
│   │   ├── theme.css             # CSS variables, dark mode, primitives
│   │   └── app.css               # page + component styles
│   ├── App.jsx                   # routing + auth guards
│   └── main.jsx                  # entry
├── supabase/
│   └── migrations/
│       ├── 0001_initial_schema.sql
│       └── 0002_seed_dev_data.sql
├── vite.config.js                # Vite + PWA config
├── index.html
└── package.json
```

---

## What's built (Phase 1, sub-phase A)

- ✅ PIN-based sign in (with dev shortcut)
- ✅ Role-based routing (admin vs employee)
- ✅ Employee daily view: exercises grouped by movement category, tap-to-complete, auto "all done" banner, "Done for today" link
- ✅ Inline pain reporting (pain during / pain after / discomfort / other) with one tap
- ✅ Admin employee list with weekly compliance %, follow-up dates, pain alert chips
- ✅ Admin pain queue
- ✅ Dark-mode-first design, large tap targets, factory-friendly typography
- ✅ Supabase schema for all Phase 1 entities (employees, exercise_library, programs, assignments, check_ins, completions, feedback, pain_reports)
- ✅ Weekly compliance view in SQL
- ✅ PWA manifest + service worker (installable, image cache)

## What's stubbed / TODO (pick up in VS Code)

These are the next things to implement. The data layer and types are ready; mostly UI work:

### Auth hardening
- [ ] Add `bcryptjs` and replace `verifyPin()` in `src/lib/auth.jsx`
- [ ] First-login PIN-change flow (forced when `pin_hash` matches a "temp" marker)
- [ ] Move PIN verification to a Supabase Edge Function that mints a JWT
- [ ] Tighten RLS policies to use `auth.jwt() ->> 'employee_id'`

### Integration intake (the tracker → Cadence link)
- [ ] Define the plan payload JSON contract (shared with HMA Tracker)
- [ ] Supabase Edge Function intake (validate, auth via shared secret, idempotent on `plan_id`)
- [ ] Intake expands payload → upsert employee (+ auto temp PIN), upsert `exercise_library`, create/replace active `program` + `exercise_assignments`

### Admin features
- [ ] Employee detail page → see their program, recent check-ins, feedback, pain history
- [ ] Review pushed programs (primary path: programs arrive from the tracker; admin reviews/adjusts rather than authoring from scratch)
- [ ] Optional manual program creation flow: pick employee → select exercises from library → set sets/reps/days → activate
- [ ] Exercise library management (add/edit/upload demo images)
- [ ] Account creation + PIN reset
- [ ] Account deactivation toggle
- [ ] Program summary dashboard (the stats screen we designed)
- [ ] Export Report (PDF/CSV)

### Employee features
- [ ] Thumbs up/down feedback prompt (timed: after 3rd-4th session per exercise, once per week thereafter)
- [ ] Demo image display + tap-to-zoom on each exercise card
- [ ] Notification permission prompt with onboarding copy
- [ ] Web Push subscription + daily reminder edge function
- [ ] Notification time preference editor
- [ ] First-run onboarding flow (set PIN, set reminder time, request push)

### Infrastructure
- [ ] Exercise library is populated by the intake (upserted from pushed plans), not a manual one-time port
- [ ] Offline write queue (cache check-ins, sync on reconnect)
- [ ] Supabase Edge Function for push notifications (daily reminders, pain alerts to EIS)
- [ ] Generate real PWA icons (currently the SVG favicon is a placeholder)

---

## Design principles

- **Dark mode default**, ATI red accent (`#e03030` on dark).
- **Generous tap targets** (48–56px min). Factory workers, often gloves, often arm's length.
- **One thing per screen.** No competing CTAs. The employee view is just a checklist.
- **Pain reporting is always available, never a popup.** Flag icon in the corner of every exercise card.
- **Feedback is occasional, not transactional.** Never per-session.
- **No fake urgency.** No streaks-in-jeopardy panic. The app helps, it doesn't nag.

---

## Related memory files

- `memory/project-hma-tracker.md` — Phase 1 spec (employee/admin UX, data model, design decisions)
- `memory/project-hma-ecosystem.md` — full 7-phase vision (video capture → AI scoring → auto-generated programs → compliance). **Note:** its Phase 2/3 shared-Supabase integration is superseded — see "Integration with HMA Tracker" above.
- `memory/project-ati-emr.md` — the sibling EMR app
