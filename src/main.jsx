import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { captureQrFragment } from './lib/qr/fragment.js';
import './styles/theme.css';

// Must run before the router reads the URL: lifts a scanned key/plan out of the
// fragment, strips it from the address bar, and lands on /pair or /plan.
captureQrFragment();

// "/cadence" in the admin build, which the suite serves there; "" on the phone.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

function render() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter basename={basename}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

// The admin build's data lives in the suite (owner, 2026-10-07). It is fetched
// BEFORE the first render, so no screen shows this browser's copy and then
// swaps. `__ADMIN_BUILD__` is a compile-time constant: in the client build this
// branch is dead code and the import is never resolved, so the employee's app
// does not contain the suite's store at all (test/clientBuild.test.js).
if (__ADMIN_BUILD__) {
  import('./lib/data/suiteStore.js')
    .then(({ hydrateFromSuite }) => hydrateFromSuite())
    .then(render, (error) => {
      // Never render on this browser's copy alone: every change would then stay
      // here, and the suite would not know. Say so instead.
      console.error(error);
      document.getElementById('root').textContent =
        'Cadence-Admin could not load its data from the suite. Reload the page.';
    });
} else {
  render();
}
