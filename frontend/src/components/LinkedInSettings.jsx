import React, { useEffect, useState } from 'react';
import client from '../api/client';
import LinkedInPublisher from './LinkedInPublisher';

export default function LinkedInSettings() {
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    client.get('/linkedin/status').then(({ data }) => setConnection(data))
      .catch(() => setError('Could not load your LinkedIn connection. Please retry.'));
  };
  useEffect(load, []);

  async function act(disconnect = false) {
    setBusy(true);
    setError('');
    try {
      if (disconnect) {
        const { data } = await client.delete('/linkedin/connection');
        setConnection(data);
      } else {
        const { data } = await client.post('/linkedin/connect');
        sessionStorage.setItem('linkedin_oauth_state', data.state);
        window.location.assign(data.url);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update your LinkedIn connection. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <section className="card set-card" aria-labelledby="linkedin-heading">
      <h2 id="linkedin-heading">LinkedIn <span className="set-row__badge">Experimental</span></h2>
      <p className="set-card__sub">Connect LinkedIn to publish text posts as a company page you manage.</p>
      <div className="set-row">
        <span className="set-row__ico" aria-hidden="true"><b>in</b></span>
        <span className="set-row__main">
          <b className="set-row__title">{connection?.connected ? connection.name : 'Company pages'}</b>
          <span className={`set-row__sub ${connection?.connected ? 'is-good' : ''}`} role="status">
            {!connection ? (error ? 'Connection unavailable' : 'Loading…') : connection.needsReconnect ? 'Reconnect to enable company-page publishing' : connection.connected ? 'Company-page access connected' : connection.configured ? 'Not connected' : 'Awaiting LinkedIn app setup'}
          </span>
        </span>
        <span className="set-row__acts">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => act(connection.connected && !connection.needsReconnect)}
            disabled={busy || !connection || (!connection.configured && (!connection.connected || connection.needsReconnect))}>
            {busy ? 'Please wait…' : connection?.needsReconnect ? 'Reconnect LinkedIn' : connection?.connected ? 'Disconnect' : 'Connect to LinkedIn'}
          </button>
          {connection?.connected && <button type="button" className="btn btn--ghost btn--sm" disabled={busy || (!connection.needsReconnect && !connection.configured)}
            onClick={() => act(connection.needsReconnect)}>{connection.needsReconnect ? 'Disconnect' : 'Reconnect'}</button>}
        </span>
      </div>
      {connection?.canPublish && <LinkedInPublisher expanded />}
      {error && <p className="set-err" role="alert">{error} {!connection && <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Retry</button>}</p>}
      <p className="set-card__note">Company-page publishing requires LinkedIn Community Management API approval. Disconnecting removes the saved authorization from Bauhly; existing posts stay on LinkedIn. You can revoke access in LinkedIn’s permitted services settings.</p>
    </section>
  );
}
