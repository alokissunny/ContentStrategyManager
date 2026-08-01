/*
 * ConnectMetaModal — prompt when the user tries to Publish without a Meta link.
 */

import React, { useState } from 'react';
import Glyph from './Glyph';
import { startMetaConnect } from '../api/meta';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT,
  LS_FONT, LS_DISPLAY,
} from '../theme';

const REQUIREMENTS = [
  'An Instagram Professional account (Business or Creator)',
  'A Facebook Page linked to that Instagram account',
  'Permission for Bauhly to publish on your behalf',
];

export default function ConnectMetaModal({ configured, onClose, onConnected, onMarkManually }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleConnect() {
    setBusy(true);
    setError('');
    try {
      const { url, state } = await startMetaConnect();
      if (state) sessionStorage.setItem('meta_oauth_state', state);
      if (url) {
        window.location.href = url;
        return;
      }
      setError('Meta connect did not return a login URL.');
    } catch (err) {
      setError(
        err.response?.data?.message ||
          'Meta publishing is not available yet. You can still mark posts as published manually.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect Meta to publish"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110, display: 'grid', placeItems: 'center',
        padding: 'clamp(12px, 4vw, 40px)', background: 'rgba(16,18,23,0.64)', backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)', background: LS_SURFACE, borderRadius: 20,
          boxShadow: '0 24px 60px rgba(16,18,23,0.28)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '28px 28px 8px' }}>
          <span style={{
            display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 14,
            background: LS_SOFT, color: LS_SIGNAL, marginBottom: 16,
          }}>
            <Glyph name="instagram" size={24} />
          </span>
          <h2 style={{
            fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 22, color: LS_INK, margin: '0 0 8px',
          }}>
            Connect Meta to publish
          </h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.55, color: LS_T2, margin: 0 }}>
            Bauhly can post this carousel straight to Instagram once you connect your Professional account through Meta.
          </p>

          <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {REQUIREMENTS.map((r) => (
              <li key={r} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', fontFamily: LS_FONT,
                fontSize: 13.5, lineHeight: 1.45, color: LS_INK,
              }}>
                <Glyph name="check" size={16} color={LS_SIGNAL} style={{ flexShrink: 0, marginTop: 2 }} />
                {r}
              </li>
            ))}
          </ul>

          {error && (
            <p style={{
              marginTop: 16, fontFamily: LS_FONT, fontSize: 13.5, lineHeight: 1.5,
              color: 'var(--negative, #d92d20)', background: 'var(--negative-soft, #feefec)',
              borderRadius: 10, padding: '10px 12px',
            }}>
              {error}
            </p>
          )}

          {!configured && !error && (
            <p style={{
              marginTop: 16, fontFamily: LS_FONT, fontSize: 13, lineHeight: 1.5, color: LS_MUTED,
            }}>
              Meta App credentials aren’t on this server yet. You can still track posts as published for now.
            </p>
          )}
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '20px 28px 28px',
        }}>
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              height: 48, borderRadius: 12, border: 'none', cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.7 : 1, fontFamily: LS_FONT, fontSize: 14.5, fontWeight: 700,
              background: LS_SIGNAL, color: '#fff',
            }}
          >
            <Glyph name="link" size={16} color="#fff" />
            {busy ? 'Connecting…' : 'Connect with Meta'}
          </button>
          {onMarkManually && (
            <button
              type="button"
              onClick={onMarkManually}
              style={{
                height: 44, borderRadius: 12, border: `1px solid ${LS_BORDER}`, background: LS_SURFACE,
                cursor: 'pointer', fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_INK,
              }}
            >
              Mark as published without posting
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 40, border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_MUTED,
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
