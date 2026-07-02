# HMA Tracker → Cadence — Plan Payload Contract (v1)

The single source of truth for the one-way plan push from the **HMA Tracker** (offline
EIS authoring app) to **HMA Cadence** (employee compliance PWA). Both apps build against
this document. If the shape changes, bump `schema_version` and update this file in the
same change.

---

## 1. Flow

```
EIS finalizes a program in the Tracker
        │
        ▼
Tracker builds ONE plan payload (this contract) and writes it to a local outbox
        │  (retries; survives offline; subtle "waiting to sync" indicator)
        ▼
POST → Cadence Supabase Edge Function  `ingest-plan`   (Bearer shared secret)
        │
        ▼
Edge Function validates + expands the payload:
  • upsert employee (by employee_number) — auto-create account w/ temp PIN if new
  • upsert each exercise into exercise_library (by source_exercise_id)
  • archive the employee's current active program, insert the new one
  • insert exercise_assignments (with per-weekday schedule)
        │
        ▼
Employee opens Cadence → sees today's exercises for today's weekday
```

Idempotent: re-POSTing the same `plan_id` updates in place, never duplicates.

---

## 2. Transport

- **Endpoint:** `POST https://<project>.supabase.co/functions/v1/ingest-plan`
- **Auth:** `Authorization: Bearer <INGEST_SHARED_SECRET>` — a dedicated secret, **not** the
  anon or service_role key. The Tracker holds only this secret; it can submit a plan and
  nothing else. The function uses the service_role key server-side to perform writes.
- **Body:** `application/json`, a single Plan Payload object (below).
- **Responses:**
  - `200 { "status": "applied", "plan_id", "employee_id", "program_id", "created_account": bool, "temp_pin": "1234"|null }`
  - `409` — schema_version unsupported
  - `401` — bad/missing secret
  - `422 { "errors": [...] }` — validation failure (payload rejected wholesale; nothing written)

---

## 3. Conventions

- **Weekdays:** ISO-8601 integers, `1 = Monday … 7 = Sunday`. Tracker work days are `[1,2,3,4,5]`.
- **Dates:** ISO-8601 `YYYY-MM-DD`. The Tracker computes concrete dates before sending
  (it stores follow-up/re-test as week counts internally; those are resolved to dates here).
- **IDs:** `plan_id` is a client-generated UUID v4, stable for a given finalized plan
  (regenerated only when the EIS finalizes a *new* plan for that employee).
- **Prescription:** the exercise dosage is carried **verbatim** as the Tracker's own string
  (e.g. `"3x10 each side"`, `"2x30 sec hold each side"`). Not parsed into sets/reps —
  preserving the EIS's exact clinical wording.

---

## 4. Payload shape

```jsonc
{
  "schema_version": 1,
  "plan_id": "uuid-v4",                     // idempotency key
  "generated_at": "2026-07-02T14:03:00Z",
  "source": { "app": "hma-tracker", "version": "<git-sha-or-semver>" },

  "employee": {
    "employee_number": "4412",              // BADGE # — required identity key (new Tracker field)
    "first_name": "Maria",
    "last_name": "Santos",
    "name": "Maria Santos",
    "company": "Hendrickson",
    "department": "Assembly",
    "shift": "1st",
    "location": "Navarre, OH"
  },

  "assessment": {
    "assessment_date": "2026-07-02",        // → programs.initial_assessment_date
    "assessment_type": "Initial",
    "total_score": 9,                        // HMA total (nullable) — for EIS context
    "follow_up_date": "2026-08-13",          // computed from date + follow-up weeks
    "reassessment_date": "2026-07-30",       // computed from date + re-test weeks
    "notes": "…"                             // → programs.notes (nullable)
  },

  "schedule": {
    "work_days": [1, 2, 3, 4, 5],           // weekdays the program uses
    "session_budget_sec": 1200              // 20-min/day budget the schedule was fit to
  },

  "exercises": [
    {
      "source_exercise_id": "l1",           // stable Tracker ID → exercise_library.source_exercise_id
      "name": "Hip Flexor Stretch",
      "instructions": "Lie on a table at 45°…",   // → exercise_library.description
      "movement_category": "lunge",         // MAPPED (see §5) — from EXERCISE_CATEGORY[id]
      "exercise_type": "flexibility",       // MAPPED (see §5) — from EX_TYPE[id]
      "prescription": "2x30 sec hold each side",   // verbatim dosage
      "duration_sec": 160,                  // EX_DURATION[id] — drives scheduling/compliance
      "days": [1, 2, 3, 4, 5],              // weekdays THIS exercise is scheduled (per-day split)
      "sort_order": 0,
      "image_ref": "Hip Flexor Stretch off of Table.png"  // filename only; binaries deferred
    }
    // … one per selected exercise
  ]
}
```

`prescription` and `days` are **per-assignment** (may be overridden for this employee);
`name`, `instructions`, `movement_category`, `exercise_type`, `image_ref`, `duration_sec`
are **library-level** defaults for that `source_exercise_id`.

---

## 5. Vocabulary mappings

Both are exhaustive; the Tracker emits the Cadence value directly (no mapping table lives
on the Cadence side — the payload is already in Cadence's vocabulary).

### Movement category  (Tracker key → Cadence enum)
| Tracker | Cadence |
|---|---|
| `lunge`    | `lunge` |
| `sld`      | `single_leg_dip` |
| `shoulder` | `shoulder_reach` |
| `trunk`    | `trunk_rotation` |
| `cervical` | `cervical_rotation` |

> Cadence's original enum had `torso_rotation` and `circle_rotation`. These are corrected to
> `trunk_rotation` / `cervical_rotation` to match the canonical HMA movement names (migration 0003).

### Exercise type  (Tracker → Cadence enum — all 5 preserved)
| Tracker | Cadence |
|---|---|
| `flexibility`          | `flexibility` |
| `mobility`             | `mobility` |
| `static stabilization` | `static_stabilization` |
| `dynamic stabilization`| `dynamic_stabilization` |
| `strength`             | `strength` |

---

## 6. Cadence schema changes required (migration `0003`)

To receive the payload at full fidelity:

**enums**
- `movement_category`: rename `torso_rotation → trunk_rotation`, `circle_rotation → cervical_rotation`.
- `exercise_type`: replace 3 values with the 5 above.

**exercise_library**
- add `source_exercise_id text unique not null` (the Tracker's stable ID; match key for upsert).
- add `default_prescription text` (verbatim dosage).
- add `default_duration_sec int`.
- keep `default_sets` / `default_reps`? → **drop**; `default_prescription` replaces them (verbatim is truer than a lossy split).
- add `image_filename text` (reference now; `image_url` populated when binaries sync later).

**programs**
- add `work_days int[] not null` (weekdays the program uses).
- add `session_budget_sec int`.
- add `assessment_type text`, `total_score int`.
- `days_per_week` becomes `array_length(work_days)` — kept for the compliance view.

**exercise_assignments**
- add `days int[] not null` (weekdays this exercise is scheduled — the per-day split).
- replace `sets_override`/`reps_override` with `prescription_override text`.
- keep `sort_order`.

**compliance view** — revisit: a "session" is now weekday-aware (today's exercises = assignments
where today's ISO weekday ∈ `days`). Weekly target = count of distinct scheduled weekdays.

---

## 7. Versioning

`schema_version` starts at `1`. Any breaking change to field names/shape bumps it; the Edge
Function rejects unknown majors with `409` so an out-of-date Tracker fails loudly instead of
writing garbage.
