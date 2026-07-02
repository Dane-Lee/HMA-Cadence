import { useEffect, useState } from 'react';
import { fetchUnresolvedPainReports } from '../lib/queries.js';
import { PAIN_CATEGORIES } from '../lib/supabase.js';

function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const categoryLabel = (key) =>
  PAIN_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export default function AdminPainQueue() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchUnresolvedPainReports();
        setReports(r);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="loading">Loading reports…</div>;
  if (error) return <div className="empty-state">Couldn't load: {error}</div>;

  return (
    <>
      <h1 className="page-title">Pain Queue</h1>
      <p className="page-subtitle">
        {reports.length === 0 ? 'All clear — no unresolved reports.' : `${reports.length} unresolved`}
      </p>

      <div className="admin-grid">
        {reports.map((r) => (
          <div key={r.id} className="employee-card">
            <div>
              <div>
                <span className="employee-card__name">{r.employee?.name}</span>
                <span className="employee-card__badge">#{r.employee?.employee_number}</span>
              </div>
              <div className="employee-card__row">
                <span className="employee-card__chip danger">
                  ⚠ {categoryLabel(r.category)}
                </span>
                <span>{r.assignment?.exercise?.name}</span>
                <span className="muted">{relTime(r.reported_at)}</span>
              </div>
            </div>
            <div className="employee-card__compliance" style={{ minWidth: 'auto' }}>
              <button className="btn btn-secondary" style={{ minHeight: 40, width: 'auto' }}>
                Acknowledge
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
