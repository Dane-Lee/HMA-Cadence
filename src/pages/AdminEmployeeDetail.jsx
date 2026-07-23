import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  fetchAdminEmployeeDetail,
  acknowledgePain,
  resolvePain,
} from '../lib/queries.js';
import { MOVEMENT_CATEGORIES, PAIN_CATEGORIES, FEEDBACK_RATINGS } from '../lib/constants.js';

const WEEKDAY_ABBR = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const catMeta = (key) => MOVEMENT_CATEGORIES.find((c) => c.key === key);
const catLabel = (key) => catMeta(key)?.label ?? key;
const painLabel = (key) => PAIN_CATEGORIES.find((c) => c.key === key)?.label ?? key;
const feedbackMeta = (key) => FEEDBACK_RATINGS.find((f) => f.key === key);

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / 86_400_000);
}

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AdminEmployeeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const d = await fetchAdminEmployeeDetail(id);
      setDetail(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function onPainAction(reportId, action) {
    setBusyId(reportId);
    setError(null);
    try {
      const updated = await (action === 'resolve' ? resolvePain : acknowledgePain)(reportId);
      setDetail((prev) => prev && {
        ...prev,
        painReports: prev.painReports.map((r) => (r.id === reportId ? { ...r, ...updated } : r)),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (error && !detail) return <div className="empty-state">Couldn't load: {error}</div>;
  if (!detail) return null;

  const { employee, program, compliance, assignments, painReports } = detail;
  const followUpDays = daysUntil(program?.follow_up_date);
  const followUpOverdue = followUpDays != null && followUpDays < 0;
  const followUpSoon = followUpDays != null && followUpDays >= 0 && followUpDays <= 7;
  const unresolvedCount = painReports.filter((p) => !p.resolved).length;

  return (
    <>
      <button className="back-link" onClick={() => navigate('/admin')}>← All employees</button>

      <div className="detail-head">
        <div>
          <span className="page-title" style={{ marginBottom: 0 }}>{employee.name}</span>
          <span className="employee-card__badge">#{employee.employee_number}</span>
        </div>
        {!employee.active && <span className="employee-card__chip">Inactive</span>}
      </div>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      {!program ? (
        <div className="empty-state">No active program for this employee.</div>
      ) : (
        <>
          {/* Program summary + overall compliance */}
          <section className="detail-section">
            <div className="detail-summary">
              <div className="detail-compliance">
                <div className="detail-compliance__pct">{compliance.compliancePct}%</div>
                <div className="employee-card__bar" style={{ width: '100%' }}>
                  <div className="employee-card__bar-fill" style={{ width: `${compliance.compliancePct}%` }} />
                </div>
                <div className="muted" style={{ fontSize: '.85rem', marginTop: 6 }}>
                  {compliance.completedInstances} / {compliance.scheduledInstances} exercises this week
                </div>
              </div>

              <dl className="detail-meta">
                <div><dt>Assessment</dt><dd>{program.assessment_type ?? '—'} · {fmtDate(program.initial_assessment_date)}</dd></div>
                <div><dt>HMA score</dt><dd>{program.total_score ?? '—'}</dd></div>
                <div>
                  <dt>Follow-up</dt>
                  <dd>
                    {fmtDate(program.follow_up_date)}
                    {followUpOverdue && <span className="employee-card__chip danger" style={{ marginLeft: 8 }}>overdue</span>}
                    {followUpSoon && <span className="employee-card__chip warn" style={{ marginLeft: 8 }}>in {followUpDays}d</span>}
                  </dd>
                </div>
                <div>
                  <dt>Schedule</dt>
                  <dd>{(program.work_days ?? []).map((d) => WEEKDAY_ABBR[d]).join(', ') || '—'}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Per-exercise adherence */}
          <section className="detail-section">
            <h2 className="detail-section__title">Exercises · this week</h2>
            <div className="admin-grid">
              {assignments.map((a) => {
                const pct = a.scheduledCount ? Math.round((100 * a.completedCount) / a.scheduledCount) : 0;
                const fb = feedbackMeta(a.feedback);
                return (
                  <div key={a.assignmentId} className="adherence-row">
                    <span className="adherence-row__dot" style={{ background: `var(${catMeta(a.movement_category)?.cssVar ?? '--text-muted'})` }} />
                    <div className="adherence-row__main">
                      <div className="adherence-row__name">
                        {a.name}
                        {fb && <span className="adherence-row__fb" title={fb.adminLabel}>{fb.icon}</span>}
                        {a.unresolvedPainCount > 0 && (
                          <span className="employee-card__chip danger" style={{ marginLeft: 8 }}>⚠ pain</span>
                        )}
                      </div>
                      <div className="adherence-row__meta">
                        <span>{catLabel(a.movement_category)}</span>
                        <span className="muted">{a.prescription}</span>
                        <span className="muted">{a.days.map((d) => WEEKDAY_ABBR[d]).join('/')}</span>
                      </div>
                    </div>
                    <div className="adherence-row__count">
                      <span className={a.completedCount >= a.scheduledCount && a.scheduledCount > 0 ? 'ok' : ''}>
                        {a.completedCount}/{a.scheduledCount}
                      </span>
                      <div className="employee-card__bar" style={{ width: 64 }}>
                        <div className="employee-card__bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Pain history */}
      <section className="detail-section">
        <h2 className="detail-section__title">
          Pain reports {unresolvedCount > 0 && <span className="employee-card__chip danger">{unresolvedCount} open</span>}
        </h2>
        {painReports.length === 0 ? (
          <p className="muted">No pain reports.</p>
        ) : (
          <div className="admin-grid">
            {painReports.map((r) => {
              const busy = busyId === r.id;
              return (
                <div key={r.id} className={`employee-card ${r.resolved ? 'is-acknowledged' : ''}`}>
                  <div>
                    <div className="employee-card__row" style={{ marginTop: 0 }}>
                      <span className={`employee-card__chip ${r.resolved ? '' : 'danger'}`}>
                        {r.resolved ? '✓ ' : '⚠ '}{painLabel(r.category)}
                      </span>
                      <span>{r.assignment?.exercise?.name}</span>
                      <span className="muted">{relTime(r.reported_at)}</span>
                      {r.resolved && <span className="muted">· resolved</span>}
                      {!r.resolved && r.acknowledged && <span className="employee-card__chip">Seen</span>}
                    </div>
                  </div>
                  {!r.resolved && (
                    <div className="pain-actions">
                      {!r.acknowledged && (
                        <button className="btn btn-secondary btn-inline" disabled={busy}
                          onClick={() => onPainAction(r.id, 'acknowledge')}>
                          {busy ? '…' : 'Acknowledge'}
                        </button>
                      )}
                      <button className="btn btn-inline" disabled={busy}
                        onClick={() => onPainAction(r.id, 'resolve')}>
                        {busy ? '…' : 'Resolve'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
