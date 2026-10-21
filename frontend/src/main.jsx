import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';
import { IS_NATIVE } from './native/platform';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

function render() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={googleClientId}>
        <BrowserRouter future={{ v7_startTransition: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </GoogleOAuthProvider>
    </React.StrictMode>
  );
}

// The Capacitor app (mobile build) sets up its shell before the first render.
if (IS_NATIVE) {
  import('./native/shell.js').then((shell) => {
    render();
    shell.startNativeShell();
  });
} else {
  render();
}
