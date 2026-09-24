/*
 * Instagram Login OAuth redirect target — completes Connect Instagram, then
 * stops on a confirmation screen listing the connected account(s) and the
 * permissions Instagram granted (App Review needs this end-of-flow step).
 * Production: https://bauhly.com/dashboard/meta/callback
 * (also whitelist https://www.bauhly.com/dashboard/meta/callback in Instagram Business login settings).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Glyph from '../components/Glyph';
import {
  completeMetaConnect,
  isMetaConnectedFor,
  metaPermissionFor,
  META_PERMISSIONS,
  storeMetaOAuthResult,
  takeMetaOAuthReturn,
} from '../api/meta';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT, LS_DISPLAY, LSC } from '../theme';

const ACCOUNT_TYPE_LABEL = { BUSINESS: 'Business account', MEDIA_CREATOR: 'Creator account' };

export default function MetaCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const err = params.get('error_description') || params.get('error');
    if (err) {
      setError(err);
      return;
    }
    if (!code) {
      setError('Missing authorization code from Instagram.');
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
        setDone(status);
      })
      .catch((e) => {
        sessionStorage.removeItem(usedKey);
        setError(e.response?.data?.message || 'Could not finish connecting Instagram.');
      });
  }, [params, navigate]);

  return (
    <div style={{ ...LSC, padding: '80px 24px', maxWidth: 520, textAlign: done ? 'left' : 'center' }}>
      <div style={{
        background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: 32,
      }}>
        {done ? (
          <ConnectedSummary
            status={done}
            onContinue={() => navigate('/dashboard', { replace: true, state: { metaOAuth: true } })}
          />
        ) : error ? (
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
              Back to calendar
            </button>
          </>
        ) : (
          <>
            <Glyph name="loader" size={28} color={LS_SIGNAL} />
            <h1 style={{ fontFamily: LS_DISPLAY, fontSize: 22, color: LS_INK, margin: '12px 0 8px' }}>
              Connecting Instagram…
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

function ConnectedSummary({ status, onContinue }) {
  const connections = status.connections || [];
  const current = connections.find((c) => c.igUserId === status.justConnected) || connections[0];
  const others = connections.filter((c) => c !== current);
  const granted = current?.scopes?.length ? current.scopes : META_PERMISSIONS.map((p) => p.scope);

  return (
    <>
      <span style={{
        display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 14,
        background: LS_SOFT, color: LS_SIGNAL, marginBottom: 16,
      }}>
        <Glyph name="circle-check" size={24} />
      </span>
      <h1 style={{ fontFamily: LS_DISPLAY, fontSize: 24, color: LS_INK, margin: '0 0 6px' }}>
        Instagram connected
      </h1>
      <p style={{ fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.5, color: LS_T2, margin: '0 0 20px' }}>
        You gave Bauhly access to this account. Here&rsquo;s what was granted.
      </p>

      {current && <AccountRow conn={current} />}

      <p style={{
        fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: LS_MUTED, margin: '22px 0 10px',
      }}>
        Permissions granted
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {granted.map((scope) => {
          const p = metaPermissionFor(scope);
          return (
            <li key={scope} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Glyph name="check" size={16} color={LS_SIGNAL} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontFamily: LS_FONT, fontSize: 13.5, lineHeight: 1.45, color: LS_INK }}>
                <strong>{p.label}</strong>
                <code style={{ display: 'block', fontSize: 11, color: LS_MUTED }}>{scope}</code>
              </div>
            </li>
          );
        })}
      </ul>

      {others.length > 0 && (
        <>
          <p style={{
            fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: LS_MUTED, margin: '22px 0 10px',
          }}>
            Also connected
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {others.map((c) => <AccountRow key={c.igUserId} conn={c} />)}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onContinue}
        style={{
          width: '100%', marginTop: 24, height: 48, borderRadius: 12, border: 'none',
          background: LS_SIGNAL, color: '#fff', fontFamily: LS_FONT, fontSize: 14.5, fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Continue to Bauhly
      </button>
    </>
  );
}

function AccountRow({ conn }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: 12,
      border: `1px solid ${LS_BORDER}`, borderRadius: 12,
    }}>
      {conn.profilePictureUrl ? (
        <img
          src={conn.profilePictureUrl}
          alt=""
          width={40}
          height={40}
          style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <span style={{
          display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%',
          background: LS_SOFT, color: LS_SIGNAL, flexShrink: 0,
        }}>
          <Glyph name="instagram" size={20} />
        </span>
      )}
      <div style={{ fontFamily: LS_FONT, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: LS_INK }}>@{conn.igUsername}</div>
        <div style={{ fontSize: 12.5, color: LS_T2 }}>
          {ACCOUNT_TYPE_LABEL[conn.accountType] || 'Instagram Professional account'}
        </div>
      </div>
    </div>
  );
}
