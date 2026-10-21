import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { finishCanvaConnect } from '../api/settings';

// Canva sends the browser back here after Settings › Experimental features ›
// Connect Canva; the code + state finish the link on the server.
export default function CanvaCallback() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    window.history.replaceState(null, '', window.location.pathname);
    let expected;
    try {
      expected = sessionStorage.getItem('canva_oauth_state');
      sessionStorage.removeItem('canva_oauth_state');
    } catch { /* handled by state validation */ }
    if (!expected || state !== expected) {
      setError('The Canva connection could not be validated. Please try connecting again.');
      return;
    }
    if (params.has('error') || !code) {
      setError('The Canva connection was cancelled or not approved. You can try again from Settings.');
      return;
    }
    finishCanvaConnect(code, state)
      .then(() => navigate('/dashboard/settings', { replace: true }))
      .catch((err) => setError(err.response?.data?.message || 'Could not connect Canva. Please try again.'));
  }, [navigate]);
  return <section className="card">
    <h1>{error ? 'Canva connection incomplete' : 'Connecting Canva…'}</h1>
    {error ? <><p role="alert">{error}</p><Link className="btn btn--ghost" to="/dashboard/settings">Back to Settings</Link></> : <p role="status">Finishing your connection. This may take a moment.</p>}
  </section>;
}
