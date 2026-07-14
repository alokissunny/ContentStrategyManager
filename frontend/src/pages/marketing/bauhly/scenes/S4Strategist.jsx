import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'
import { GlyphSpark } from '../svg/glyphs.jsx'

export default function S4Strategist() {
  return (
    <section className="block b4" id="results">
      <div className="container block-grid">
        <div>
          <motion.h2 className="block-title" {...pop}>
            Applause is nice. Inquiries pay.
          </motion.h2>
          <motion.p className="block-sub" {...popDelayed(0.08)}>
            Likes from other designers don&rsquo;t book projects. Bauhly tracks the one
            number that matters — did the right people reach out — and your strategy learns
            from it every single week.
          </motion.p>
        </div>

        <motion.div className="b4-card" {...slide(0, 1)}>
          <img
            className="b4-visual"
            src="/assets/photo/sys-letter.jpg"
            alt="A stack of paper hearts beside a single handwritten letter on a warm desk"
          />
          <span className="b4-card-label">
            <GlyphSpark size={20} /> Weekly review · 10 seconds
          </span>
          <div className="b4-row">
            <span className="b4-metric muted">1,204 likes</span>
            <span className="b4-label">other designers</span>
          </div>
          <div className="b4-row">
            <span className="b4-metric">3 inquiries</span>
            <span className="b4-label">homeowners, ready to talk</span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
