import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import EmployeeShell from './pages/EmployeeShell.jsx';
import EmployeeToday from './pages/EmployeeToday.jsx';
import AdminShell from './pages/AdminShell.jsx';
import AdminEmployees from './pages/AdminEmployees.jsx';
import AdminPainQueue from './pages/AdminPainQueue.jsx';
import './styles/app.css';

function RequireAuth({ children, role }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  if (role && employee.role !== role) {
    return <Navigate to={employee.role === 'admin' ? '/admin' : '/'} replace />;
  }
  return children;
}

function RootRedirect() {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/login" replace />;
  return <Navigate to={employee.role === 'admin' ? '/admin' : '/today'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />

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
