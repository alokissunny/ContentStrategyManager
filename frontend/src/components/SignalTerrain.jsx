import React from 'react';
import { LS_SIGNAL } from '../theme';

export default function SignalTerrain() {
  const N = 26;
  const cx = 320;
  const cy = 200;
  const spanX = 235;
  const spanY = 70;
  const hScale = 96;

  const g = (u, v, cu, cv, s, a) => a * Math.exp(-((u - cu) ** 2 + (v - cv) ** 2) / (2 * s * s));
  const peak = (u, v) => g(u, v, 0.5, 0.46, 0.2, 1.0) + g(u, v, 0.74, 0.34, 0.13, 0.6) + g(u, v, 0.28, 0.6, 0.12, 0.4);
  const proj = (u, v) => {
    const h = peak(u, v);
    const isoX = u - v;
    const isoY = u + v;
    return [cx + isoX * spanX, cy + isoY * spanY - h * hScale, h];
  };

  const rows = [];
  const cols = [];
  const dots = [];
  for (let j = 0; j <= N; j++) {
    const pr = [];
    for (let i = 0; i <= N; i++) {
      const p = proj(i / N, j / N);
      pr.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
      dots.push(p);
    }
    rows.push(pr.join(' '));
  }
  for (let i = 0; i <= N; i++) {
    const pc = [];
    for (let j = 0; j <= N; j++) {
      const p = proj(i / N, j / N);
      pc.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    cols.push(pc.join(' '));
  }

  const spikes = [
    [0.7, 0.16, 168, true],
    [0.55, 0.3, 86],
    [0.62, 0.26, 60],
    [0.8, 0.4, 70],
    [0.46, 0.4, 54],
    [0.36, 0.34, 44],
    [0.88, 0.56, 50],
    [0.5, 0.56, 40],
    [0.72, 0.5, 36],
  ];
  const tall = proj(0.7, 0.16);

  return (
    <svg
      viewBox="0 0 640 440"
      width="100%"
      height="100%"
      fill="none"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
      style={{ overflow: 'visible', transformOrigin: '50% 60%', animation: 'lsBreathe 9s ease-in-out infinite' }}
    >
      {rows.map((p, i) => <polyline key={'r' + i} points={p} stroke="#cfd3da" strokeWidth="0.6" opacity="0.6" />)}
      {cols.map((p, i) => <polyline key={'c' + i} points={p} stroke="#cfd3da" strokeWidth="0.6" opacity="0.6" />)}
      {dots.map((p, i) => (
        <circle key={'d' + i} cx={p[0]} cy={p[1]} r={p[2] > 0.3 ? 1.3 : 0.9} fill={p[2] > 0.5 ? LS_SIGNAL : '#8b919c'} opacity={p[2] > 0.3 ? 0.8 : 0.5} />
      ))}
      {[0, 1, 2].map((k) => (
        <ellipse key={k} cx={tall[0]} cy={tall[1] - 168} rx={16 + k * 13} ry={(16 + k * 13) * 0.45} stroke={LS_SIGNAL} strokeWidth="1" opacity={0.4 - k * 0.11} fill="none" />
      ))}
      {spikes.map((s, i) => {
        const p = proj(s[0], s[1]);
        const topY = p[1] - s[2];
        return (
          <g key={'s' + i}>
            <line x1={p[0]} y1={p[1]} x2={p[0]} y2={topY} stroke={LS_SIGNAL} strokeWidth={s[3] ? 1.6 : 1.2} opacity={s[3] ? 1 : 0.75} />
            <circle cx={p[0]} cy={topY} r={s[3] ? 5 : 3} fill={LS_SIGNAL} style={{ animation: `lsSpark ${2.6 + i * 0.4}s ease-in-out ${i * 0.3}s infinite` }} />
          </g>
        );
      })}
    </svg>
  );
}
