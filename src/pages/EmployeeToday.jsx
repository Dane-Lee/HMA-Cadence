import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { MOVEMENT_CATEGORIES, PAIN_CATEGORIES } from '../lib/supabase.js';
import {
  fetchActiveProgram,
  fetchTodayCheckIn,
  toggleExerciseComplete,
  endSessionEarly,
  reportPain,
  submitFeedback,
} from '../lib/queries.js';

export default function EmployeeToday() {
  const { employee } = useAuth();
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState(null);
  const [checkIn, setCheckIn] = useState(null);
  const [error, setError] = useState(null);
  const [showDoneBanner, setShowDoneBanner] = useState(false);

  // expansion state — which card has the pain prompt open
  const [expandedFor, setExpandedFor] = useState(null); // assignmentId | null

  const load = useCallback(async () => {
    if (!employee?.id) return;
    try {
      setLoading(true);
      const p = await fetchActiveProgram(employee.id);
      setProgram(p);
      if (p) {
        const c = await fetchTodayCheckIn(employee.id, p.id);
        setCheckIn(c);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [employee?.id]);

  useEffect(() => { load(); }, [load]);

  // ── derived ────────────────────────────────────────────────────
  const completedSet = useMemo(() => {
    const s = new Set();
    for (const c of checkIn?.completions ?? []) {
      if (c.completed) s.add(c.exercise_assignment_id);
    }
    return s;
  }, [checkIn]);

  const total = program?.assignments?.length ?? 0;
  const done  = completedSet.size;
  const allDone = total > 0 && done === total;

  // Group by movement category, preserving the category order
  const grouped = useMemo(() => {
    if (!program?.assignments) return [];
    const byCategory = new Map();
    for (const a of program.assignments) {
      if (!byCategory.has(a.movement_category)) byCategory.set(a.movement_category, []);
      byCategory.get(a.movement_category).push(a);
    }
    return MOVEMENT_CATEGORIES
      .map((cat) => ({ ...cat, items: byCategory.get(cat.key) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [program]);

  // ── actions ─────────────────────────────────────────────────────
  async function onToggle(assignment) {
    if (!program) return;
    const wasComplete = completedSet.has(assignment.assignmentId);
    const nextComplete = !wasComplete;

    // optimistic
    setCheckIn((prev) => {
      const completions = [...(prev?.completions ?? [])];
      const idx = completions.findIndex((c) => c.exercise_assignment_id === assignment.assignmentId);
      if (idx >= 0) completions[idx] = { ...completions[idx], completed: nextComplete };
      else completions.push({ exercise_assignment_id: assignment.assignmentId, completed: nextComplete });
      return { ...(prev ?? { id: null }), completions };
    });

    try {
      const checkInId = await toggleExerciseComplete({
        employeeId: employee.id,
        programId: program.id,
        assignmentId: assignment.assignmentId,
        completed: nextComplete,
      });
      setCheckIn((prev) => prev?.id ? prev : { ...(prev ?? {}), id: checkInId });
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  async function onReportPain(assignment, category) {
    try {
      await reportPain({
        employeeId: employee.id,
        assignmentId: assignment.assignmentId,
        programId: program.id,
        category,
      });
      setExpandedFor(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onEndEarly() {
    try {
      if (checkIn?.id) await endSessionEarly(checkIn.id);
      // brief acknowledgement
      setShowDoneBanner(true);
      setTimeout(() => setShowDoneBanner(false), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  // auto-show banner when all complete
  useEffect(() => {
    if (allDone) {
      setShowDoneBanner(true);
      const t = setTimeout(() => setShowDoneBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [allDone]);

  // ── render ─────────────────────────────────────────────────────
  if (loading) return <div className="loading">Loading your program…</div>;

  if (!program) {
    return (
      <div className="empty-state">
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>No active program yet</h2>
        <p>Once Dane finishes your HMA, your corrective exercises will appear here.</p>
      </div>
    );
  }

  const firstName = employee?.name?.split(' ')[0] ?? '';
  const pctDone = total ? Math.round((done / total) * 100) : 0;

  return (
    <>
      <div className="today-greeting">Hi {firstName} 👋</div>
      <div className="today-progress">
        <div>
          <span className="today-progress__count">{done}</span>
          <span className="today-progress__label"> / {total} today</span>
        </div>
      </div>
      <div className="today-progress__bar">
        <div className="today-progress__bar-fill" style={{ width: `${pctDone}%` }} />
      </div>

      <div className="spacer-md" />

      {showDoneBanner && (
        <div className="done-banner">
          🎉 Great job — all finished for today.
        </div>
      )}

      {grouped.map((group) => (
        <section key={group.key} className="category-group">
          <div className="category-group__header">
            <span className="category-group__dot" style={{ background: `var(${group.cssVar})` }} />
            {group.label}
          </div>

          {group.items.map((a) => {
            const isComplete = completedSet.has(a.assignmentId);
            const isExpanded = expandedFor === a.assignmentId;

            return (
              <div
                key={a.assignmentId}
                className={`exercise-card ${isComplete ? 'is-complete' : ''} ${isExpanded ? 'is-expanded' : ''}`}
              >
                <button
                  className="exercise-card__check"
                  onClick={() => onToggle(a)}
                  aria-label={isComplete ? 'Mark incomplete' : 'Mark complete'}
                >
                  ✓
                </button>

                <div className="exercise-card__body" onClick={() => onToggle(a)}>
                  <div className="exercise-card__name">{a.name}</div>
                  <div className="exercise-card__meta">
                    <span className="exercise-card__type-pill">{a.exercise_type}</span>
                    <span>{a.sets} × {a.reps}</span>
                  </div>
                </div>

                <button
                  className="exercise-card__flag"
                  aria-label="Report pain or issue"
                  onClick={() => setExpandedFor(isExpanded ? null : a.assignmentId)}
                >
                  ⚑
                </button>

                {isExpanded && (
                  <div className="exercise-card__expand">
                    <div className="muted" style={{ marginBottom: 8, fontSize: '.9rem' }}>
                      What are you experiencing?
                    </div>
                    <div className="option-row">
                      {PAIN_CATEGORIES.map((p) => (
                        <button key={p.key} onClick={() => onReportPain(a, p.key)}>
                          {p.label}
                        </button>
                      ))}
                      <button onClick={() => setExpandedFor(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      {!allDone && done > 0 && (
        <a className="done-link" onClick={onEndEarly}>Done for today</a>
      )}

      {error && (
        <div className="login-error" style={{ marginTop: 16 }}>{error}</div>
      )}
    </>
  );
}
