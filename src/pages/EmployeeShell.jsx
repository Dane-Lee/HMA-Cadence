import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useDailyReminder } from '../lib/reminders.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { clientLogo, clientLogoAlt } from '../lib/branding.js';

export default function EmployeeShell({ children }) {
  const { employee, signOut } = useAuth();

  // Foreground daily reminder driven by the employee's saved preferences.
  useDailyReminder({
    enabled: employee?.notification_enabled ?? false,
    time: employee?.notification_time ?? '07:00',
    firstName: employee?.name?.split(' ')[0] ?? '',
  });

  const logo = clientLogo();
  const logoAlt = clientLogoAlt();

  return (
    <>
      <header className="app-header">
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
            <img src="/ati-logo-positive.png" alt="ATI Worksite Solutions" />
            {logo ? (
              <>
                <span className="app-header__brand-divider" aria-hidden="true" />
                <img src={logo} alt={logoAlt} />
              </>
            ) : null}
          </div>
          <div>HMA</div>
        </div>
        <div className="app-header__nav">
          <NavLink to="/today" end aria-label="Today">Today</NavLink>
          <NavLink to="/settings" aria-label="Reminders">Reminders</NavLink>
          <ThemeToggle />
          <button className="app-header__signout" onClick={signOut} aria-label="Sign out">
            {employee?.name?.split(' ')[0] ?? 'Sign out'} · ⏻
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </>
  );
}
