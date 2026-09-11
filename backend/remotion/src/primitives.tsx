import React from 'react';
import { interpolate, Easing } from 'remotion';
import type { Brand, IllustrationElement } from './schema';

// Illustration coordinates are percentages of a 100×100 viewBox.
export const VB = 100;

function colorOf(brand: Brand, token: string): string {
  switch (token) {
    case 'accent': return brand.accent;
    case 'muted': return brand.muted;
    case 'bg': return brand.bg;
    case 'hairline': return brand.hairline;
    case 'ink': return brand.ink;
    default: return 'none';
  }
}

// 0 → 1 progress for a stroke that "draws on" over drawFrames, starting at appearAt.
function progress(local: number, appearAt: number, drawFrames: number): number {
  if (drawFrames <= 0) return local >= appearAt ? 1 : 0;
  return interpolate(local, [appearAt, appearAt + drawFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

// pathLength normalisation: set pathLength=100 so dash math is geometry-independent.
function drawProps(p: number) {
  return {
    pathLength: 100,
    strokeDasharray: 100,
    strokeDashoffset: 100 - p * 100,
  } as const;
}

export const Primitive: React.FC<{
  el: IllustrationElement;
  brand: Brand;
  local: number; // frames since the illustration beat
}> = ({ el, brand, local }) => {
  const p = progress(local, el.appearAt, el.drawFrames);
  if (p <= 0) return null;

  const stroke = colorOf(brand, el.stroke);
  const fill = colorOf(brand, el.fill);
  const sw = el.strokeWidth;
  // fills fade in on the same envelope; strokes draw on.
  const fillOpacity = fill === 'none' ? 0 : p;

  switch (el.type) {
    case 'rect': {
      const { x, y, w, h, radius } = el;
      // Draw the border as a path so the "draw-on" reads as a pen outline.
      const path = `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
      return (
        <>
          {fill !== 'none' && (
            <rect x={x} y={y} width={w} height={h} rx={radius} fill={fill} opacity={fillOpacity} />
          )}
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
            {...drawProps(p)}
          />
        </>
      );
    }
    case 'line':
      return (
        <line
          x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2}
          stroke={stroke} strokeWidth={sw} strokeLinecap="round"
          {...drawProps(p)}
        />
      );
    case 'polyline': {
      const pts = el.points.map((pt) => pt.join(',')).join(' ');
      return el.closed ? (
        <polygon
          points={pts} fill={fill === 'none' ? 'none' : fill} fillOpacity={fillOpacity}
          stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round"
          {...drawProps(p)}
        />
      ) : (
        <polyline
          points={pts} fill="none"
          stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round"
          {...drawProps(p)}
        />
      );
    }
    case 'dot':
      return <circle cx={el.x} cy={el.y} r={el.r} fill={stroke} opacity={p} />;
    case 'label':
      return (
        <text
          x={el.x} y={el.y}
          fontSize={el.size}
          fontFamily={brand.sans}
          fontWeight={el.weight === 'bold' ? 700 : 400}
          letterSpacing={0.12}
          fill={stroke}
          textAnchor={el.align}
          opacity={p}
        >
          {el.text.toUpperCase()}
        </text>
      );
    case 'leader': {
      const pts = `${el.x1},${el.y1} ${el.x2},${el.y2}`;
      return (
        <>
          <polyline
            points={pts} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round"
            {...drawProps(p)}
          />
          <text
            x={el.x2 + 1.5} y={el.y2 + 0.5}
            fontSize={el.size}
            fontFamily={brand.sans}
            letterSpacing={0.1}
            fill={stroke}
            dominantBaseline="middle"
            opacity={progress(local, el.appearAt + el.drawFrames, 8)}
          >
            {el.text.toUpperCase()}
          </text>
        </>
      );
    }
    default:
      return null;
  }
};
