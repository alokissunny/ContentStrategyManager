import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'

const memories = [
  'The loft you finished in March',
  'That idea you noted and forgot',
  'Your Brand DNA and your voice',
  'The post that brought two inquiries',
  'Last month’s plan — what worked',
  'What clients ask right now',
]

const output = [
  ['Mon', 'The loft, revisited: one decision'],
  ['Wed', 'The 2024 hallway, back — small spaces are trending again'],
  ['Fri', 'The question everyone asks, answered'],
]

export default function S9Memory() {
  return (
    <section className="block b9" id="memory">
      <div className="container">
        <motion.span className="intel-eyebrow" {...pop}>
          Step 04, up close
        </motion.span>
        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          Nothing valuable gets lost.
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.12)}>
          Every project, plan, idea and result becomes part of a knowledge base that keeps
          growing. And when you run dry, Bauhly reaches back — resurfacing a project you&rsquo;d
          moved past, right when your audience is asking about exactly that.
        </motion.p>

        <div className="mem">
          <div className="mem-left">
            <motion.figure className="mem-map" {...slide(0, -1)}>
              <img
                src="/assets/photo/sys-map.jpg"
                alt="A studio wall board where photos, swatches, plans and notes are connected by pencil lines and a red thread"
              />
            </motion.figure>
            <div className="mem-chips">
              {memories.slice(0, 3).map((m, i) => (
                <motion.span key={m} className="mem-chip" {...slide(i + 1, i % 2 ? -1 : 1)}>
                  {m}
                </motion.span>
              ))}
            </div>
          </div>

          <div className="mem-flow" aria-hidden="true">
            <span className="mem-line" />
            <span className="mem-node">
              Bauhly<span className="nav-dot">.</span>
            </span>
            <span className="mem-line" />
          </div>

          <motion.div className="mem-out" {...slide(2, 1)}>
            <h3 className="mem-out-title">Next week, from memory</h3>
            {output.map(([d, t]) => (
              <div key={d} className="att-plan-row">
                <span>{d}</span>
                <p>{t}</p>
              </div>
            ))}
            <span className="mem-out-note">Still yours. Still authentic.</span>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
