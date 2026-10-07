import { NavLink } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { asset } from '../lib/asset.js';
import { clientLogo, clientLogoAlt } from '../lib/branding.js';

/* INSIDE THE SUITE since 2026-10-07 (owner: "Yes, move Cadence-Admin inside the
   suite"), served at /cadence behind the suite's sign-in -- so this header now
   follows the suite's two rules for a section's header:

   - HOME COMES FIRST in the nav row, then a hairline, then the tabs, and it is
     15% larger than the tabs (owner, 2026-09-25; HMA-Manual's placement, "in all
     of them"). A plain <a>, not a router link: "/" is the suite's home screen,
     outside this app's base, and must be a full page load.
   - NO SIGN OUT. There is one, on the home screen (D7). The suite's session is
     the only one this page has; a button here would have ended nothing. */
export default function AdminShell({ children }) {
  const logo = clientLogo();
  const logoAlt = clientLogoAlt();

  return (
    <>
      <header className="app-header app-header--admin">
        <div className="app-header__brand">
          <div className="app-header__brand-mark">
            {/* ATI FIRST, matching the login card. Owner, 2026-09-24: "Yes, I
                want them to match." The login was moved to ATI-left the same
                day, because "the other programs generally hav[e] their ATI
                Worksite Solutions logo in the left-aligned position", and two
                screens of one app disagreeing was worse than either order.

                THIS REVERSES A RECORDED DECISION, so the old reasoning is kept
                rather than deleted: the employee's own company used to read
                first, on the grounds that in their hands this is a Hendrickson
                thing that ATI provides rather than the reverse. Still a fair
                argument. It lost to estate-wide consistency, by the owner. */}
            {/* THE POSITIVE LOCKUP, because this plate is WHITE.
                `/ati-logo.png` is the white REVERSE lockup -- 100% near-white
                artwork -- so it rendered as nothing here, an empty white box
                with the client mark alone at its edge. Found 2026-09-24 by
                signing in and looking at the header; the order change that day
                only made the hole obvious, it did not cause it.

                Same bug as HMA-Manual's login card had the same morning, and
                the same fix: on a light ground use the POSITIVE lockup (Brand
                Guide 1.3). The login card below already did this correctly. */}
            <img src={asset('/ati-logo-positive.png')} alt="ATI Worksite Solutions" />
            {logo ? (
              <>
                <span className="app-header__brand-divider" aria-hidden="true" />
                <img src={logo} alt={logoAlt} />
              </>
            ) : null}
          </div>
          <div>HMA <span style={{ opacity: .55, fontWeight: 500 }}>Admin</span></div>
        </div>

        <nav className="app-header__nav">
          <a className="app-header__home" href="/" title="HMA Specialist's Suite">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
            Home
          </a>
          <span className="app-header__home-rule" aria-hidden="true" />
          <NavLink to="/admin" end>Employees</NavLink>
          <NavLink to="/admin/pain">Pain Queue</NavLink>
          <NavLink to="/admin/issue">Issue</NavLink>
          <NavLink to="/admin/returns">Reports</NavLink>
          <NavLink to="/admin/import">Import</NavLink>
        </nav>

        <div className="app-header__tools">
          <ThemeToggle />
        </div>
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
