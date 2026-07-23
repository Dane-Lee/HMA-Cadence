import { useEffect, useState } from 'react';
import { fetchUnresolvedPainReports, acknowledgePain, resolvePain } from '../lib/queries.js';
import { PAIN_CATEGORIES } from '../lib/constants.js';

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
  const [busyId, setBusyId] = useState(null);

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

  async function onAcknowledge(id) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await acknowledgePain(id);
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function onResolve(id) {
    setBusyId(id);
    setError(null);
    try {
      await resolvePain(id);
      // Resolved reports drop out of the unresolved queue.
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="loading">Loading reports…</div>;
  if (error && reports.length === 0) return <div className="empty-state">Couldn't load: {error}</div>;

  return (
    <>
      <h1 className="page-title">Pain Queue</h1>
      <p className="page-subtitle">
        {reports.length === 0 ? 'All clear — no unresolved reports.' : `${reports.length} unresolved`}
      </p>

      {error && <div className="login-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="admin-grid">
        {reports.map((r) => {
          const busy = busyId === r.id;
          return (
            <div key={r.id} className={`employee-card ${r.acknowledged ? 'is-acknowledged' : ''}`}>
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
                  {r.acknowledged && <span className="employee-card__chip">Seen</span>}
                </div>
              </div>
              <div className="pain-actions">
                {!r.acknowledged && (
                  <button
                    className="btn btn-secondary btn-inline"
                    disabled={busy}
                    onClick={() => onAcknowledge(r.id)}
                  >
                    {busy ? '…' : 'Acknowledge'}
                  </button>
                )}
                <button
                  className="btn btn-inline"
                  disabled={busy}
                  onClick={() => onResolve(r.id)}
                >
                  {busy ? '…' : 'Resolve'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
