import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'

/* transform-only settle on scroll-in — no opacity, so nothing fades;
   cards drop a touch and rotate into a slightly pinned resting angle */
const settle = (i, rest) => ({
  initial: { y: 26, rotate: rest * 2 },
  whileInView: { y: 0, rotate: rest },
  viewport: { once: true, margin: '-70px' },
  transition: { type: 'spring', stiffness: 90, damping: 15, delay: i * 0.1 },
})

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/* Sunday night — a phone endlessly scrolling a feed, a moon in the corner */
function GlyphScroll() {
  const bars = [24, 32, 40, 48, 56, 64, 72, 80, 88, 96]
  const widths = [22, 15, 20, 13, 18]
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" {...stroke} aria-hidden="true">
      <defs>
        <clipPath id="pvScreen">
          <rect x="35" y="24" width="30" height="46" rx="4" />
        </clipPath>
      </defs>
      <rect x="31" y="12" width="38" height="76" rx="8" />
      <line x1="45" y1="82" x2="55" y2="82" />
      <g clipPath="url(#pvScreen)">
        <g className="pv-scroll">
          {bars.map((y, i) => (
            <line key={y} x1="39" y1={y} x2={39 + widths[i % 5]} y2={y} strokeWidth="3" />
          ))}
        </g>
      </g>
      <path className="pv-moon" d="M78 10 A10 10 0 1 0 78 30 A8 8 0 1 1 78 10 Z" strokeWidth="0" />
    </svg>
  )
}

/* A stunning framed project — with a single, tiny heart */
function GlyphSeen() {
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" {...stroke} aria-hidden="true">
      <rect x="16" y="16" width="58" height="46" rx="3" />
      <circle cx="34" cy="34" r="6" />
      <path d="M16 55 L34 43 L48 53 L60 45 L74 55" />
      <path
        className="pv-heart"
        d="M58 84 C50 77 46 72 51 68 C54 66 57 68 58 70 C59 68 62 66 65 68 C70 72 66 77 58 84 Z"
        strokeWidth="0"
      />
      <line x1="70" y1="76" x2="80" y2="76" strokeWidth="2.4" />
    </svg>
  )
}

/* Hours draining away — a clock spinning, a pencil left waiting */
function GlyphHours() {
  return (
    <svg width="120" height="120" viewBox="0 0 100 100" {...stroke} aria-hidden="true">
      <circle cx="40" cy="52" r="26" />
      <circle cx="40" cy="52" r="1.8" fill="currentColor" strokeWidth="0" />
      <line x1="40" y1="28" x2="40" y2="32" />
      <line x1="40" y1="72" x2="40" y2="76" />
      <line x1="16" y1="52" x2="20" y2="52" />
      <line x1="60" y1="52" x2="64" y2="52" />
      <line x1="40" y1="52" x2="51" y2="47" />
      <line className="pv-hand" x1="40" y1="52" x2="40" y2="33" />
      <g transform="rotate(34 74 64)">
        <rect x="70" y="44" width="8" height="34" rx="2" />
        <path d="M70 78 L74 87 L78 78 Z" fill="currentColor" strokeWidth="0" />
        <line x1="70" y1="53" x2="78" y2="53" />
      </g>
    </svg>
  )
}

const vignettes = [
  { Glyph: GlyphScroll, rest: -1.5, cap: 'Sunday night. Scrolling your own camera roll. Still nothing to post.' },
  { Glyph: GlyphSeen, rest: 1.2, cap: 'The project came out stunning. The feed barely noticed.' },
  { Glyph: GlyphHours, rest: -1, cap: 'Marketing hours, quietly stolen from the design hours.' },
]

export default function S1bProblem() {
  return (
    <section className="block b1b" id="problem">
      <div className="container">
        <motion.h2 className="block-title b1b-title" {...pop}>
          The work is beautiful. The feed doesn&rsquo;t show it.
        </motion.h2>

        <div className="b1b-cards">
          {vignettes.map(({ Glyph, rest, cap }, i) => (
            <motion.article key={cap} className="pv-card" {...settle(i, rest)}>
              <div className="pv-illo">
                <span className="pv-ring" />
                <Glyph />
              </div>
              <p className="pv-cap">{cap}</p>
            </motion.article>
          ))}
        </div>

        <motion.p className="b1b-pivot" {...popDelayed(0.24)}>
          Then Monday morning, your week of posts arrives.
        </motion.p>
      </div>
    </section>
  )
}
