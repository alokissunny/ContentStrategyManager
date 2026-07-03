import React from 'react';
import { LS_SIGNAL } from '../theme';

export default function PanelMotif() {
  const N = 18;
  const cx = 200;
  const cy = 130;
  const sx = 150;
  const sy = 44;
  const hs = 70;

  const g = (u, v, cu, cv, s, a) => a * Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (2 * s * s));
  const peak = (u, v) => g(u, v, 0.54, 0.42, 0.2, 1) + g(u, v, 0.76, 0.3, 0.13, 0.5);
  const proj = (u, v) => {
    const z = peak(u, v);
    return [cx + (u - v) * sx, cy + (u + v) * sy - z * hs, z];
  };

  const rows = [];
  const cols = [];
  const dots = [];
  for (let j = 0; j <= N; j++) {
    const p = [];
    for (let i = 0; i <= N; i++) {
      const q = proj(i / N, j / N);
      p.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
      dots.push(q);
    }
    rows.push(p.join(' '));
  }
  for (let i = 0; i <= N; i++) {
    const p = [];
    for (let j = 0; j <= N; j++) {
      const q = proj(i / N, j / N);
      p.push(q[0].toFixed(1) + ',' + q[1].toFixed(1));
    }
    cols.push(p.join(' '));
  }

  const spikes = [
    [0.66, 0.2, 110, true],
    [0.5, 0.34, 56],
    [0.8, 0.44, 46],
    [0.38, 0.4, 38],
  ];
  const tall = proj(0.66, 0.2);

  return (
    <svg viewBox="0 0 400 300" width="100%" height="260" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      {rows.map((p, i) => <polyline key={'r' + i} points={p} stroke="#d3d6dd" strokeWidth="0.6" opacity="0.6" />)}
      {cols.map((p, i) => <polyline key={'c' + i} points={p} stroke="#d3d6dd" strokeWidth="0.6" opacity="0.6" />)}
      {dots.map((p, i) => (
        <circle
          key={'d' + i}
          cx={p[0]}
          cy={p[1]}
          r={p[2] > 0.4 ? 1.3 : 0.8}
          fill={p[2] > 0.55 ? LS_SIGNAL : '#9aa1ac'}
          opacity={p[2] > 0.4 ? 0.85 : 0.45}
          style={{ animation: i % 7 === 0 ? `lsSpark ${2.6 + (i % 5) * 0.4}s ease-in-out ${(i % 6) * 0.3}s infinite` : 'none' }}
        />
      ))}
      {[0, 1, 2].map((k) => (
        <ellipse key={k} cx={tall[0]} cy={tall[1] - 110} rx={12 + k * 11} ry={(12 + k * 11) * 0.45} stroke={LS_SIGNAL} strokeWidth="1" opacity={0.38 - k * 0.11} />
      ))}
      {spikes.map((s, i) => {
        const p = proj(s[0], s[1]);
        const ty = p[1] - s[2];
        return (
          <g key={i}>
            <line x1={p[0]} y1={p[1]} x2={p[0]} y2={ty} stroke={LS_SIGNAL} strokeWidth={s[3] ? 1.6 : 1.2} opacity={s[3] ? 1 : 0.7} />
            <circle cx={p[0]} cy={ty} r={s[3] ? 4.5 : 3} fill={LS_SIGNAL} style={{ animation: `lsSpark ${2.8 + i * 0.3}s ease-in-out ${i * 0.25}s infinite` }} />
          </g>
        );
      })}
    </svg>
  );
}
