import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function AdminShell({ children }) {
  const { employee, signOut } = useAuth();
  return (
    <>
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__brand-mark">H</div>
          <div>HMA <span style={{ opacity: .55, fontWeight: 500 }}>Admin</span></div>
        </div>

        <nav className="app-header__nav">
          <NavLink to="/admin" end>Employees</NavLink>
          <NavLink to="/admin/pain">Pain Queue</NavLink>
        </nav>

        <button className="app-header__signout" onClick={signOut}>
          {employee?.name?.split(' ')[0] ?? 'Sign out'} · ⏻
        </button>
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
