import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import SetPin from './pages/SetPin.jsx';
import EmployeeShell from './pages/EmployeeShell.jsx';
import EmployeeToday from './pages/EmployeeToday.jsx';
import EmployeeSettings from './pages/EmployeeSettings.jsx';
import AdminShell from './pages/AdminShell.jsx';
import AdminEmployees from './pages/AdminEmployees.jsx';
import AdminEmployeeDetail from './pages/AdminEmployeeDetail.jsx';
import AdminPainQueue from './pages/AdminPainQueue.jsx';
import './styles/app.css';

function RequireAuth({ children, role }) {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  // A temp PIN must be replaced before anything else is reachable.
  if (mustChangePin) return <Navigate to="/set-pin" replace />;
  if (role && employee.role !== role) {
    return <Navigate to={employee.role === 'admin' ? '/admin' : '/'} replace />;
  }
  return children;
}

function RequirePinChange({ children }) {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  // Already set a real PIN — no reason to be here.
  if (!mustChangePin) {
    return <Navigate to={employee.role === 'admin' ? '/admin' : '/today'} replace />;
  }
  return children;
}

function RootRedirect() {
  const { employee, mustChangePin } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  if (mustChangePin) return <Navigate to="/set-pin" replace />;
  return <Navigate to={employee.role === 'admin' ? '/admin' : '/today'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
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

      <Route
        path="/admin"
        element={
          <RequireAuth role="admin">
            <AdminShell>
              <AdminEmployees />
            </AdminShell>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/employee/:id"
        element={
          <RequireAuth role="admin">
            <AdminShell>
              <AdminEmployeeDetail />
            </AdminShell>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/pain"
        element={
          <RequireAuth role="admin">
            <AdminShell>
              <AdminPainQueue />
            </AdminShell>
          </RequireAuth>
        }
      />

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
