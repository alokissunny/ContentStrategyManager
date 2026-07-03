import React from 'react';
import { LS_INK, LS_SIGNAL } from '../theme';

export function IcoRings({ size = 30, color = LS_INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="13" stroke={color} strokeWidth="1.3" opacity="0.35" />
      <circle cx="15" cy="15" r="8" stroke={color} strokeWidth="1.3" opacity="0.6" />
      <circle cx="15" cy="15" r="3" fill={LS_SIGNAL} />
    </svg>
  );
}

export function IcoRising({ size = 30, color = LS_INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 24" fill="none">
      <polyline points="2,20 11,12 17,15 30,3" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="30" cy="3" r="2.6" fill={LS_SIGNAL} />
    </svg>
  );
}

export function IcoBars({ size = 30, color = LS_INK, accent = true }) {
  const xs = [3, 8, 13, 18, 23];
  const tops = [13, 7, 2, 9, 5];
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      {xs.map((x, i) => (
        <line key={i} x1={x} y1={tops[i]} x2={x} y2="23" stroke={accent && i === 2 ? LS_SIGNAL : color} strokeWidth="1.5" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function IcoBrackets({ size = 30, color = LS_INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M3 9 V3 H9 M19 3 H25 V9 M25 19 V25 H19 M9 25 H3 V19" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="14" r="2.6" fill={LS_SIGNAL} />
    </svg>
  );
}

export function IcoNode({ size = 30, color = LS_INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 24" fill="none">
      <path d="M3 20 C 10 20, 12 6, 20 6" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="3" cy="20" r="2.4" fill={color} />
      <circle cx="24" cy="5" r="3" fill={LS_SIGNAL} />
    </svg>
  );
}

export function IcoTarget({ size = 30, color = LS_INK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="11" stroke={color} strokeWidth="1.3" opacity="0.5" />
      <line x1="15" y1="0" x2="15" y2="5" stroke={color} strokeWidth="1.3" />
      <line x1="15" y1="25" x2="15" y2="30" stroke={color} strokeWidth="1.3" />
      <line x1="0" y1="15" x2="5" y2="15" stroke={color} strokeWidth="1.3" />
      <line x1="25" y1="15" x2="30" y2="15" stroke={color} strokeWidth="1.3" />
      <circle cx="15" cy="15" r="3" fill={LS_SIGNAL} />
    </svg>
  );
}
