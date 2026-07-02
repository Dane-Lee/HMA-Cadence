import { useEffect, useState } from 'react';
import { fetchAdminEmployeeList } from '../lib/queries.js';

function formatDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysUntil(date) {
  if (!date) return null;
  const diff = Math.ceil((new Date(date) - new Date()) / 86_400_000);
  return diff;
}

export default function AdminEmployees() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchAdminEmployeeList();
        setEmployees(list);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="loading">Loading employees…</div>;

  if (error) return <div className="empty-state">Couldn't load: {error}</div>;

  if (employees.length === 0) {
    return (
      <>
        <h1 className="page-title">Employees</h1>
        <p className="page-subtitle">Nobody enrolled yet.</p>
        <div className="empty-state">
          Add an employee to begin. (Onboarding flow lives in the admin tools — coming soon.)
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="page-title">Employees</h1>
      <p className="page-subtitle">Active programs · weekly compliance</p>

      <div className="admin-grid">
        {employees.map((e) => {
          const followUpDays = daysUntil(e.program?.follow_up_date);
          const followUpSoon = followUpDays != null && followUpDays <= 7 && followUpDays >= 0;
          const followUpOverdue = followUpDays != null && followUpDays < 0;

          return (
            <div key={e.id} className="employee-card">
              <div>
                <div>
                  <span className="employee-card__name">{e.name}</span>
                  <span className="employee-card__badge">#{e.employee_number}</span>
                </div>
                <div className="employee-card__row">
                  {e.program ? (
                    <>
                      <span>{e.program.days_per_week}× / week</span>
                      <span>This week: {e.sessionsThisWeek} / {e.daysPerWeek ?? e.program.days_per_week}</span>
                      {e.program.follow_up_date && (
                        <span className={`employee-card__chip ${followUpOverdue ? 'danger' : followUpSoon ? 'warn' : ''}`}>
                          Follow-up {formatDate(e.program.follow_up_date)}
                          {followUpOverdue ? ' · overdue' : followUpSoon ? ` · in ${followUpDays}d` : ''}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">No active program</span>
                  )}

                  {e.unresolvedPainCount > 0 && (
                    <span className="employee-card__chip danger">
                      ⚠ {e.unresolvedPainCount} pain report{e.unresolvedPainCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="employee-card__compliance">
                <div className="employee-card__pct">{e.compliancePct}%</div>
                <div className="employee-card__bar">
                  <div className="employee-card__bar-fill" style={{ width: `${e.compliancePct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
