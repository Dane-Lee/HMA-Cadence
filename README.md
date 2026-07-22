# HMA Cadence

Employee-facing PWA for tracking corrective exercise compliance at the Hendrickson (Navarre, OH) facility. Receives finished exercise plans pushed from the HMA Tracker (the EIS authoring tool) and is where an employee's program and daily/weekly schedule live once created. Part of the larger HMA ecosystem described in `memory/project-hma-ecosystem.md`.

- **Frontend:** React 19 + Vite 6
- **Data layer:** swappable adapter behind `src/lib/data/` — **default is a local, fictional-data adapter** (in-memory + `localStorage`, no cloud). A future ATI-sanctioned database plugs in as one more adapter.
- **Routing:** React Router v7
- **PWA:** `vite-plugin-pwa` (offline shell + image cache)

> **⚠ Compliance (ATI/Hendrickson IT):** **Supabase is prohibited as the database**, and **PHI must never be sent to any AI platform.** Development proceeds against the local test-data adapter only. The prior Supabase implementation is preserved for reference at `src/lib/data/adapters/supabase.js` but is not wired in and is not bundled. See `memory/project-hma-cadence-intake.md`.

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

No backend, accounts, or environment variables are needed — the app runs entirely on the local fictional-data adapter.

```bash
npm install
npm run dev
```

Open http://localhost:5174. The fictional dataset (personas, programs, a week of check-ins) is seeded into `localStorage` on first load.

- Sign in as `ADMIN001` / `1234` → admin view (employee list with weekly compliance + a pain alert).
- Sign in as `4412` / `1234` → employee view (Maria Santos has a seeded program).
- Other seeded employees: `3287` (James Kowalski), `2901` (Tony Reeves). All PINs are `1234`.

> ⚠ The dev PIN check is intentionally permissive — every seeded account accepts `1234`. Auth verification lives in the data adapter (`authenticate()`); a future sanctioned-DB adapter will verify server-side and mint a JWT.

**Reset the demo data:** clear the site's `localStorage`, or call `resetLocalDb()` from `src/lib/data/adapters/localAdapter.js`.

### Data layer / swapping backends

All reads and writes go through `src/lib/data/`:

- `contract.js` — the exact function surface every adapter must implement (argument + return shapes).
- `index.js` — selects the active adapter and exports it as `db`. Default `local`; override with `VITE_DATA_BACKEND`.
- `adapters/localAdapter.js` + `localSeed.js` — the default, no-cloud backend.
- `adapters/supabase.js` — **reference only, not active** (Supabase is prohibited). Kept as the canonical example of the contract for whoever writes the ATI-sanctioned adapter.

Views import query functions from `src/lib/queries.js` (a thin facade over `db`) and never touch a database client directly, so a backend swap needs no page changes.

---

## Project structure

```
hma-cadence/
├── public/                       # static assets (favicon, PWA icons)
├── src/
│   ├── lib/
│   │   ├── constants.js          # domain constants (movement categories, etc.)
│   │   ├── auth.jsx              # PIN auth provider + useAuth hook (session only)
│   │   ├── queries.js            # facade: re-exports the active adapter's fns
│   │   └── data/
│   │       ├── index.js          # selects + exports the active adapter as `db`
│   │       ├── contract.js       # the data-layer contract (shapes)
│   │       ├── localSeed.js      # fictional seed dataset
│   │       └── adapters/
│   │           ├── localAdapter.js   # default: no-cloud, localStorage
│   │           └── supabase.js       # reference only, NOT active
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
