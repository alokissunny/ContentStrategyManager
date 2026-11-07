import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { useLang } from '../lib/lang.js'
import { startCapture } from '../components/HeroCapture.jsx'

export default function S6Invitation() {
  const [lang] = useLang()
  const es = lang === 'es'

  return (
    <section className="b6">
      <span className="b6-orb" aria-hidden="true" />
      <span className="b6-orb-sm" aria-hidden="true" />
      <div className="container">
        <motion.h2 className="b6-title" {...pop}>
          {es ? 'Tú diseñas los espacios. ' : 'You design the spaces. '}
          <span className="hl">{es ? 'Bauhly planifica los posts.' : 'Bauhly plans the posts.'}</span>
        </motion.h2>
        <motion.p className="b6-sub" {...popDelayed(0.08)}>
          {es ? 'Haz el análisis. Recibe el plan de tu primera semana.' : <>Run the analysis. Get your first week&rsquo;s plan.</>}
        </motion.p>
        <motion.div {...popDelayed(0.16)}>
          {/* invite-only: the way in is Capture, which asks for an account at the first send */}
          <button className="cta cta-ink" onClick={() => startCapture()}>
            {es ? 'Empieza aquí' : 'Start capturing'}
          </button>
        </motion.div>
        <motion.p className="b6-reassure" {...popDelayed(0.24)}>
          {es ? 'Sin perseguir tendencias. Sin bailes. Sin culpa por las semanas que no llegaste.' : 'No trend-chasing. No dancing. No guilt about the weeks you missed.'}
        </motion.p>
      </div>
    </section>
  )
}
