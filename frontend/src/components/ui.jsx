import React from 'react';
import Glyph from './Glyph';
import { LS_FONT, LS_SIGNAL } from '../theme';

export function Eyebrow({ children, color = LS_SIGNAL, mb = 16, center }) {
  return (
    <p
      style={{
        fontFamily: LS_FONT,
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color,
        margin: `0 0 ${mb}px`,
        textAlign: center ? 'center' : 'left',
      }}
    >
      {children}
    </p>
  );
}

export function SignalBtn({ children, onClick, size = 'md' }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        height: size === 'lg' ? 50 : 42,
        padding: size === 'lg' ? '0 24px' : '0 20px',
        borderRadius: 7,
        border: 'none',
        cursor: 'pointer',
        fontFamily: LS_FONT,
        fontSize: 12.5,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: LS_SIGNAL,
        color: '#fff',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

export function TextLink({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: 'none',
        background: 'none',
        padding: 0,
        cursor: 'pointer',
        fontFamily: LS_FONT,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: LS_SIGNAL,
      }}
    >
      {children} <Glyph name="arrow-right" size={15} color={LS_SIGNAL} />
    </button>
  );
}

export function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
