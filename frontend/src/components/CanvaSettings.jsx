import React, { useEffect, useState } from 'react';
import Icon from '../brand/Icon';
import { useFeatureFlags, setCanvaEnabled } from '../lib/featureFlags';
import { getCanvaStatus, startCanvaConnect, disconnectCanva } from '../api/settings';

// Settings › Experimental features › Design in Canva: the flag, and the
// studio's own Canva link (Canva's MCP server designs into that account).
export default function CanvaSettings() {
  const { canva: enabled } = useFeatureFlags();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    getCanvaStatus().then((s) => { if (live) setStatus(s); }).catch(() => { if (live) setStatus({ connected: false }); });
    return () => { live = false; };
  }, [enabled]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const { url, state } = await startCanvaConnect();
      try { sessionStorage.setItem('canva_oauth_state', state); } catch { /* the callback will ask to retry */ }
      window.location.assign(url);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start the Canva connection.');
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError('');
    try { setStatus(await disconnectCanva()); } catch (err) { setError(err.response?.data?.message || 'Could not disconnect Canva.'); }
    setBusy(false);
  };

  const connected = Boolean(status?.connected);
  return (
    <div className="set-row">
      <span className="set-row__ico"><Icon name="swatch" size={19} /></span>
      <span className="set-row__main">
        <b className="set-row__title">Design in Canva</b>
        <span className="set-row__sub">
          {!enabled
            ? 'Off · Canva reimagines the carousel agent’s slides as high-quality posts — your exact words and photos — in your Canva account'
            : connected
              ? 'On · Canva connected — Editor ⋯ › Theme shows “Design in Canva”'
              : 'On · connect your Canva account to use Editor ⋯ › Theme › Design in Canva'}
        </span>
        {error && <span className="set-row__sub" role="alert">{error}</span>}
      </span>
      <span className="set-row__acts">
        {enabled && status && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={connected ? disconnect : connect}>
            {connected ? 'Disconnect' : busy ? 'Opening Canva…' : 'Connect Canva'}
          </button>
        )}
        <button
          type="button"
          className={`set-switch ${enabled ? 'is-on' : ''}`}
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? 'Disable' : 'Enable'} Design in Canva`}
          onClick={() => setCanvaEnabled(!enabled)}
        >
          <i aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
