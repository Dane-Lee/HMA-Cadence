import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import SetPin from './pages/SetPin.jsx';
import EmployeeShell from './pages/EmployeeShell.jsx';
import EmployeeToday from './pages/EmployeeToday.jsx';
import EmployeeSettings from './pages/EmployeeSettings.jsx';
import PairDevice from './pages/PairDevice.jsx';
import ScanPlan from './pages/ScanPlan.jsx';
import ScanCode from './pages/ScanCode.jsx';
// Resolved by vite.config.js: the real admin router in the admin build, an empty
// array in the client build. Admin pages must not be imported anywhere else in
// this file -- a direct import would put them back in the employee's bundle and
// defeat the split. `test/clientBuild.test.js` asserts that.
import adminRoutes from '#admin-routes';
import PageTransition from './components/PageTransition.jsx';
import './styles/app.css';

/** Where a signed-in employee belongs when they land somewhere they should not.
 *
 * In the admin build an admin goes to `/admin`. In the client build that route
 * does not exist, so everyone goes to `/today` -- redirecting to a route the
 * bundle has never heard of would bounce off the catch-all and back again. */
function homeFor(employee) {
  if (__ADMIN_BUILD__ && employee?.role === 'admin') return '/admin';
  return '/today';
}

function RequireAuth({ children, role }) {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  // A temp PIN must be replaced before anything else is reachable.
  if (mustChangePin) return <Navigate to="/set-pin" replace />;
  if (role && employee.role !== role) {
    return <Navigate to={homeFor(employee)} replace />;
  }
  return children;
}

function RequirePinChange({ children }) {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  // Already set a real PIN — no reason to be here.
  if (!mustChangePin) {
    return <Navigate to={homeFor(employee)} replace />;
  }
  return children;
}

function RootRedirect() {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  if (mustChangePin) return <Navigate to="/set-pin" replace />;
  return <Navigate to={homeFor(employee)} replace />;
}

export default function App() {
  return (
    <PageTransition>
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />

      {/* QR entry points. Public: an employee scanning their first sheet has no
          account yet — the receiver creates it when the plan is applied. */}
      <Route path="/pair" element={<PairDevice />} />
      <Route path="/plan" element={<ScanPlan />} />
      {/* In-app scanner. Public for the same reason as /pair and /plan: on iOS a
          Home Screen install cannot see a code scanned by the phone's camera, so
          this is the only way in for an installed app, account or not. */}
      <Route path="/scan" element={<ScanCode />} />
      <Route
        path="/set-pin"
        element={
          <RequirePinChange>
            <SetPin />
          </RequirePinChange>
        }
      />

      <Route
        path="/today"
        element={
          <RequireAuth role="employee">
            <EmployeeShell>
              <EmployeeToday />
            </EmployeeShell>
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth role="employee">
            <EmployeeShell>
              <EmployeeSettings />
            </EmployeeShell>
          </RequireAuth>
        }
      />

      {adminRoutes}

      <Route path="*" element={<RootRedirect />} />
    </Routes>
    </PageTransition>
  );
}
