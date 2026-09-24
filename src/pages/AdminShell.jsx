import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { clientLogo, clientLogoAlt } from '../lib/branding.js';

export default function AdminShell({ children }) {
  const { employee, signOut } = useAuth();
  const logo = clientLogo();
  const logoAlt = clientLogoAlt();

  return (
    <>
      <header className="app-header app-header--admin">
        <div className="app-header__brand">
          <div className="app-header__brand-mark">
            {logo ? (
              <>
                <img src={logo} alt={logoAlt} />
                <span className="app-header__brand-divider" aria-hidden="true" />
              </>
            ) : null}
            <img src="/ati-logo.png" alt="ATI Worksite Solutions" />
          </div>
          <div>HMA <span style={{ opacity: .55, fontWeight: 500 }}>Admin</span></div>
        </div>

        <nav className="app-header__nav">
          <NavLink to="/admin" end>Employees</NavLink>
          <NavLink to="/admin/pain">Pain Queue</NavLink>
          <NavLink to="/admin/issue">Issue</NavLink>
          <NavLink to="/admin/returns">Reports</NavLink>
          <NavLink to="/admin/import">Import</NavLink>
        </nav>

        <div className="app-header__tools">
          <ThemeToggle />
          <button className="app-header__signout" onClick={signOut}>
            {employee?.name?.split(' ')[0] ?? 'Sign out'} · ⏻
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
