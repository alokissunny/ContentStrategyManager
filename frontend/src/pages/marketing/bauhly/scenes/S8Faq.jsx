import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'

const faqs = [
  {
    q: 'Do I need to be good at social media?',
    a: 'No — that’s the point. You stay the designer. Bauhly does the strategy: what to post, in which format, and why. You bring the projects and the judgment you already have.',
  },
  {
    q: 'How does it learn my style?',
    a: 'From your work, not a questionnaire. Bauhly reads your projects, your past posts and how your audience responds — and the picture gets sharper every week. The voice stays yours; it just gets easier to sound like it.',
  },
  {
    q: 'What do I get in the first week?',
    a: 'The moment you subscribe, Bauhly analyzes your profile and returns a full week’s plan the same day — hooks, formats, timing and the reason behind each one. No blank page, no setup week.',
  },
  {
    q: 'Do I have to post every day?',
    a: 'No. Start with two or three posts a week — whatever genuinely fits. Bauhly adapts to your pace and gradually recommends more as consistency becomes easy, and you can always post more whenever you want. Over the long run, steady beats spectacular: consistency is what compounds.',
  },
  {
    q: 'How much time does it take each week?',
    a: 'Minutes. Bauhly does the time-consuming part — deciding what to post, when, and why — so your plan lands ready every Monday. No blank calendar, no second-guessing, no strategy homework.',
  },
  {
    q: 'Does it write my captions?',
    a: 'It gives you a caption direction and a starting draft in your voice — you edit, you approve. Nothing is posted for you or without you.',
  },
  {
    q: 'What happens if I skip a week?',
    a: 'Nothing bad. No streaks, no guilt. The next plan simply picks up from where you are — it plans around your real workload, not an ideal one.',
  },
  {
    q: 'Which platforms does it cover?',
    a: 'Instagram first — it’s where interior design clients actually look, and going deep on one platform beats being shallow on three. LinkedIn is next: your plan will extend to it, not restart.',
  },
]

export default function S8Faq() {
  return (
    <section className="block b8" id="questions">
      <div className="container">
        <motion.h2 className="block-title" {...pop}>
          Questions, answered.
        </motion.h2>
        <motion.div className="faq" {...popDelayed(0.1)}>
          {faqs.map((f) => (
            <details key={f.q} className="faq-item" name="faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
