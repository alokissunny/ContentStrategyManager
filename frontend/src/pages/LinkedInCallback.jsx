import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { useFeatureFlags } from '../lib/featureFlags';

export default function LinkedInCallback() {
  const navigate = useNavigate();
  const { linkedin: enabled } = useFeatureFlags();
  const started = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) {
      try { sessionStorage.removeItem('linkedin_oauth_state'); } catch { /* unavailable storage */ }
      navigate('/dashboard/settings', { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    window.history.replaceState(null, '', window.location.pathname);
    let expected;
    try {
      expected = sessionStorage.getItem('linkedin_oauth_state');
      sessionStorage.removeItem('linkedin_oauth_state');
    } catch { /* handled by state validation */ }
    if (!expected || state !== expected) {
      setError('LinkedIn connection could not be validated. Please try connecting again.');
      return;
    }
    if (params.has('error') || !code) {
      setError('LinkedIn connection was cancelled or not approved. You can try again from Settings.');
      return;
    }
    client.post('/linkedin/callback', { code, state })
      .then(() => navigate('/dashboard/settings', { replace: true }))
      .catch((err) => setError(err.response?.data?.message || 'Could not connect LinkedIn. Please try again.'));
  }, [navigate, enabled]);
  return <section className="card">
    <h1>{error ? 'LinkedIn connection incomplete' : 'Connecting LinkedIn…'}</h1>
    {error ? <><p role="alert">{error}</p><Link className="btn btn--ghost" to="/dashboard/settings">Back to Settings</Link></> : <p role="status">Finishing your connection. This may take a moment.</p>}
  </section>;
}
