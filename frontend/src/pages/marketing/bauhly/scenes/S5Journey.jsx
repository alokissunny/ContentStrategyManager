import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'
import { GlyphColonnade, GlyphDoorway, GlyphHouse } from '../svg/glyphs.jsx'

const steps = [
  {
    cls: 'b5-found',
    step: 'Step 1',
    title: 'Found',
    body: 'The right homeowners find you — not just other designers scrolling.',
    Glyph: GlyphDoorway,
  },
  {
    cls: 'b5-trusted',
    step: 'Step 2',
    title: 'Trusted',
    body: 'They see how you think before they ever call. Trust compounds, post after post.',
    Glyph: GlyphColonnade,
  },
  {
    cls: 'b5-hired',
    step: 'Step 3',
    title: 'Hired',
    body: 'The inquiry arrives already convinced. No pitching. No discounts.',
    Glyph: GlyphHouse,
  },
]

export default function S5Journey() {
  return (
    <section className="block b5">
      <div className="container">
        <motion.h2 className="block-title" {...pop}>
          Found. Trusted. Hired.
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.08)}>
          Nobody hires a stranger. Every week of posts moves the right clients one step closer.
        </motion.p>
        <div className="b5-cards">
          {steps.map((s, i) => (
            <motion.div key={s.title} className={`b5-card ${s.cls}`} {...slide(i, i === 1 ? -1 : 1)}>
              <div className="b5-illo" aria-hidden="true">
                <span className="b5-illo-ring" />
                <span className="b5-illo-dot" />
                <s.Glyph size={120} />
              </div>
              <span className="b5-step">{s.step}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
