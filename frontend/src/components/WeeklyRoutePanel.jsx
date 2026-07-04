import React, { useState } from 'react';
import Glyph from './Glyph';
import { LS_BORDER, LS_SURFACE, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT } from '../theme';

const TAG_STYLE = {
  'Build confidence': { bg: LS_SOFT, color: LS_SIGNAL, icon: 'handshake' },
  'Get noticed': { bg: '#EAF6EC', color: '#2E7D32', icon: 'search' },
  'Show expertise': { bg: '#FDF3DA', color: '#92660C', icon: 'shield-check' },
};

const VISIBLE = 4;

export default function WeeklyRoutePanel({ weekLabel, routeExists, days, onCreateRoute }) {
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, days.length - VISIBLE);
  const visible = days.slice(offset, offset + VISIBLE);

  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: '24px 28px 22px', marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_INK, marginBottom: 6 }}>
            Weekly Route
          </div>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: 0 }}>
            What your audience should hear from you each day — and why.
          </p>
        </div>
        <button
          onClick={onCreateRoute}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, height: 42, padding: '0 20px',
            borderRadius: 999, border: 'none', cursor: 'pointer', background: LS_SIGNAL, color: '#fff',
            fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          <Glyph name="sparkles" size={15} color="#fff" />
          Create content route
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 18px' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_INK }}>
          <Glyph name="calendar" size={15} color={LS_T2} />
          {weekLabel}
        </span>
        {!routeExists && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 999,
              background: LS_SOFT, color: LS_SIGNAL, fontFamily: LS_FONT, fontSize: 11.5, fontWeight: 600,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: LS_SIGNAL }} />
            Route not created yet
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${VISIBLE}, 1fr)`, gap: 16 }}>
        {visible.map((d) => {
          const tag = TAG_STYLE[d.tag] || TAG_STYLE['Get noticed'];
          return (
            <div key={d.day} style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 12, padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', minHeight: 240 }}>
              <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 14.5, color: LS_INK, marginBottom: 8 }}>{d.day}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Glyph name="layers" size={13} color={LS_MUTED} />
                <span style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED }}>{d.category}</span>
              </div>
              <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_INK, lineHeight: 1.4, margin: '0 0 14px', flex: 1 }}>{d.action}</p>
              <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: LS_MUTED, marginBottom: 4 }}>
                Why it matters
              </div>
              <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2, margin: '0 0 14px' }}>{d.why}</p>
              <span
                style={{
                  alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
                  borderRadius: 999, background: tag.bg, color: tag.color, fontFamily: LS_FONT, fontSize: 12, fontWeight: 600,
                }}
              >
                <Glyph name={tag.icon} size={12} color={tag.color} strokeWidth={2} />
                {d.tag}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>
          <Glyph name="compass" size={14} color={LS_MUTED} />
          Directions, not finished posts. Open the content route to explore a day.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setOffset((o) => Math.max(0, o - 1))}
            disabled={offset === 0}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: `1px solid ${LS_BORDER}`, background: LS_SURFACE,
              cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Glyph name="chevron-left" size={16} color={LS_INK} />
          </button>
          <button
            onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
            disabled={offset >= maxOffset}
            style={{
              width: 32, height: 32, borderRadius: '50%', border: `1px solid ${LS_BORDER}`, background: LS_SURFACE,
              cursor: offset >= maxOffset ? 'default' : 'pointer', opacity: offset >= maxOffset ? 0.4 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Glyph name="chevron-right" size={16} color={LS_INK} />
          </button>
        </div>
      </div>
    </div>
  );
}
