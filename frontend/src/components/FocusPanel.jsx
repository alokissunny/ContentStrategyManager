import React from 'react';
import Glyph from './Glyph';
import { LS_BORDER, LS_SURFACE, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_SOFT_BORDER, LS_FONT } from '../theme';

function Divider() {
  return <div style={{ height: 1, background: LS_BORDER, margin: '20px 0' }} />;
}

function SectionLabel({ icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
      <Glyph name={icon} size={13} color={LS_MUTED} />
      <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: LS_MUTED }}>
        {children}
      </span>
    </div>
  );
}

function RealityItem({ dot, title, text, last }) {
  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: last ? 0 : 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        {!last && <span style={{ width: 1, flex: 1, background: LS_BORDER, marginTop: 6 }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 4 }}>
        <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 13.5, color: LS_INK, marginBottom: 3 }}>{title}</div>
        <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_T2, margin: 0, lineHeight: 1.45 }}>{text}</p>
      </div>
    </div>
  );
}

export default function FocusPanel({ focusLabel, focusIcon, tagline, whyText, realityItems, brandDnaComplete, brandDnaTotal }) {
  return (
    <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: '24px 24px 26px', position: 'relative' }}>
      <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 19, color: LS_INK, lineHeight: 1.3, marginBottom: 18 }}>
        This week, reinforce {focusLabel}.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: LS_SOFT, border: `1px solid ${LS_SOFT_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Glyph name={focusIcon} size={19} color={LS_SIGNAL} strokeWidth={1.8} />
        </span>
        <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 22, color: LS_INK }}>{focusLabel}</span>
      </div>

      <p style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 14.5, color: LS_INK, margin: '0 0 16px' }}>{tagline}</p>

      <SectionLabel icon="info">Why this matters</SectionLabel>
      <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: '-8px 0 0', lineHeight: 1.5 }}>{whyText}</p>

      <Divider />

      <SectionLabel icon="footprints">Reality check</SectionLabel>
      <div>
        {realityItems.map((it, i) => (
          <RealityItem key={it.title} dot={it.dot} title={it.title} text={it.text} last={i === realityItems.length - 1} />
        ))}
      </div>

      <Divider />

      <SectionLabel icon="brain">What WideSignals has learned</SectionLabel>
      <div style={{ display: 'flex', gap: 10 }}>
        <Glyph name="fingerprint" size={16} color={LS_SIGNAL} style={{ marginTop: 1, flexShrink: 0 }} />
        <p style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_T2, margin: 0, lineHeight: 1.5 }}>
          Your Brand DNA is {brandDnaComplete} of {brandDnaTotal} sections complete. The more you fill in, the sharper your weekly route gets.
        </p>
      </div>

      <button
        aria-label="Expand"
        style={{
          position: 'absolute', left: '50%', bottom: -16, transform: 'translateX(-50%)', width: 32, height: 32, borderRadius: '50%',
          border: `1px solid ${LS_BORDER}`, background: LS_SURFACE, cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', boxShadow: '0 2px 6px rgba(17,24,39,0.08)',
        }}
      >
        <Glyph name="chevron-down" size={16} color={LS_T2} />
      </button>
    </div>
  );
}
