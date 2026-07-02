import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase.js';

/**
 * Custom PIN-based auth.
 *
 * Phase 1 implementation: PIN check happens in the client against pin_hash
 * read from the employees table (anon key with permissive RLS for dev).
 *
 * Before production: move PIN verification to a Supabase Edge Function that
 * returns a signed JWT, and tighten RLS policies to use jwt claims.
 *
 * Session is persisted in localStorage as { employee, signedInAt }.
 */

const STORAGE_KEY = 'hma-tracker:session';

const AuthContext = createContext(null);

// --- bcrypt-style PIN check ---------------------------------------------
// Browser-only check uses the Web Crypto API + a small bcrypt-js shim.
// Until we wire bcrypt in, this is a placeholder that accepts the default
// dev PIN "1234" for any seeded account. Replace with bcrypt.compare()
// once we add the bcryptjs dep.
const DEV_PIN = '1234';

async function verifyPin(pin, pinHash) {
  // TODO: replace with bcrypt.compareSync(pin, pinHash) once bcryptjs is added.
  if (import.meta.env.DEV && pin === DEV_PIN) return true;
  return pin === DEV_PIN; // temporary
}

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
      const { data, error } = await supabase
        .from('employees')
        .select('id, employee_number, name, role, pin_hash, active, notification_time, notification_enabled')
        .eq('employee_number', employeeNumber.trim())
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) throw new Error('Employee not found');
      if (!data.active) throw new Error('This account is inactive');

      const ok = await verifyPin(pin, data.pin_hash);
      if (!ok) throw new Error('Incorrect PIN');

      const { pin_hash, ...employee } = data;
      const next = { employee, signedInAt: new Date().toISOString() };
      setSession(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  const value = {
    session,
    employee: session?.employee ?? null,
    role: session?.employee?.role ?? null,
    isAdmin: session?.employee?.role === 'admin',
    isEmployee: session?.employee?.role === 'employee',
    loading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
