/*
 * Meta OAuth redirect target — completes Connect with Meta after Facebook Login.
 * Production: https://bauhly.com/dashboard/meta/callback
 * (also whitelist https://www.bauhly.com/dashboard/meta/callback in the Meta app).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Glyph from '../components/Glyph';
import {
  completeMetaConnect,
  isMetaConnectedFor,
  storeMetaOAuthResult,
  takeMetaOAuthReturn,
} from '../api/meta';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_SIGNAL, LS_FONT, LS_DISPLAY, LSC } from '../theme';

export default function MetaCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error_description') || params.get('error');
    if (err) {
      setError(err);
      return;
    }
    if (!code) {
      setError('Missing authorization code from Meta.');
      return;
    }
    const expected = sessionStorage.getItem('meta_oauth_state');
    if (expected && state && expected !== state) {
      setError('OAuth state mismatch — try connecting again.');
      return;
    }

    const usedKey = `meta_oauth_code_${code}`;
    if (sessionStorage.getItem(usedKey)) return;
    sessionStorage.setItem(usedKey, '1');

    completeMetaConnect(code, state)
      .then((status) => {
        sessionStorage.removeItem('meta_oauth_state');
        const ret = takeMetaOAuthReturn() || {};
        const expectedHandle = ret.expectedHandle || '';
        const matched = expectedHandle
          ? isMetaConnectedFor(status, expectedHandle)
          : Boolean((status.connections || []).length || status.connected);
        storeMetaOAuthResult({
          matched,
          expectedHandle,
          connections: status.connections || [],
          weekId: ret.weekId || null,
          day: ret.day || 0,
        });
        navigate('/dashboard', { replace: true, state: { metaOAuth: true } });
      })
      .catch((e) => {
        sessionStorage.removeItem(usedKey);
        setError(e.response?.data?.message || 'Could not finish connecting Meta.');
      });
  }, [params, navigate]);

  return (
    <div style={{ ...LSC, padding: '80px 24px', maxWidth: 480, textAlign: 'center' }}>
      <div style={{
        background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: 32,
      }}>
        {error ? (
          <>
            <Glyph name="alert-circle" size={28} color={LS_SIGNAL} />
            <h1 style={{ fontFamily: LS_DISPLAY, fontSize: 22, color: LS_INK, margin: '12px 0 8px' }}>
              Connection failed
            </h1>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: '0 0 20px' }}>{error}</p>
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              style={{
                height: 44, padding: '0 20px', borderRadius: 10, border: 'none',
                background: LS_SIGNAL, color: '#fff', fontFamily: LS_FONT, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Back to plans
            </button>
          </>
        ) : (
          <>
            <Glyph name="loader" size={28} color={LS_SIGNAL} />
            <h1 style={{ fontFamily: LS_DISPLAY, fontSize: 22, color: LS_INK, margin: '12px 0 8px' }}>
              Connecting Meta…
            </h1>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, margin: 0 }}>
              Finishing Instagram Professional setup.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
