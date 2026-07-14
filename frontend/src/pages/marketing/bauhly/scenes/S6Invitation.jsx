import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { pop, popDelayed } from '../lib/motion.js'

export default function S6Invitation() {
  const nav = useNavigate()

  return (
    <section className="b6">
      <span className="b6-orb" aria-hidden="true" />
      <span className="b6-orb-sm" aria-hidden="true" />
      <div className="container">
        <motion.h2 className="b6-title" {...pop}>
          You design the spaces. <span className="hl">Bauhly plans the posts.</span>
        </motion.h2>
        <motion.p className="b6-sub" {...popDelayed(0.08)}>
          Run the analysis. Get your first week&rsquo;s plan. Try it for two months — if
          you&rsquo;re not convinced, we&rsquo;ll give a month back.
        </motion.p>
        <motion.div {...popDelayed(0.16)}>
          <button className="cta cta-ink" onClick={() => nav('/auth', { state: { mode: 'signup' } })}>
            Analyze my profile
          </button>
        </motion.div>
        <motion.p className="b6-reassure" {...popDelayed(0.24)}>
          No trend-chasing. No dancing. No guilt about the weeks you missed.
        </motion.p>
      </div>
    </section>
  )
}
