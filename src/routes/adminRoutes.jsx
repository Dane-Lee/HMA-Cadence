/**
 * The admin half of the router. Present only in the admin build.
 *
 * This file is reached through the `#admin-routes` alias, which `vite.config.js`
 * points at `adminRoutes.none.jsx` for the client build. That indirection is the
 * whole mechanism, and it is deliberate: the plan requires admin routes excluded
 * **at compile time**, not hidden behind a runtime role check, because the
 * employee's phone must not physically contain the admin pages.
 *
 * A runtime check would leave `AdminIssuePlan` in the bundle, and with it
 * `buildPlanQr()` -- which mints plan keys. The comment in `planQr.js` is
 * explicit that key minting must run on the admin's own machine and never on a
 * server; shipping that code to every employee's phone is the same mistake in a
 * different direction. Aliasing means the client build never resolves the file
 * at all, so there is nothing for a bundler to fail to tree-shake.
 *
 * Exported as an array rather than a component because `<Routes>` reads its
 * children to build the route table and a wrapper component would hide them.
 */
import { Navigate, Route } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import AdminShell from '../pages/AdminShell.jsx';
import AdminEmployees from '../pages/AdminEmployees.jsx';
import AdminEmployeeDetail from '../pages/AdminEmployeeDetail.jsx';
import AdminPainQueue from '../pages/AdminPainQueue.jsx';
import AdminImportPlan from '../pages/AdminImportPlan.jsx';
import AdminIssuePlan from '../pages/AdminIssuePlan.jsx';
import AdminReturns from '../pages/AdminReturns.jsx';

function RequireAdmin({ children }) {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  if (mustChangePin) return <Navigate to="/set-pin" replace />;
  if (employee.role !== 'admin') return <Navigate to="/today" replace />;
  return children;
}

const page = (element) => (
  <RequireAdmin>
    <AdminShell>{element}</AdminShell>
  </RequireAdmin>
);

const adminRoutes = [
  <Route key="admin" path="/admin" element={page(<AdminEmployees />)} />,
  <Route key="admin-employee" path="/admin/employee/:id" element={page(<AdminEmployeeDetail />)} />,
  <Route key="admin-pain" path="/admin/pain" element={page(<AdminPainQueue />)} />,
  <Route key="admin-import" path="/admin/import" element={page(<AdminImportPlan />)} />,
  <Route key="admin-issue" path="/admin/issue" element={page(<AdminIssuePlan />)} />,
  <Route key="admin-returns" path="/admin/returns" element={page(<AdminReturns />)} />,
];

export default adminRoutes;
