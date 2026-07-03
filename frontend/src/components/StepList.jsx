import React from 'react';
import Glyph from './Glyph';
import { LS_BG, LS_BORDER, LS_INK, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_SOFT_BORDER, LS_SURFACE, LS_FONT } from '../theme';

export default function StepList({ steps, done }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((s, i) => {
        const isDone = i < done;
        const running = i === done;
        return (
          <div
            key={s.label}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderRadius: 12,
              background: LS_SURFACE, border: `1px solid ${isDone || running ? LS_SOFT_BORDER : LS_BORDER}`,
              boxShadow: running ? `0 0 0 2px ${LS_SOFT_BORDER}` : 'none',
              opacity: isDone || running ? 1 : 0.4, transition: 'all 300ms ease',
            }}
          >
            <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isDone || running ? LS_SOFT : LS_BG }}>
              {isDone ? (
                <Glyph name="check" size={17} color={LS_SIGNAL} strokeWidth={2.5} />
              ) : running ? (
                <Glyph name="loader-circle" size={17} color={LS_SIGNAL} style={{ animation: 'lsSpin 1s linear infinite' }} />
              ) : (
                <Glyph name={s.icon} size={17} color={LS_MUTED} />
              )}
            </span>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 15, color: LS_INK }}>{s.label}</div>
              <div style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, marginTop: 1 }}>{s.note}</div>
            </div>
            {isDone && <span style={{ fontFamily: LS_FONT, fontSize: 12.5, fontWeight: 700, color: LS_SIGNAL, flexShrink: 0 }}>Done</span>}
          </div>
        );
      })}
    </div>
  );
}
