import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'
import { GlyphColonnade, GlyphDoorway, GlyphHouse } from '../svg/glyphs.jsx'
import { useLang } from '../lib/lang.js'

/* ── WHAT THESE THREE NO LONGER PROMISE (Leon, Nov 5 — landing audit, E1) ──
 * "Do not imply that Bauhly guarantees followers, engagement, enquiries, or
 *  clients."
 * `The right homeowners find you`, `The inquiry arrives already convinced. No
 * pitching. No discounts.` and `Every week of posts moves the right clients
 * one step closer` each stated a result as a fact. What a post can honestly
 * be said to do is show how a studio thinks; what a reader does next is
 * theirs. The three lines below say the first and stop there. */
const steps = [
  {
    cls: 'b5-found',
    step: 'Step 1',
    title: 'Found',
    /* `potential clients`, not `homeowners` (Leon, Nov 5 — C2): the page
       addresses architects too, and theirs are not only homeowners. */
    body: 'Posts written for potential clients — not just for other designers scrolling.',
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
    /* Leon's words (Nov 5): the line before this said `Whoever gets in touch has
       already seen how you work`, which implied every enquiry starts with a
       Bauhly post. This one says what the posts are for and stops. */
    body: 'Help potential clients understand how you work before they get in touch.',
    Glyph: GlyphHouse,
  },
]

/* the same three, held to the same limit: what a post shows, and no result */
const ES = {
  title: 'Te encuentran. Confían. Te contratan.',
  sub: 'Nadie contrata a un desconocido. Cada post muestra a los clientes adecuados un poco más de cómo piensas.',
  steps: [
    { step: 'Paso 1', title: 'Te encuentran', body: 'Posts escritos para clientes potenciales, no solo para otros interioristas que pasan por ahí.' },
    { step: 'Paso 2', title: 'Confían en ti', body: 'Ven cómo piensas antes de llamarte. La confianza se acumula, post tras post.' },
    { step: 'Paso 3', title: 'Te contratan', body: 'Ayuda a los clientes potenciales a entender cómo trabajas antes de que contacten contigo.' },
  ],
}

export default function S5Journey() {
  const [lang] = useLang()
  const es = lang === 'es'
  return (
    /* `results` is the anchor the footer's `Results` link has always pointed
       at. The section that carried it is retired (landing audit, S1) and this
       is the page's statement of the result now, so the link lands here. */
    <section className="block b5" id="results">
      <div className="container">
        <motion.h2 className="block-title" {...pop}>
          {es ? ES.title : 'Found. Trusted. Hired.'}
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.08)}>
          {es ? ES.sub : 'Nobody hires a stranger. Every post shows the right clients a little more of how you think.'}
        </motion.p>
        <div className="b5-cards">
          {steps.map((base, i) => {
            const s = es ? { ...base, ...ES.steps[i] } : base
            return (
            <motion.div key={s.cls} className={`b5-card ${s.cls}`} {...slide(i, i === 1 ? -1 : 1)}>
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
            )
          })}
        </div>
      </div>
    </section>
  )
}
