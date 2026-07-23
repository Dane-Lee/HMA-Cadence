import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { MOVEMENT_CATEGORIES, PAIN_CATEGORIES, FEEDBACK_RATINGS } from '../lib/constants.js';
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

  // expansion state — which card has the feedback/pain prompt open
  const [expandedFor, setExpandedFor] = useState(null); // assignmentId | null
  // optimistic feedback overrides, keyed by assignmentId (falls back to program value)
  const [feedbackOverrides, setFeedbackOverrides] = useState({});
  // brief "thanks for the feedback" acknowledgement, keyed by assignmentId
  const [feedbackAckFor, setFeedbackAckFor] = useState(null);

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

  // Today's exercises = assignments scheduled for today's ISO weekday
  // (1=Mon … 7=Sun). The intake stores a per-exercise `days` split, and the
  // DB compliance views only credit completions done on a scheduled weekday
  // (isodow ∈ days) — so the checklist must show exactly that same set, or the
  // employee would do work that never counts. Derived from the UTC date to
  // stay consistent with check_ins.date (also UTC-derived).
  const isoDow = useMemo(() => {
    const utcDay = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getUTCDay();
    return ((utcDay + 6) % 7) + 1; // Sun(0)→7, Mon(1)→1 …
  }, []);

  const todaysAssignments = useMemo(
    () => (program?.assignments ?? []).filter((a) => (a.days ?? []).includes(isoDow)),
    [program, isoDow],
  );

  const total = todaysAssignments.length;
  const done  = todaysAssignments.filter((a) => completedSet.has(a.assignmentId)).length;
  const allDone = total > 0 && done === total;

  // Group by movement category, preserving the category order
  const grouped = useMemo(() => {
    const byCategory = new Map();
    for (const a of todaysAssignments) {
      if (!byCategory.has(a.movement_category)) byCategory.set(a.movement_category, []);
      byCategory.get(a.movement_category).push(a);
    }
    return MOVEMENT_CATEGORIES
      .map((cat) => ({ ...cat, items: byCategory.get(cat.key) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [todaysAssignments]);

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

  const feedbackOf = (a) => feedbackOverrides[a.assignmentId] ?? a.feedback ?? null;

  async function onFeedback(assignment, rating) {
    const prev = feedbackOverrides[assignment.assignmentId] ?? assignment.feedback ?? null;
    // optimistic
    setFeedbackOverrides((m) => ({ ...m, [assignment.assignmentId]: rating }));
    setFeedbackAckFor(assignment.assignmentId);
    setTimeout(() => setFeedbackAckFor((cur) => (cur === assignment.assignmentId ? null : cur)), 1500);
    try {
      await submitFeedback({ employeeId: employee.id, assignmentId: assignment.assignmentId, rating });
    } catch (err) {
      setError(err.message);
      setFeedbackOverrides((m) => ({ ...m, [assignment.assignmentId]: prev }));
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

  const firstName = employee?.name?.split(' ')[0] ?? '';

  if (!program) {
    return (
      <div className="empty-state">
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>No active program yet</h2>
        <p>Once Dane finishes your HMA, your corrective exercises will appear here.</p>
      </div>
    );
  }

  // Active program, but nothing scheduled for today's weekday → rest day.
  if (total === 0) {
    return (
      <div className="empty-state">
        <div className="today-greeting" style={{ marginBottom: 12 }}>Hi {firstName} 👋</div>
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>Nothing scheduled today</h2>
        <p>Enjoy your rest day — your next exercises will be here when they’re due.</p>
      </div>
    );
  }
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
            const fb = feedbackOf(a);
            const fbMeta = FEEDBACK_RATINGS.find((f) => f.key === fb);

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
                    <span>{a.prescription}</span>
                    {fbMeta && (
                      <span className="exercise-card__fb" title={fbMeta.adminLabel}>{fbMeta.icon}</span>
                    )}
                  </div>
                </div>

                <button
                  className="exercise-card__flag"
                  aria-label="Give feedback or report an issue"
                  onClick={() => setExpandedFor(isExpanded ? null : a.assignmentId)}
                >
                  ⚑
                </button>

                {isExpanded && (
                  <div className="exercise-card__expand">
                    <div className="muted" style={{ marginBottom: 8, fontSize: '.9rem' }}>
                      How&rsquo;s this exercise going?
                    </div>
                    <div className="option-row">
                      {FEEDBACK_RATINGS.map((f) => (
                        <button
                          key={f.key}
                          className={fb === f.key ? 'is-selected' : ''}
                          onClick={() => onFeedback(a, f.key)}
                        >
                          {f.icon} {f.prompt}
                        </button>
                      ))}
                    </div>

                    <div className="muted" style={{ margin: '14px 0 8px', fontSize: '.9rem' }}>
                      Pain or discomfort? Let Dane know.
                    </div>
                    <div className="option-row">
                      {PAIN_CATEGORIES.map((p) => (
                        <button key={p.key} onClick={() => onReportPain(a, p.key)}>
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <button
                      className="btn-ghost"
                      style={{ marginTop: 12, width: '100%' }}
                      onClick={() => setExpandedFor(null)}
                    >
                      {feedbackAckFor === a.assignmentId ? 'Thanks — saved ✓' : 'Close'}
                    </button>
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
