import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { db } from './data/index.js';

/**
 * Custom PIN-based auth.
 *
 * This provider owns only the session (state + localStorage + React context).
 * Credential work lives in the data layer (`db.authenticate`, `db.changePin`)
 * so it swaps with the backend — the local adapter verifies a bcrypt hash;
 * a future sanctioned-DB adapter will verify server-side and mint a JWT.
 *
 * `employee.must_change_pin` drives the forced first-login PIN-change flow
 * (see <RequireAuth> in App.jsx). Session is persisted in localStorage as
 * { employee, signedInAt }.
 */

const STORAGE_KEY = 'hma-cadence:session';

/**
 * WHO IS SIGNED IN TO THE ADMIN BUILD: whoever the suite let in.
 *
 * Since 2026-10-07 the suite serves the admin build at /cadence, behind its own
 * sign-in -- the page cannot be reached without it. So the admin build has no
 * login of its own any more, and this is the admin it runs as. The demo seed's
 * `ADMIN001` was the only reason that build carried the seed at all (decision
 * A2's open piece), and it is gone with it. `role` is all the admin routes check.
 */
export const SUITE_ADMIN = {
  id: 'suite-admin',
  employee_number: '',
  name: 'Specialist',
  role: 'admin',
  active: true,
  must_change_pin: false,
};

/** The session a fresh page starts with. A parameter, so a test can ask for
 *  either build's answer; the app passes nothing and gets its own. */
export function initialSession(isAdminBuild = __ADMIN_BUILD__) {
  if (isAdminBuild) return { employee: SUITE_ADMIN, signedInAt: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => initialSession());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The suite owns the admin's session; there is nothing of ours to keep.
    if (__ADMIN_BUILD__) return;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  const signIn = useCallback(async (employeeNumber, pin) => {
    setLoading(true);
    try {
      const employee = await db.authenticate(employeeNumber, pin);
      const next = { employee, signedInAt: new Date().toISOString() };
      setSession(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  // Set a new PIN for the signed-in employee and refresh the session so the
  // must_change_pin gate clears without a re-login.
  const changePin = useCallback(async (newPin) => {
    const employeeId = session?.employee?.id;
    if (!employeeId) throw new Error('Not signed in');
    const employee = await db.changePin({ employeeId, newPin });
    setSession((prev) => (prev ? { ...prev, employee } : prev));
    return employee;
  }, [session?.employee?.id]);

  // Persist reminder preferences and refresh the session employee in place.
  const updateNotificationPrefs = useCallback(async (prefs) => {
    const employeeId = session?.employee?.id;
    if (!employeeId) throw new Error('Not signed in');
    const employee = await db.updateNotificationPrefs({ employeeId, ...prefs });
    setSession((prev) => (prev ? { ...prev, employee } : prev));
    return employee;
  }, [session?.employee?.id]);

  const value = {
    session,
    employee: session?.employee ?? null,
    role: session?.employee?.role ?? null,
    isAdmin: session?.employee?.role === 'admin',
    isEmployee: session?.employee?.role === 'employee',
    mustChangePin: session?.employee?.must_change_pin === true,
    loading,
    signIn,
    signOut,
    changePin,
    updateNotificationPrefs,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
