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

const STORAGE_KEY = 'hma-tracker:session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
