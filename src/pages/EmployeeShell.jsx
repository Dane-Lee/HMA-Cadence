import { useAuth } from '../lib/auth.jsx';

export default function EmployeeShell({ children }) {
  const { employee, signOut } = useAuth();
  return (
    <>
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__brand-mark">H</div>
          <div>HMA</div>
        </div>
        <button className="app-header__signout" onClick={signOut} aria-label="Sign out">
          {employee?.name?.split(' ')[0] ?? 'Sign out'} · ⏻
        </button>
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
