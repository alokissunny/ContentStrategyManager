/**
 * Explainer drawings (explainer agent, 2026-11-23 — the studio's reference reel DMfntZZNuLH).
 *
 * While the speaker explains a point, the reel cuts to a small animated line drawing on an off-white
 * card: black line-art that draws itself on, a person (or a foot) for scale, a dimension line that
 * extends to the value the speaker says, a zone that fills green (✓) or red (✗), a short callout, and a
 * ✓/✗ badge with a title above. The voice runs on; the captions sit dark in the lower band (80 %).
 *
 * Fixed vocabulary — `measure` (a side section of one fixture), `light` (a person at the counter and a
 * light), `compare` (two columns), `flow` (2–4 steps joined by arrows), `stat` (one number counting up).
 * The geometry is authored here, in a 900 × 900 drawing; the agent only chooses and labels it.
 */
import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
import type { ReelExplainer } from './reelSchema';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const INK = '#1d1d1f';
const PAPER = '#f6f5f2';
const GOOD = '#2fa84f';
const BAD = '#e0403a';
const NEUTRAL = '#c8b48f';
const FLOOR = 800;

const zoneColour = (v: string) => (v === 'good' ? GOOD : v === 'bad' ? BAD : NEUTRAL);
const prog = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { ...clamp, easing: ease });
const circle = (cx: number, cy: number, r: number) => `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`;

/* a stroke that draws itself on (t: 0 → 1) */
const Draw: React.FC<{ d: string; t: number; w?: number; color?: string; fill?: string; dash?: boolean }> = ({ d, t, w = 6, color = INK, fill = 'none', dash = false }) => (
  t <= 0 ? null : (
    <path
      d={d} pathLength={1} fill={fill} stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={dash ? undefined : 1} strokeDashoffset={dash ? undefined : 1 - t} opacity={dash ? t : 1}
    />
  )
);

/* ── figures (facing right) ────────────────────────────────────────────────── */
function standing(fx: number, hand: [number, number]): string[] {
  return [
    circle(fx + 18, 242, 32),
    `M${fx + 8} 274 C${fx - 2} 310 ${fx - 8} 370 ${fx - 6} 430 C${fx - 4} 470 ${fx - 2} 500 ${fx} 522`,
    `M${fx + 30} 276 C${fx + 46} 330 ${fx + 48} 400 ${fx + 38} 466 C${fx + 32} 496 ${fx + 26} 512 ${fx + 22} 524`,
    `M${fx + 22} 524 L${fx + 30} ${FLOOR - 8} L${fx + 72} ${FLOOR}`,
    `M${fx} 522 L${fx - 8} ${FLOOR - 8} L${fx + 32} ${FLOOR}`,
    `M${fx + 26} 300 C${fx + 40} 350 ${fx + 46} 392 ${fx + 50} 428 L${hand[0]} ${hand[1]}`,
  ];
}
function seated(fx: number, seatY: number, hand: [number, number]): string[] {
  return [
    circle(fx + 14, seatY - 300, 30),
    `M${fx + 6} ${seatY - 270} C${fx - 8} ${seatY - 200} ${fx - 10} ${seatY - 100} ${fx} ${seatY - 12}`,
    `M${fx + 32} ${seatY - 266} C${fx + 46} ${seatY - 200} ${fx + 42} ${seatY - 120} ${fx + 34} ${seatY - 44}`,
    `M${fx} ${seatY - 12} L${fx + 150} ${seatY - 16} L${fx + 160} ${FLOOR - 6} L${fx + 200} ${FLOOR}`,
    `M${fx + 34} ${seatY - 44} L${fx + 150} ${seatY - 46}`,
    `M${fx + 18} ${seatY - 240} L${fx + 52} ${seatY - 140} L${hand[0]} ${hand[1]}`,
  ];
}
/* a foot and shin, the toes at toeX (the toe-kick close-up) */
function foot(toeX: number): string[] {
  const x = toeX;
  return [
    `M${x - 200} 380 L${x - 204} 716 C${x - 210} 772 ${x - 196} ${FLOOR} ${x - 160} ${FLOOR} L${x - 10} ${FLOOR} C${x + 4} ${FLOOR} ${x + 6} 786 ${x - 8} 778 L${x - 112} 734 C${x - 128} 726 ${x - 132} 700 ${x - 130} 380`,
  ];
}

type Dim = { x1: number; y1: number; x2: number; y2: number; value: string; tx?: number; ty?: number; anchor?: 'start' | 'middle' | 'end' };
type Label = { x: number; y: number; tx?: number; ty?: number; anchor?: 'start' | 'middle' | 'end' };
type Plan = { lines: string[]; zone?: string; zoneColour?: string; zoneOpacity?: number; cone?: string; coneColour?: string; figure: string[]; dims: Dim[]; label?: Label };

const dimFor = (kind: string | undefined, value: string | undefined, map: Record<string, Omit<Dim, 'value'>>): Dim[] =>
  kind && kind !== 'none' && value && map[kind] ? [{ ...map[kind], value }] : [];

/* ── the side sections ─────────────────────────────────────────────────────── */
function measurePlan(s: ReelExplainer): Plan {
  const bad = s.verdict === 'bad';
  const dims = (map: Record<string, Omit<Dim, 'value'>>) => [...dimFor(s.dimension, s.value, map), ...dimFor(s.dimension2, s.value2, map)];
  const fig = s.figure || 'standing';
  const floor = `M60 ${FLOOR} H840`;
  switch (s.subject) {
    case 'toe_kick': {
      const recess = !bad;
      return {
        lines: [floor, 'M330 140 V690 H840', recess ? `M330 690 H430 V${FLOOR}` : `M330 690 V${FLOOR}`],
        zone: recess ? `M430 690 H840 V${FLOOR} H430 Z` : `M330 690 H840 V${FLOOR} H330 Z`,
        figure: fig === 'none' ? [] : foot(recess ? 400 : 322),
        dims: dims({ height: { x1: 460, y1: FLOOR, x2: 460, y2: 690 }, depth: { x1: 330, y1: 650, x2: 430, y2: 650 }, gap: { x1: 460, y1: FLOOR, x2: 460, y2: 690 }, width: { x1: 330, y1: 650, x2: 430, y2: 650 } }),
        label: { x: 740, y: 750, tx: 740, ty: 560, anchor: 'middle' },
      };
    }
    case 'upper_cabinet':
      return {
        lines: [floor, 'M800 110 V800', 'M470 470 H790 V490 H470 Z', 'M490 490 V765 H515 V800', 'M490 590 H790', 'M520 150 H790 V330 H520 Z', 'M655 150 V330'],
        zone: 'M520 150 H790 V330 H520 Z',
        figure: fig === 'none' ? [] : standing(330, [478, 462]),
        dims: dims({ gap: { x1: 850, y1: 470, x2: 850, y2: 330, tx: 655, ty: 400, anchor: 'middle' }, height: { x1: 850, y1: FLOOR, x2: 850, y2: 330, tx: 640, ty: 680, anchor: 'middle' }, depth: { x1: 520, y1: 120, x2: 790, y2: 120 }, width: { x1: 520, y1: 120, x2: 790, y2: 120 } }),
        label: { x: 655, y: 240 },
      };
    case 'table':
      return {
        lines: [floor, 'M440 560 H800 V578 H440 Z', 'M470 578 V800', 'M770 578 V800', 'M240 640 H400', 'M250 640 V420', 'M262 640 V800', 'M390 640 V800'],
        zone: 'M440 560 H800 V578 H440 Z',
        figure: fig === 'none' ? [] : seated(280, 640, [470, 550]),
        dims: dims({ height: { x1: 850, y1: FLOOR, x2: 850, y2: 560 }, gap: { x1: 620, y1: FLOOR, x2: 620, y2: 578 }, depth: { x1: 440, y1: 520, x2: 800, y2: 520 }, width: { x1: 440, y1: 520, x2: 800, y2: 520 } }),
        label: { x: 620, y: 560 },
      };
    case 'seat':
      return {
        lines: [floor, 'M380 640 H620 V662 H380 Z', 'M380 640 V400', 'M396 662 V800', 'M604 662 V800'],
        zone: 'M380 640 H620 V662 H380 Z',
        figure: fig === 'none' ? [] : seated(410, 640, [540, 600]),
        dims: dims({ height: { x1: 680, y1: FLOOR, x2: 680, y2: 640 }, depth: { x1: 380, y1: 700, x2: 620, y2: 700 }, width: { x1: 380, y1: 700, x2: 620, y2: 700 }, gap: { x1: 680, y1: FLOOR, x2: 680, y2: 640 } }),
        label: { x: 500, y: 640 },
      };
    case 'shelf':
      return {
        lines: [floor, 'M790 110 V800', 'M560 292 H790 V306 H560 Z', 'M580 432 H790 V446 H580 Z', 'M760 306 L790 336', 'M760 446 L790 476'],
        zone: 'M560 292 H790 V306 H560 Z',
        figure: fig === 'none' ? [] : standing(360, [552, 290]),
        dims: dims({ height: { x1: 850, y1: FLOOR, x2: 850, y2: 292 }, gap: { x1: 850, y1: 446, x2: 850, y2: 306 }, depth: { x1: 560, y1: 260, x2: 790, y2: 260 }, width: { x1: 560, y1: 260, x2: 790, y2: 260 } }),
        label: { x: 670, y: 292 },
      };
    case 'window':
      return {
        lines: [floor, 'M700 110 V260 H780 V110', 'M700 800 V575 H780 V800', 'M690 560 H790 V575 H690 Z', 'M740 260 V560'],
        zone: 'M690 560 H790 V575 H690 Z',
        figure: fig === 'none' ? [] : fig === 'seated' ? seated(360, 640, [480, 600]) : standing(420, [500, 560]),
        dims: dims({ height: { x1: 640, y1: FLOOR, x2: 640, y2: 560 }, gap: { x1: 640, y1: FLOOR, x2: 640, y2: 560 }, width: { x1: 700, y1: 220, x2: 780, y2: 220 }, depth: { x1: 700, y1: 220, x2: 780, y2: 220 } }),
        label: { x: 740, y: 410 },
      };
    case 'walkway':
      return {
        lines: [floor, 'M110 470 H340 V488 H110 Z', 'M130 488 V765 H150 V800', 'M130 600 H330', 'M590 470 H820 V488 H590 Z', 'M610 488 V765 H630 V800', 'M610 600 H810'],
        zone: 'M340 560 H590 V800 H340 Z',
        zoneOpacity: 0.35,
        figure: fig === 'none' ? [] : standing(430, [470, 520]),
        dims: dims({ width: { x1: 340, y1: 832, x2: 590, y2: 832, ty: 872 }, gap: { x1: 340, y1: 832, x2: 590, y2: 832, ty: 872 }, height: { x1: 860, y1: FLOOR, x2: 860, y2: 470 }, depth: { x1: 110, y1: 420, x2: 340, y2: 420 } }),
        label: { x: 465, y: 700 },
      };
    case 'ceiling':
      return {
        lines: ['M60 120 H840', floor, 'M820 120 V800'],
        zone: 'M60 120 H820 V132 H60 Z',
        figure: fig === 'none' ? [] : standing(380, [430, 520]),
        dims: dims({ height: { x1: 720, y1: FLOOR, x2: 720, y2: 120 }, gap: { x1: 720, y1: 272, x2: 720, y2: 120 }, width: { x1: 60, y1: 90, x2: 820, y2: 90 }, depth: { x1: 60, y1: 90, x2: 820, y2: 90 } }),
        label: { x: 560, y: 300 },
      };
    case 'counter':
    default: {
      const top = bad && s.dimension === 'height' ? 520 : 470;
      return {
        lines: [floor, `M470 ${top} H790 V${top + 20} H470 Z`, `M490 ${top + 20} V765 H515 V800`, `M490 ${top + 100} H790`],
        zone: `M470 ${top} H790 V${top + 20} H470 Z`,
        figure: fig === 'none' ? [] : fig === 'seated' ? seated(300, 640, [478, top - 8]) : standing(330, [478, top - 8]),
        dims: dims({ height: { x1: 840, y1: FLOOR, x2: 840, y2: top, tx: 640, ty: top + 190, anchor: 'middle' }, depth: { x1: 470, y1: top - 40, x2: 790, y2: top - 40 }, width: { x1: 470, y1: top - 40, x2: 790, y2: top - 40 }, gap: { x1: 840, y1: FLOOR, x2: 840, y2: top, tx: 640, ty: top + 190, anchor: 'middle' } }),
        label: { x: 630, y: top },
      };
    }
  }
}

function lightPlan(s: ReelExplainer): Plan {
  const good = s.verdict !== 'bad';
  const base = ['M60 120 H840', `M60 ${FLOOR} H840`, 'M800 120 V800', 'M470 470 H790 V490 H470 Z', 'M490 490 V765 H515 V800', 'M490 570 H790'];
  const lines = [...base];
  let src: [number, number];
  switch (s.subject) {
    case 'pendant': {
      const f = good ? 630 : 230;
      lines.push(`M${f} 120 V300`, `M${f - 50} 350 Q${f} 270 ${f + 50} 350 Z`);
      src = [f, 350];
      break;
    }
    case 'under_cabinet':
      lines.push('M520 150 H790 V330 H520 Z', 'M530 330 H780 V342 H530 Z');
      src = [655, 342];
      break;
    case 'wall':
      lines.push('M800 300 H762 V350 H800');
      src = [762, 325];
      break;
    case 'lamp':
      lines.push(`M180 ${FLOOR} V330`, `M140 ${FLOOR} H220`, 'M140 330 L162 268 H198 L220 330 Z');
      src = [180, 330];
      break;
    case 'ceiling':
    default: {
      const f = good ? 630 : 230;
      lines.push(`M${f - 40} 120 V134 H${f + 40} V120`);
      src = [f, 134];
    }
  }
  const lit = good && s.subject !== 'lamp';
  return {
    lines,
    cone: lit ? `M${src[0]} ${src[1]} L470 470 L790 470 Z` : `M${src[0]} ${src[1]} L120 ${FLOOR} L440 ${FLOOR} Z`,
    coneColour: '#f2c94c',
    // the worktop: lit warm when the light falls on the work, in shadow when it comes from behind
    zone: 'M470 470 H790 V490 H470 Z',
    zoneColour: lit ? '#e8b923' : '#6e6e73',
    figure: standing(330, [478, 462]),
    dims: [],
    label: { x: 700, y: 470, tx: 700, ty: 405, anchor: 'middle' },
  };
}

/* ── a dimension line: grows from its middle, end ticks, the value on a paper chip ── */
const Dimension: React.FC<{ d: Dim; t: number; v: number; font: string }> = ({ d, t, v, font }) => {
  if (t <= 0) return null;
  const vertical = Math.abs(d.x2 - d.x1) < Math.abs(d.y2 - d.y1);
  const mx = (d.x1 + d.x2) / 2;
  const my = (d.y1 + d.y2) / 2;
  const a = [mx + (d.x1 - mx) * t, my + (d.y1 - my) * t];
  const b = [mx + (d.x2 - mx) * t, my + (d.y2 - my) * t];
  const tick = (x: number, y: number) => (vertical ? `M${x - 16} ${y} H${x + 16}` : `M${x} ${y - 16} V${y + 16}`);
  const right = d.x1 < 700;
  const tx = d.tx ?? (vertical ? (right ? mx + 26 : mx - 26) : mx);
  const ty = d.ty ?? (vertical ? my : my - 30);
  const anchor = d.anchor ?? (vertical ? (right ? 'start' : 'end') : 'middle');
  return (
    <g>
      <path d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`} stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
      {t > 0.92 ? <path d={`${tick(d.x1, d.y1)} ${tick(d.x2, d.y2)}`} stroke={INK} strokeWidth={3.5} strokeLinecap="round" /> : null}
      <text
        x={tx} y={ty} textAnchor={anchor} dominantBaseline="middle" fontFamily={font} fontWeight={700} fontSize={46}
        fill={INK} opacity={v} stroke={PAPER} strokeWidth={10} paintOrder="stroke"
        style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: `scale(${interpolate(v, [0, 1], [0.8, 1])})` } as React.CSSProperties}
      >{d.value}</text>
    </g>
  );
};

/* a short callout: a leader line up and away from the anchor, the words at its end */
const Callout: React.FC<{ at: Label; text: string; t: number; font: string }> = ({ at, text, t, font }) => {
  if (!text || t <= 0) return null;
  const left = at.x > 450;
  const ex = at.tx ?? (left ? at.x - 150 : at.x + 150);
  const ey = at.ty ?? Math.max(70, at.y - 110);
  const anchor = at.anchor ?? (left ? 'end' : 'start');
  const lx = anchor === 'middle' ? ex : ex + (left ? -12 : 12);
  const ly = anchor === 'middle' ? ey - 16 : ey - 8;
  return (
    <g opacity={Math.min(1, t * 1.4)}>
      <Draw d={`M${at.x} ${at.y} L${ex} ${ey}`} t={t} w={3} />
      <circle cx={at.x} cy={at.y} r={7} fill={INK} />
      <text x={lx} y={ly} textAnchor={anchor} fontFamily={font} fontStyle="italic" fontSize={38} fill={INK} stroke={PAPER} strokeWidth={8} paintOrder="stroke">{text}</text>
    </g>
  );
};

const SectionDrawing: React.FC<{ plan: Plan; spec: ReelExplainer; font: string }> = ({ plan, spec, font }) => {
  const frame = useCurrentFrame();
  const zc = plan.zoneColour || zoneColour(spec.verdict);
  return (
    <g>
      {plan.cone ? <path d={plan.cone} fill={plan.coneColour} opacity={0.45 * prog(frame, 14, 30)} /> : null}
      {plan.zone ? <path d={plan.zone} fill={zc} opacity={(plan.zoneOpacity ?? 0.9) * prog(frame, 22, 32)} /> : null}
      {plan.lines.map((d, i) => <Draw key={`l${i}`} d={d} t={prog(frame, 2 + i * 3, 16 + i * 3)} />)}
      {plan.figure.map((d, i) => <Draw key={`f${i}`} d={d} t={prog(frame, 10 + i * 2, 26 + i * 2)} w={5} />)}
      {plan.dims.map((d, i) => (
        <Dimension key={`d${i}`} d={d} t={prog(frame, 24 + i * 6, 36 + i * 6)} v={prog(frame, 32 + i * 6, 40 + i * 6)} font={font} />
      ))}
      {plan.label ? <Callout at={plan.label} text={spec.label || ''} t={prog(frame, 36, 46)} font={font} /> : null}
    </g>
  );
};

/* words wrapped to lines of ≤ max characters (SVG text does not wrap) */
const wrap = (text: string, max: number): string[] => {
  const lines: string[] = [];
  String(text || '').split(/\s+/).filter(Boolean).forEach((w) => {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= max) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  });
  return lines.slice(0, 3);
};

/* no numbers said: two panels, ✓ and ✗, each with its words */
const ComparePanels: React.FC<{ items: NonNullable<ReelExplainer['items']>; font: string }> = ({ items, font }) => {
  const frame = useCurrentFrame();
  return (
    <g>
      {items.map((it, i) => {
        const x0 = i === 0 ? 70 : 480;
        const cx = x0 + 175;
        const colour = zoneColour(it.verdict);
        const mark = it.verdict === 'good' ? '✓' : it.verdict === 'bad' ? '✕' : '';
        const a = 4 + i * 10;
        const panel = `M${x0 + 30} 200 H${x0 + 320} Q${x0 + 350} 200 ${x0 + 350} 230 V${700} Q${x0 + 350} 730 ${x0 + 320} 730 H${x0 + 30} Q${x0} 730 ${x0} 700 V230 Q${x0} 200 ${x0 + 30} 200 Z`;
        const pop = interpolate(frame, [a + 10, a + 18], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
        const lines = wrap(it.text, 12);
        const tt = prog(frame, a + 14, a + 24);
        return (
          <g key={i}>
            <path d={panel} fill={colour} opacity={0.14 * prog(frame, a + 8, a + 18)} />
            <Draw d={panel} t={prog(frame, a, a + 14)} w={5} />
            {mark ? (
              <g opacity={pop} transform={`translate(${cx} 330) scale(${pop})`}>
                <circle r={58} fill={colour} />
                <text textAnchor="middle" dominantBaseline="central" fontFamily={font} fontWeight={800} fontSize={64} fill="#fff">{mark}</text>
              </g>
            ) : null}
            {lines.map((ln, k) => (
              <text key={k} x={cx} y={490 + k * 62 - (lines.length - 1) * 20} textAnchor="middle" fontFamily={font} fontWeight={700} fontSize={50} fill={INK} opacity={tt}>{ln}</text>
            ))}
            {it.value ? <text x={cx} y={665} textAnchor="middle" fontFamily={font} fontWeight={700} fontSize={44} fill={colour} opacity={tt}>{it.value}</text> : null}
          </g>
        );
      })}
    </g>
  );
};

/* ── two columns: the wrong and the right ──────────────────────────────────── */
const CompareDrawing: React.FC<{ spec: ReelExplainer; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const items = (spec.items || []).slice(0, 2);
  const nums = items.map((it) => parseFloat(String(it.value).replace(',', '.').replace(/[^\d.]/g, '')));
  const both = nums.every((n) => Number.isFinite(n) && n > 0);
  if (!both) return <ComparePanels items={items} font={font} />;
  const max = Math.max(...nums);
  // honest order (bigger is taller), the difference kept visible (ratio 0.45–0.85)
  const heights = items.map((_, i) => {
    if (!both) return 420;
    const r = nums[i] / max;
    return r >= 1 ? 480 : 480 * Math.max(0.45, Math.min(0.85, r));
  });
  return (
    <g>
      <Draw d="M80 760 H820" t={prog(frame, 2, 14)} />
      {items.map((it, i) => {
        const cx = i === 0 ? 270 : 630;
        const h = heights[i];
        const top = 760 - h;
        const g = prog(frame, 10 + i * 8, 28 + i * 8);
        const colour = zoneColour(it.verdict);
        const mark = it.verdict === 'good' ? '✓' : it.verdict === 'bad' ? '✕' : '';
        const pop = interpolate(frame, [26 + i * 8, 34 + i * 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
        return (
          <g key={i}>
            <rect x={cx - 110} y={760 - h * g} width={220} height={h * g} fill={colour} opacity={0.9} />
            <Draw d={`M${cx - 110} 760 V${top} H${cx + 110} V760`} t={prog(frame, 6 + i * 8, 22 + i * 8)} />
            {it.value ? <text x={cx} y={top - 34} textAnchor="middle" fontFamily={font} fontWeight={700} fontSize={56} fill={INK} opacity={pop}>{it.value}</text> : null}
            {mark ? (
              <g opacity={pop} transform={`translate(${cx} ${top - (it.value ? 120 : 60)}) scale(${pop})`}>
                <circle r={34} fill={colour} />
                <text textAnchor="middle" dominantBaseline="central" fontFamily={font} fontWeight={800} fontSize={40} fill="#fff">{mark}</text>
              </g>
            ) : null}
            {wrap(it.text, 13).map((ln, k) => (
              <text key={k} x={cx} y={818 + k * 50} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={42} fill={INK} opacity={prog(frame, 20 + i * 8, 30 + i * 8)}>{ln}</text>
            ))}
          </g>
        );
      })}
    </g>
  );
};

/* ── steps joined by arrows ────────────────────────────────────────────────── */
const FlowDrawing: React.FC<{ spec: ReelExplainer; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const items = (spec.items || []).slice(0, 4);
  const n = items.length;
  const ys = items.map((_, i) => (n === 1 ? 450 : 130 + (i * 640) / (n - 1)));
  const step = n > 3 ? 10 : 14;
  return (
    <g>
      {items.map((it, i) => {
        const y = ys[i];
        // each step draws as it is said (atSec from the agent's word index), else in turn
        const a = typeof it.atSec === 'number' ? 2 + Math.round(it.atSec * 30) : 2 + i * step;
        const box = `M190 ${y - 58} H710 Q740 ${y - 58} 740 ${y - 28} V${y + 28} Q740 ${y + 58} 710 ${y + 58} H190 Q160 ${y + 58} 160 ${y + 28} V${y - 28} Q160 ${y - 58} 190 ${y - 58} Z`;
        const next = ys[i + 1];
        return (
          <g key={i}>
            <path d={box} fill={i === n - 1 ? zoneColour(spec.verdict === 'none' ? 'none' : spec.verdict) : 'none'} opacity={i === n - 1 ? 0.25 * prog(frame, a + 10, a + 18) : 0} />
            <Draw d={box} t={prog(frame, a, a + 12)} w={5} />
            <text x={450} y={y} textAnchor="middle" dominantBaseline="central" fontFamily={font} fontWeight={600} fontSize={52} fill={INK} opacity={prog(frame, a + 6, a + 12)}>{it.text}</text>
            {next != null ? (
              <g>
                <Draw d={`M450 ${y + 70} V${next - 72}`} t={prog(frame, a + 8, a + step + 2)} w={4.5} />
                <Draw d={`M430 ${next - 92} L450 ${next - 70} L470 ${next - 92}`} t={prog(frame, a + step, a + step + 4)} w={4.5} />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
};

/* ── points ticking in as they are said ─────────────────────────────────────── */
const ChecklistDrawing: React.FC<{ spec: ReelExplainer; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const items = (spec.items || []).slice(0, 4);
  const n = items.length;
  const tickColour = spec.verdict === 'bad' ? BAD : GOOD;
  return (
    <g>
      {items.map((it, k) => {
        const y = 450 - ((n - 1) * 170) / 2 + k * 170;
        const a = typeof it.atSec === 'number' ? 2 + Math.round(it.atSec * 30) : 2 + k * 12;
        const box = `M120 ${y - 44} H208 V${y + 44} H120 Z`;
        const tick = spec.verdict === 'bad'
          ? `M136 ${y - 28} L192 ${y + 28} M192 ${y - 28} L136 ${y + 28}`
          : `M134 ${y + 2} L158 ${y + 28} L198 ${y - 30}`;
        const tt = prog(frame, a + 4, a + 14);
        return (
          <g key={k}>
            <Draw d={box} t={prog(frame, a, a + 10)} w={5} />
            <Draw d={tick} t={prog(frame, a + 8, a + 16)} w={9} color={tickColour} />
            <text x={250} y={y} dominantBaseline="central" fontFamily={font} fontWeight={600} fontSize={60} fill={INK} opacity={tt}
              transform={`translate(${interpolate(tt, [0, 1], [-18, 0])} 0)`}>{it.text}</text>
          </g>
        );
      })}
    </g>
  );
};

/* ── two rooms in plan: the wall between them erases, the way through draws on ── */
const OpenPlanDrawing: React.FC<{ spec: ReelExplainer; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const [a, b] = (spec.items || []).slice(0, 2);
  const wallGone = prog(frame, 24, 40);
  const shell = 'M250 680 H800 V220 H100 V680 H160';
  return (
    <g>
      <Draw d={shell} t={prog(frame, 2, 22)} w={9} />
      <Draw d="M160 680 V590" t={prog(frame, 14, 20)} w={4} />
      <Draw d="M160 590 A90 90 0 0 1 250 680" t={prog(frame, 16, 24)} w={3} />
      {/* the wall: drawn, then erased from the middle out, leaving two stubs */}
      <Draw d="M450 220 V680" t={prog(frame, 6, 18)} w={9} />
      {wallGone > 0 ? <rect x={438} y={262 + (1 - wallGone) * 188} width={24} height={376 * wallGone} fill={PAPER} /> : null}
      <path d="M104 224 H796 V676 H104 Z" fill={GOOD} opacity={0.16 * wallGone} />
      <Draw d="M270 520 C380 420 520 420 630 520" t={prog(frame, 38, 52)} w={4} color={GOOD} />
      <Draw d="M604 500 L632 522 L600 536" t={prog(frame, 50, 54)} w={4} color={GOOD} />
      {a ? <text x={275} y={360} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={50} fill={INK} opacity={prog(frame, 10, 20)}>{a.text}</text> : null}
      {b ? <text x={625} y={360} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={50} fill={INK} opacity={prog(frame, 14, 24)}>{b.text}</text> : null}
    </g>
  );
};

/* ── one number that is the point: it counts up inside a ring ──────────────── */
const StatDrawing: React.FC<{ spec: ReelExplainer; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const it = (spec.items || [])[0];
  if (!it) return null;
  const m = String(it.value).match(/^(\D*)(\d+(?:[.,]\d+)?)(.*)$/);
  const target = m ? parseFloat(m[2].replace(',', '.')) : 0;
  const decimals = m && /[.,]/.test(m[2]) ? m[2].split(/[.,]/)[1].length : 0;
  const t = prog(frame, 6, 34);
  const shown = m ? `${m[1]}${(target * t).toFixed(decimals)}${m[3]}` : it.value;
  const colour = zoneColour(spec.verdict);
  return (
    <g>
      <Draw d={circle(450, 380, 280)} t={prog(frame, 2, 30)} w={6} color={spec.verdict === 'none' ? INK : colour} />
      <text x={450} y={390} textAnchor="middle" dominantBaseline="central" fontFamily={font} fontWeight={800} fontSize={shown.length > 6 ? 150 : 200} fill={INK} letterSpacing={-4}>{shown}</text>
      <text x={450} y={760} textAnchor="middle" fontFamily={font} fontWeight={600} fontSize={50} fill={INK} opacity={prog(frame, 26, 36)}>{it.text}</text>
    </g>
  );
};

/* ── the card: badge + title above, the drawing in the middle, the captions below (80 %) ── */
export const ExplainerScene: React.FC<{ spec: ReelExplainer; durationInFrames: number; font: string; titleFont?: string }> = ({ spec, durationInFrames, font, titleFont }) => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], clamp);
  const settle = prog(frame, 0, 20);
  const badge = interpolate(frame, [3, 13], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  const title = prog(frame, 5, 14);
  const hasBadge = spec.verdict === 'good' || spec.verdict === 'bad';
  let drawing: React.ReactNode = null;
  if (spec.scene === 'measure') drawing = <SectionDrawing plan={measurePlan(spec)} spec={spec} font={font} />;
  else if (spec.scene === 'light') drawing = <SectionDrawing plan={lightPlan(spec)} spec={spec} font={font} />;
  else if (spec.scene === 'compare') drawing = <CompareDrawing spec={spec} font={font} />;
  else if (spec.scene === 'flow') drawing = <FlowDrawing spec={spec} font={font} />;
  else if (spec.scene === 'checklist') drawing = <ChecklistDrawing spec={spec} font={font} />;
  else if (spec.scene === 'open_plan') drawing = <OpenPlanDrawing spec={spec} font={font} />;
  else if (spec.scene === 'stat') drawing = <StatDrawing spec={spec} font={font} />;
  return (
    <AbsoluteFill style={{ background: PAPER, opacity: out }}>
      <div style={{ position: 'absolute', top: hasBadge ? '6.5%' : '9%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {hasBadge ? (
          <div style={{
            width: 112, height: 112, borderRadius: 999, background: spec.verdict === 'good' ? GOOD : BAD, color: '#fff',
            display: 'grid', placeItems: 'center', fontSize: 68, fontWeight: 800, fontFamily: font,
            boxShadow: '0 10px 30px rgba(0,0,0,0.14)', transform: `scale(${badge})`,
          }}>{spec.verdict === 'good' ? '✓' : '✕'}</div>
        ) : null}
        {spec.title ? (
          <div style={{
            fontFamily: titleFont || font, fontSize: 54, fontWeight: 700, color: INK, letterSpacing: -0.6, textAlign: 'center', maxWidth: '84%',
            opacity: title, transform: `translateY(${interpolate(title, [0, 1], [14, 0])}px)`,
          }}>{spec.title}</div>
        ) : null}
      </div>
      <svg
        viewBox="0 0 900 900" width={960} height={960}
        style={{ position: 'absolute', left: 60, top: '21%', transform: `scale(${interpolate(settle, [0, 1], [0.97, 1])})`, transformOrigin: '50% 60%' }}
      >
        {drawing}
      </svg>
    </AbsoluteFill>
  );
};
