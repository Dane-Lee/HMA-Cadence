import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useDailyReminder } from '../lib/reminders.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function EmployeeShell({ children }) {
  const { employee, signOut } = useAuth();

  // Foreground daily reminder driven by the employee's saved preferences.
  useDailyReminder({
    enabled: employee?.notification_enabled ?? false,
    time: employee?.notification_time ?? '07:00',
    firstName: employee?.name?.split(' ')[0] ?? '',
  });

  return (
    <>
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__brand-mark">
            <img src="/hendrickson-logo.jpg" alt="Hendrickson" />
            <span className="app-header__brand-divider" aria-hidden="true" />
            <img src="/ati-logo.png" alt="ATI Worksite Solutions" />
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
