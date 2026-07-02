# HMA Cadence

Employee-facing PWA for tracking corrective exercise compliance at the Hendrickson (Navarre, OH) facility. Receives finished exercise plans pushed from the HMA Tracker (the EIS authoring tool) and is where an employee's program and daily/weekly schedule live once created. Part of the larger HMA ecosystem described in `memory/project-hma-ecosystem.md`.

- **Frontend:** React 19 + Vite 6
- **Backend:** Supabase (Postgres, Storage, Auth — custom PIN flow)
- **Routing:** React Router v7
- **PWA:** `vite-plugin-pwa` (offline shell + image cache)

---

## First-time setup

### 1. Create a Supabase project

1. Go to https://supabase.com → New project → name it `hma-tracker`.
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
hma-tracker/
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

### Admin features
- [ ] Employee detail page → see their program, recent check-ins, feedback, pain history
- [ ] Program creation flow: pick employee → select exercises from library → set sets/reps/days → activate
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
- [ ] Seed exercise library from the existing HMA tracker library (port the data)
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
- `memory/project-hma-ecosystem.md` — full 7-phase vision (video capture → AI scoring → auto-generated programs → compliance)
- `memory/project-ati-emr.md` — the sibling EMR app
