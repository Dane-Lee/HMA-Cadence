/**
 * Full-screen status message for the QR entry points (/pair, /plan).
 *
 * These screens are reached from a camera scan before any shell or navigation
 * exists — often before the employee even has an account — so they stand alone
 * rather than rendering inside EmployeeShell.
 */
export default function StatusCard({ title, tone = 'neutral', children }) {
  return (
    <main className={`status-card status-card--${tone}`}>
      <h1 className="status-card__title">{title}</h1>
      {children}
    </main>
  );
}
