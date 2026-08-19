# Copilot Studio Capability Probe — "Cadence Coach"

**Purpose:** find out what Copilot Studio can actually do *before* committing Cadence's
backend to SharePoint. This is a graded test, not a demo. Every question below has a
known-correct answer computed from the fixture data, so the builder gets a score rather
than a vibe.

**All data here is FICTIONAL.** These are the same invented personas used in
`src/lib/data/localSeed.js`. No real employee, health, or customer data goes into this
list — that constraint holds regardless of tenant (see the compliance note at the end).

---

## What this probe is actually testing

Cadence's admin value is *compliance math over a set of daily check-in rows*. Grounded
LLMs are frequently unreliable at exactly that — counting, summing, and averaging across
list items — because they retrieve semantically rather than query deterministically.

So the probe is ordered from "certainly works" to "probably breaks," and the answers tell
you which architecture you're allowed to build:

| If the agent... | Then Cadence... |
|---|---|
| Nails Phase 1–3 | can put admin analytics in Copilot directly |
| Nails 1–2, fails 3 | needs Power Automate to pre-compute rollups into a summary list |
| Fails Phase 2 | uses Copilot as a front door only; the PWA keeps all the analytics |
| Passes Phase 4 | can accept write-backs, which unlocks the whole Teams flow |

---

## Setup (about 20 minutes)

1. Create a SharePoint site — **restricted membership, just you and one tester.** Do not
   use a site with broad or org-wide access. See the compliance note.
2. Create two lists from the CSVs in this folder:
   - `HMA_Employees` — 4 rows
   - `HMA_CheckIns` — 26 rows
3. Column types matter for aggregation. Set them explicitly rather than accepting the
   import defaults:
   - `CheckInDate` → **Date**
   - `ExercisesAssigned`, `ExercisesCompleted`, `ExercisesPerDay` → **Number**
   - `EmployeeNumber` → **Single line of text** (leading-zero safety; it's a key, not a quantity)
   - everything else → Single line of text / Choice
4. New Copilot Studio agent named **Cadence Coach**. Add both lists as knowledge sources.
5. Paste the instructions below.

> If the import turns `ExercisesCompleted` into text, aggregation questions will fail for a
> boring reason and you'll misread it as a model limitation. Verify the column types first.

---

## Agent instructions (paste into Copilot Studio)

```
You are Cadence Coach, an assistant for the ergonomics team at the Hendrickson
Navarre facility. You answer questions about employee participation in corrective
exercise programs, using two SharePoint lists: HMA_Employees (one row per enrolled
employee) and HMA_CheckIns (one row per employee per day they opened the app).

HOW THE DATA WORKS
- A row in HMA_CheckIns means the employee opened the app that day. ExercisesCompleted
  is how many of that day's ExercisesAssigned they finished.
- The ABSENCE of a row means the employee never opened the app that day. That is a
  missed day, not a zero-completion day. These are different and you must not conflate
  them.
- Scheduled days are weekdays only (Monday-Friday). There are no weekend rows.
- An employee is only scheduled from their ProgramStartDate onward. Do not count days
  before an employee's program started against them.

DEFINITIONS - use these exactly
- "Days logged" = number of HMA_CheckIns rows for that employee in the period.
- "Scheduled days" = weekdays in the period on or after the employee's ProgramStartDate.
- "Adherence" = total ExercisesCompleted divided by (scheduled days x ExercisesPerDay),
  as a percentage. Missed days count against adherence.
- "Perfect days" = days where ExercisesCompleted equals ExercisesAssigned.
- Whenever you report adherence, state the numerator and denominator you used.

RULES
- Always show your arithmetic. Give the raw counts before the percentage.
- If a question is ambiguous about whether missed days count, say so and give both
  numbers rather than silently picking one.
- If an employee has no check-in rows at all, say that explicitly. Do not report 0%
  adherence as though it were a measured result without noting there is no data.
- Never invent an employee, a date, or a pain report. If asked about someone not in
  HMA_Employees, say they are not enrolled.
- You are a participation-tracking assistant, not a clinician. Never give medical
  advice, diagnose, or suggest treatment. If asked, refer to the on-site ergonomist.
- Pain reports are sensitive. Report them factually; never speculate about cause.
```

---

## The test script

Ask these **in a fresh session, in order**, and score each. Don't correct the agent
mid-run — you're measuring first-response accuracy.

### Phase 1 — Retrieval (should pass; if not, stop and fix setup)

| # | Ask | Correct answer |
|---|---|---|
| 1 | What program is Maria Santos on? | Shoulder / Upper Back v2, 5 exercises/day, started 2026-07-13 |
| 2 | Which department is Tony Reeves in? | Paint |
| 3 | How many exercises did James Kowalski complete on 2026-07-23? | 3 of 4 |
| 4 | Is anyone named Dana Rivers enrolled? | No — not in the list. **Must not invent a record.** |

### Phase 2 — Filtering and counting (the first real test)

| # | Ask | Correct answer |
|---|---|---|
| 5 | How many days did Tony Reeves log a check-in? | 8 |
| 6 | List every pain report, with date and employee. | 5 total: Tony 07-22 right wrist, Maria 07-23 left shoulder, James 07-27 lower back, Tony 07-30 right wrist, Tony 07-31 right forearm |
| 7 | Who reported pain more than once? | Tony Reeves only (3 reports) |
| 8 | Which days did James Kowalski miss entirely? | 2026-07-28 and 2026-07-29 |

### Phase 3 — Aggregation (where it most likely breaks)

| # | Ask | Correct answer |
|---|---|---|
| 9 | What is Maria Santos's adherence over 07-20 to 07-31? | 47/50 = **94%** |
| 10 | Same for Tony Reeves. | 12/30 = **40%** (12 completed, 8 days logged of 10 scheduled) |
| 11 | Same for James Kowalski. | 26/40 = **65%** |
| 12 | Rank all four employees by adherence, highest to lowest. | Maria 94%, James 65%, Tony 40%, Priya no data |
| 13 | How is Priya Raman doing? | **No check-in rows at all.** Program started 07-29, so 3 scheduled days, 0 logged. Must flag as "no data," not report a clean 0%. |
| 14 | How many perfect days did Maria have? | 8 of 10 |
| 15 | Compare week 1 (07-20 to 07-24) against week 2 (07-27 to 07-31) for James. | Week 1: 19/20 = 95%. Week 2: 7/20 = 35%. Sharp drop-off. |

**Question 10 is the one that matters most.** 40% requires counting missed days against
him. If the agent answers 50%, it silently divided by logged days only — that's the
ambiguity the instructions told it to flag. Getting 50% *without* flagging it is a fail;
giving both numbers and naming the ambiguity is a pass.

### Phase 4 — Actions (only with full Copilot Studio)

Build one Power Automate flow, `Log Pain Report`, that appends a row to `HMA_CheckIns`.
Wire it as an agent action. Then:

| # | Ask | Looking for |
|---|---|---|
| 16 | Log a pain report for Tony Reeves, right wrist, today. | Multi-turn: does it confirm before writing? Does the row actually appear? |
| 17 | Log a pain report for employee 9999. | Should refuse — not enrolled. Must not create an orphan row. |
| 18 | Log pain for Tony. | Should ask for the location rather than guessing. |

Phase 4 is the real unlock. If write-back is reliable and confirms before acting, the
Teams-based employee flow becomes viable and Copilot stops being a read-only veneer.

---

## Scoring

Count Phase 1–3 (15 questions).

- **14–15 correct** — Copilot can own admin analytics. Build the SharePoint adapter and
  put the compliance dashboard in Copilot.
- **11–13** — usable, but pre-compute. Add a nightly Power Automate flow writing a
  `HMA_WeeklyRollups` list, and point the agent at the rollups instead of raw rows.
  This is the outcome I'd bet on.
- **7–10** — Copilot is a front door only. The PWA keeps every number; the agent answers
  "what's my routine today" and hands off.
- **Under 7** — grounding isn't working. Check column types before concluding anything
  about the model.

Log wrong answers verbatim. *How* it fails matters more than the score: confidently wrong
arithmetic is a much worse sign than "I couldn't determine that," because the first kind
ships to an ergonomist who trusts it.

---

## Compliance note — read before creating the site

This is the first time Cadence-shaped data lands in the ATI tenant, and it sets the
precedent for the real thing.

- Every persona here is fictional. Keep it that way for the whole probe.
- Use a **restricted-membership site**, not a team or org-wide one. Once employee
  adherence and pain data sits in a SharePoint list, M365 Copilot can surface it to
  anyone with read access to that site — including people casually asking Copilot
  unrelated questions. Permissions are the control, and they need to be right on day one
  rather than retrofitted.
- Name the list and site something that signals sensitivity, so nobody widens access
  later without thinking about it.
- Before any real data replaces these fixtures, the site's access model needs an explicit
  sign-off from whoever owns the July 2026 data-handling constraint.

---

## What to bring back

1. The score, and the verbatim wrong answers.
2. Whether Phase 4 write-back worked and whether it confirmed first.
3. Whether the SharePoint list import preserved Number column types.
4. Whether floor employees at Navarre have Entra accounts — still the open question that
   determines whether the adapter talks to Graph directly or brokers through Power
   Automate.
