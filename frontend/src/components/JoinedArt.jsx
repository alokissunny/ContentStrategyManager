/*
 * ── THE JOINED WAITLIST'S PICTURE (Leon, Nov 13 — decisions 905, 907, 908, 909) ──────────────────────────────────────
 * What just happened, drawn: a list, two places already on it, the visitor's at the bottom, and the list marked done
 * with a lime badge on the card's corner. The ONE confirmation picture: `AuthForm`'s joined step is the only place it
 * is drawn, and every way onto the waitlist reaches that step (decision 909 lists them).
 * 909 ("Keep Bauhly lime as the primary accent, with a few carefully selected red/orange and blue geometric
 * elements… Refine the placement, size, and balance… After the entrance animation, animate 2–3 decorative shapes with
 * subtle floating movements… Keep the central card stable… pause animations when the modal is hidden"): WHAT USED TO BE
 * HERE (908): five shapes in lime, charcoal and a grey ring, none moving after the entrance. Now seven, set as two
 * diagonals around the card: lime the largest and most (a big dot high left, a big diamond right, a small dot low
 * right), the brand's orange on the other diagonal (a dot by the badge, a diamond low left), and the brand's blue
 * between them (a ring middle left, a small dot low right). Three — the two big limes and the orange by the badge —
 * float 3px once they have settled (flow.css, `.jart__bit--float`); the card and the badge never move again. Each
 * shape's `--dx`/`--dy` is the way back towards the card's middle, where its entrance starts. Hidden from a screen
 * reader: it says nothing the heading does not.
 */
import { useEffect, useRef } from 'react';

/* the card's middle, which the shapes come out from */
const MID = { x: 100, y: 70 };
/* where each settles, and whether it floats (`f`: which of the three floats, for its own pace) */
const BITS = [
  { k: 'dot', x: 28, y: 40, r: 6.5, fill: 'var(--experiment-500)', f: 1 },
  { k: 'ring', x: 17, y: 80, r: 4.5, stroke: 'var(--blue-500)' },
  { k: 'diamond', x: 34, y: 114, s: 7, fill: 'var(--signal-500)' },
  { k: 'dot', x: 178, y: 14, r: 3.5, fill: 'var(--signal-500)', f: 3 },
  { k: 'diamond', x: 185, y: 60, s: 10, fill: 'var(--experiment-500)', f: 2 },
  { k: 'dot', x: 174, y: 98, r: 3, fill: 'var(--blue-500)' },
  { k: 'dot', x: 164, y: 128, r: 3.5, fill: 'var(--experiment-500)' },
];

function Bit({ b, i }) {
  const style = { '--dx': `${((MID.x - b.x) * 0.55).toFixed(1)}px`, '--dy': `${((MID.y - b.y) * 0.55).toFixed(1)}px`, '--i': i };
  const cls = `jart__bit${b.k === 'diamond' ? ' jart__bit--turned' : ''}${b.f ? ` jart__bit--float jart__bit--f${b.f}` : ''}`;
  if (b.k === 'ring') {
    return <circle className={cls} style={style} cx={b.x} cy={b.y} r={b.r} fill="none" stroke={b.stroke} strokeWidth="2" />;
  }
  if (b.k === 'dot') return <circle className={cls} style={style} cx={b.x} cy={b.y} r={b.r} fill={b.fill} />;
  return <rect className={cls} style={style} x={b.x - b.s / 2} y={b.y - b.s / 2} width={b.s} height={b.s} rx="1.5" fill={b.fill} />;
}

export default function JoinedArt() {
  /* the float stops while the page cannot be seen (another tab, a minimised window); the step leaving takes it down */
  const svg = useRef(null);
  useEffect(() => {
    const mark = () => { if (svg.current) svg.current.toggleAttribute('data-paused', document.hidden); };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, []);
  return (
    <svg ref={svg} className="jart" viewBox="0 0 200 140" width="200" height="140" aria-hidden="true" focusable="false">
      {BITS.map((b, i) => <Bit key={i} b={b} i={i} />)}
      <g className="jart__card">
        <rect x="46" y="22" width="108" height="96" rx="14" fill="var(--surface)" stroke="var(--ink-200)" className="jart__sheet" />
        {/* the places already on the list */}
        <circle cx="62" cy="42" r="5.5" fill="var(--ink-100)" />
        <rect x="73" y="39" width="46" height="6" rx="3" fill="var(--ink-100)" />
        <circle cx="62" cy="61" r="5.5" fill="var(--ink-100)" />
        <rect x="73" y="58" width="36" height="6" rx="3" fill="var(--ink-100)" />
        {/* and the visitor's */}
        <rect x="52" y="76" width="96" height="32" rx="10" fill="var(--surface-brand)" />
        <circle cx="66" cy="92" r="6.5" fill="var(--ink-900)" />
        <rect x="78" y="86" width="40" height="5.5" rx="2.75" fill="var(--ink-900)" />
        <rect x="78" y="95.5" width="24" height="4.5" rx="2.25" fill="var(--ink-300)" />
      </g>
      {/* the list, done: on the card's corner, ringed in white so it stands off the card */}
      <g className="jart__tick">
        <circle cx="152" cy="26" r="15" fill="var(--experiment-500)" stroke="var(--surface)" strokeWidth="3" />
        <path d="M145.5 26.4 L150 30.8 L158.6 21.8" pathLength="1" fill="none" stroke="var(--ink-900)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
