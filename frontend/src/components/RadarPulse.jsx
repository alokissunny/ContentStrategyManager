import React from 'react';
import { LS_BORDER, LS_INK, LS_SIGNAL } from '../theme';

export default function RadarPulse({ size = 168, live }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {live && [0, 1, 2].map((k) => (
        <span
          key={k}
          style={{ position: 'absolute', width: size, height: size, borderRadius: '50%', border: `1.5px solid ${LS_SIGNAL}`, animation: `lsPulse 2.4s ${k * 0.8}s ease-out infinite` }}
        />
      ))}
      <svg width={size} height={size} viewBox="0 0 168 168" fill="none">
        {[28, 52, 76].map((r, i) => <circle key={i} cx="84" cy="84" r={r} stroke={LS_BORDER} strokeWidth="1" />)}
        <line x1="84" y1="8" x2="84" y2="160" stroke={LS_BORDER} strokeWidth="0.8" />
        <line x1="8" y1="84" x2="160" y2="84" stroke={LS_BORDER} strokeWidth="0.8" />
        {[[84, 56], [110, 96], [62, 104], [104, 64]].map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 4.5 : 2.6} fill={LS_SIGNAL} opacity={i === 0 ? 1 : 0.6} />
        ))}
        <circle cx="84" cy="84" r="4" fill={LS_INK} />
      </svg>
    </div>
  );
}
