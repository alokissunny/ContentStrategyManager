import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { GlyphSite, GlyphSwatch, GlyphPlan } from '../svg/glyphs.jsx'

const patterns = ['Topics', 'Formats', 'Timing']

const yours = [
  'Your projects and your voice',
  'Who your audience really is',
  'The gaps in what you’ve posted',
]

const HIGHLIGHT = [2, 6, 11, 15, 20]

/* the studio cards pinned to the research wall — settle into a slight
   resting tilt so they read as pinned, not laid out */
const settle = (rest) => ({
  initial: { opacity: 0, y: 24, rotate: rest * 1.8 },
  whileInView: { opacity: 1, y: 0, rotate: rest },
  viewport: { once: true, margin: '-60px' },
  transition: { type: 'spring', stiffness: 82, damping: 15 },
})

function MiniStudio() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10 L11 4 L18 10" />
      <path d="M6 10 V18 H16 V10" />
    </svg>
  )
}

export default function S10Intelligence() {
  return (
    <section className="block b10" id="intelligence">
      <div className="container">
        <motion.span className="intel-eyebrow" {...pop}>
          Step 03, up close
        </motion.span>
        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          We did the homework. 300 studios of it.
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.12)}>
          Strategy, not guesswork. We learn what earns trust across the industry — and what
          your audience cares about right now — then match it to your work.
        </motion.p>

        <div className="intel-flow">
          <div className="intel-inputs">
            <motion.div className="intel-card intel-market" {...settle(-1.2)}>
              <span className="intel-pin" aria-hidden="true" />
              <span className="intel-card-tag">The market</span>
              <span className="intel-number">300+</span>
              <span className="intel-card-label">interior design studios analyzed</span>
              <div className="intel-mosaic" aria-hidden="true">
                {Array.from({ length: 24 }).map((_, i) => (
                  <span key={i} className={`intel-tile ${HIGHLIGHT.includes(i) ? 'on' : ''}`}>
                    <MiniStudio />
                  </span>
                ))}
              </div>
              <div className="intel-chips">
                {patterns.map((p) => (
                  <span key={p} className="intel-chip">
                    {p}
                  </span>
                ))}
                <span className="intel-chip intel-chip-more">+3 more</span>
              </div>
              <span className="intel-note">“what actually works”</span>
            </motion.div>

            <motion.div className="intel-card intel-you" {...settle(1.2)}>
              <span className="intel-pin" aria-hidden="true" />
              <span className="intel-card-tag">Your studio</span>
              <div className="intel-you-glyphs" aria-hidden="true">
                <span className="intel-you-glyph on">
                  <GlyphSite size={40} />
                </span>
                <span className="intel-you-glyph">
                  <GlyphSwatch size={40} />
                </span>
                <span className="intel-you-glyph">
                  <GlyphPlan size={40} />
                </span>
              </div>
              <ul className="intel-you-list">
                {yours.map((y) => (
                  <li key={y}>{y}</li>
                ))}
              </ul>
              <span className="intel-note">“…and what’s only you”</span>
            </motion.div>
          </div>

          <div className="intel-merge" aria-hidden="true">
            <span className="intel-thread intel-thread-top" />
            <span className="intel-node">
              Bauhly<span className="nav-dot">.</span>
            </span>
            <span className="intel-thread intel-thread-bottom" />
          </div>

          <motion.div className="intel-out" {...popDelayed(0.1)}>
            <span className="intel-out-tag">A post with a reason</span>
            <span className="intel-out-when">Fri · 12:30 · Carousel</span>
            <p className="intel-out-why">
              Homeowners are asking this exact question right now — and it&rsquo;s one only you
              can answer well. Timely, and unmistakably yours.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
