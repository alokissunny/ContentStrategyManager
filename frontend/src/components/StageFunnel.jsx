import React, { useState } from 'react';
import Glyph from './Glyph';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_BORDER, LS_SURFACE, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_SOFT_BORDER, LS_FONT } from '../theme';

const STATUS_STYLE = {
  improving: { bg: '#EAF6EC', color: '#2E7D32', icon: 'trending-up', label: 'Improving' },
  stable: { bg: '#F3F4F6', color: LS_T2, icon: 'arrow-right', label: 'Stable' },
  attention: { bg: LS_SOFT, color: LS_SIGNAL, icon: 'circle-alert', label: 'Needs attention' },
};

export default function StageFunnel({ stages, focusKey, confidence = 'High confidence' }) {
  const [openKey, setOpenKey] = useState(null);
  const isMobile = useIsMobile();

  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: isMobile ? '20px 18px 22px' : '24px 28px 28px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_INK, marginBottom: 6 }}>
            Signal Terrain
          </div>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: 0, maxWidth: 420 }}>
            The three stages your content moves people through. Tap a stage for the detail.
          </p>
        </div>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, height: 30, padding: '0 12px',
            borderRadius: 999, border: `1px solid ${LS_BORDER}`, fontFamily: LS_FONT, fontSize: 12, fontWeight: 600, color: LS_INK,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2E7D32', flexShrink: 0 }} />
          {confidence}
          <Glyph name="info" size={13} color={LS_MUTED} />
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', marginTop: 36, gap: isMobile ? 8 : 0 }}>
        {stages.map((s, i) => {
          const isFocus = s.key === focusKey;
          const status = STATUS_STYLE[s.status] || STATUS_STYLE.stable;
          const open = openKey === s.key;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: isMobile ? 0 : 30 }}>
                  <Glyph name={isMobile ? 'chevron-down' : 'chevron-right'} size={18} color={LS_MUTED} />
                </div>
              )}
              {isMobile ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '4px 4px' }}>
                  <span
                    style={{
                      width: 52, height: 52, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isFocus ? LS_SOFT : '#F3F4F6', border: isFocus ? `1.5px solid ${LS_SOFT_BORDER}` : '1.5px solid transparent',
                    }}
                  >
                    <Glyph name={s.icon} size={22} color={isFocus ? LS_SIGNAL : LS_INK} strokeWidth={1.6} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isFocus && (
                      <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_SIGNAL, marginBottom: 3 }}>
                        Focus
                      </div>
                    )}
                    <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 15, color: LS_INK, marginBottom: 6 }}>{s.label}</div>
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 999,
                        background: status.bg, color: status.color, fontFamily: LS_FONT, fontSize: 11.5, fontWeight: 600,
                      }}
                    >
                      <Glyph name={status.icon} size={11} color={status.color} strokeWidth={2} />
                      {status.label}
                    </span>
                  </div>
                  <button
                    onClick={() => setOpenKey(open ? null : s.key)}
                    aria-label={`Toggle ${s.label} detail`}
                    style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: '50%', border: `1px solid ${LS_BORDER}`, background: LS_SURFACE,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Glyph
                      name="chevron-down"
                      size={14}
                      color={LS_T2}
                      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
                    />
                  </button>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 8px' }}>
                  <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_SIGNAL, height: 16, marginBottom: 6 }}>
                    {isFocus ? 'Focus' : ''}
                  </span>
                  <span
                    style={{
                      width: 62, height: 62, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isFocus ? LS_SOFT : '#F3F4F6', border: isFocus ? `1.5px solid ${LS_SOFT_BORDER}` : '1.5px solid transparent',
                      marginBottom: 12,
                    }}
                  >
                    <Glyph name={s.icon} size={24} color={isFocus ? LS_SIGNAL : LS_INK} strokeWidth={1.6} />
                  </span>
                  <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 16, color: LS_INK, marginBottom: 10 }}>{s.label}</div>
                  <span
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 999,
                      background: status.bg, color: status.color, fontFamily: LS_FONT, fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <Glyph name={status.icon} size={12} color={status.color} strokeWidth={2} />
                    {status.label}
                  </span>
                  <button
                    onClick={() => setOpenKey(open ? null : s.key)}
                    aria-label={`Toggle ${s.label} detail`}
                    style={{
                      marginTop: 14, width: 26, height: 26, borderRadius: '50%', border: `1px solid ${LS_BORDER}`, background: LS_SURFACE,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Glyph
                      name="chevron-down"
                      size={14}
                      color={LS_T2}
                      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}
                    />
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', marginTop: 4 }}>
        {stages.map((s, i) => {
          const open = openKey === s.key;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && !isMobile && <div style={{ width: 18 }} />}
              <div style={{ flex: 1, overflow: 'hidden', maxHeight: open ? 160 : 0, transition: 'max-height 200ms ease' }}>
                <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2, margin: '10px 4px 0', padding: '12px 14px', background: '#FAFAF9', border: `1px solid ${LS_BORDER}`, borderRadius: 10 }}>
                  {s.detail}
                </p>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
