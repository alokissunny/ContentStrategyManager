import React, { useState } from 'react';
import Glyph from './Glyph';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_FONT, LS_DISPLAY } from '../theme';

// Per-pillar identity — icon (lucide) + the tinted circle it sits in.
const PILLARS = {
  discovery: { label: 'Discovery', icon: 'search', tint: '#E8EEFF', strong: '#3B6FE0' },
  credibility: { label: 'Credibility', icon: 'award', tint: '#FBEFD6', strong: '#C98A1B' },
  trust: { label: 'Trust', icon: 'shield-check', tint: '#DCF3E4', strong: '#2E9E5B' },
};

// verdict word → coloured dot (never colour-only — the word is always shown).
function verdictDot(verdict) {
  const v = (verdict || '').toLowerCase();
  if (v.includes('strong')) return '#2E9E5B';
  if (v.includes('moderate') || v.includes('early')) return '#E39A2B';
  return LS_MUTED;
}

const Label = ({ children }) => (
  <span style={{ display: 'block', fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_MUTED, marginBottom: 6 }}>
    {children}
  </span>
);

const Body = ({ children }) => (
  <p style={{ fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.6, color: LS_T2, margin: 0 }}>{children}</p>
);

function PillarCard({ row }) {
  const p = PILLARS[row.pillar] || PILLARS.discovery;
  return (
    <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, flexShrink: 0, borderRadius: '50%', background: p.tint }}>
          <Glyph name={p.icon} size={16} color={p.strong} />
        </span>
        <b style={{ fontFamily: LS_FONT, fontSize: 16, color: LS_INK }}>{p.label}</b>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 600, color: LS_T2 }}>
          <i style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: verdictDot(row.verdict) }} />
          {row.verdict}
        </span>
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Evidence</Label>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {row.evidence.map((e) => (
            <li key={e} style={{ position: 'relative', paddingLeft: 16, fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.5, color: LS_T2 }}>
              <span style={{ position: 'absolute', left: 3, top: 8, width: 4, height: 4, borderRadius: '50%', background: LS_MUTED }} />
              {e}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Why this matters</Label>
        <Body>{row.whyMatters}</Body>
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Recommendation</Label>
        <Body>{row.recommendation}</Body>
      </div>
    </div>
  );
}

export default function AuthorityFunnel({ data, onStart }) {
  const [starting, setStarting] = useState(false);
  const { week, funnel } = data;
  const focus = PILLARS[week.focus] || PILLARS.discovery;

  function handleStart() {
    setStarting(true);
    onStart();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your authority analysis"
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 'clamp(12px, 4vw, 40px)', background: 'rgba(16,18,23,0.64)', backdropFilter: 'blur(3px)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 'min(680px, 100%)', maxHeight: '90vh', background: LS_SURFACE, borderRadius: 20, boxShadow: '0 24px 60px rgba(16,18,23,0.28)', overflow: 'hidden' }}>
        <div style={{ overflowY: 'auto', padding: 'clamp(24px, 5vw, 40px) clamp(20px, 5vw, 40px) 24px' }}>
          <span style={{ fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: LS_MUTED }}>
            Your analysis is ready
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '16px 0 4px' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 48, height: 48, flexShrink: 0, borderRadius: '50%', background: focus.tint }}>
              <Glyph name={focus.icon} size={24} color={focus.strong} />
            </span>
            <h2 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 'clamp(26px, 4vw, 34px)', letterSpacing: '-0.02em', lineHeight: 1.1, color: LS_INK, margin: 0 }}>
              {week.headline}
            </h2>
          </div>

          {week.observation && (
            <div style={{ marginTop: 24 }}>
              <Label>{week.confidence === 'low' ? "Where you're starting" : "Last week's observation"}</Label>
              <Body>{week.observation}</Body>
            </div>
          )}
          {week.hypothesis && (
            <div style={{ marginTop: 20 }}>
              <Label>This week's hypothesis</Label>
              <Body>{week.hypothesis}</Body>
            </div>
          )}
          <div style={{ marginTop: 20 }}>
            <Label>Why this matters</Label>
            <Body>{week.whyMatters}</Body>
          </div>
          <div style={{ marginTop: 20 }}>
            <Label>This week's recommendation</Label>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {week.recommendation.map((r) => (
                <li key={r.move} style={{ position: 'relative', paddingLeft: 20, fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.5, color: LS_INK }}>
                  <span style={{ position: 'absolute', left: 4, top: 7, width: 6, height: 6, borderRadius: '50%', background: LS_SIGNAL }} />
                  {r.move}
                </li>
              ))}
            </ul>
            {week.note && (
              <p style={{ marginTop: 14, fontFamily: LS_FONT, fontSize: 14, fontStyle: 'italic', color: LS_MUTED, lineHeight: 1.55 }}>{week.note}</p>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
            {funnel.map((row) => (
              <PillarCard key={row.pillar} row={row} />
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: 'clamp(14px, 3vw, 18px) clamp(20px, 5vw, 40px)', borderTop: `1px solid ${LS_BORDER}`, background: LS_SURFACE }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 52,
              borderRadius: 12, border: 'none', cursor: starting ? 'default' : 'pointer', opacity: starting ? 0.7 : 1,
              fontFamily: LS_FONT, fontSize: 15, fontWeight: 700, letterSpacing: '0.02em', background: LS_SIGNAL, color: '#fff',
            }}
          >
            <Glyph name="sparkles" size={17} color="#fff" />
            Start planning my week
            <Glyph name="arrow-right" size={16} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}
