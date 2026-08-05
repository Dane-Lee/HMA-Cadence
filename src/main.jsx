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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
