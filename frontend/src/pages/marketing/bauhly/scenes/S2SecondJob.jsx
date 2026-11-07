import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { IconCarouselStack, IconPlay } from '../svg/glyphs.jsx'
import { useLang } from '../lib/lang.js'

const HOLD = 6000

/* Posts and carousels only, matching what the product actually plans — see
   `FORMATS` in data/demo.js. Monday and Saturday were Reels/Stories; the Reel
   branch below stays for when they come back.
   No `likes` on a day any more, and no "right now" about what homeowners are
   asking: neither was known (Leon, Nov 5 — landing audit, E1). */
const week = [
  {
    d: 'Mon',
    f: 'Carousel',
    time: '18:30',
    hook: 'The 40 cm that saved this kitchen',
    why: 'Clients don’t hire photos — they hire judgment. One visible decision proves years of it.',
    img: '/assets/photo/canal-house-01-hero.jpg',
  },
  {
    d: 'Tue',
    f: 'Carousel',
    time: '12:30',
    hook: 'Expensive wood isn’t always the answer',
    why: 'Homeowners ask this exact question — answer it honestly and you’re the expert they remember.',
    img: '/assets/photo/canal-house-02-detail-ash.jpg',
  },
  {
    d: 'Wed',
    f: 'Post',
    time: '17:00',
    hook: 'The wall was crooked. Good.',
    why: 'Anyone can post a reveal. Showing the messy middle is what makes clients trust you with theirs.',
    img: '/assets/photo/canal-house-03-site.jpg',
  },
  {
    d: 'Thu',
    f: 'Post',
    time: '18:30',
    hook: 'Paint would have ruined this wall',
    why: 'Specific expertise is unmistakable. Generic inspiration is invisible.',
    img: '/assets/photo/canal-house-04-desk.jpg',
  },
  {
    d: 'Fri',
    f: 'Carousel',
    time: '12:00',
    hook: 'What clients say vs. what they mean',
    why: 'Future clients recognize themselves — and picture working with you.',
    img: '/assets/photo/piece-sketch.jpg',
  },
  {
    d: 'Sat',
    f: 'Carousel',
    time: '11:00',
    hook: 'The detail 99% of people walk past',
    why: 'A trained eye, proven in ten seconds. Weekend effort: near zero.',
    img: '/assets/photo/piece-swatches.jpg',
  },
  {
    d: 'Sun',
    f: 'Post',
    time: '19:00',
    hook: 'What actually happened this week',
    why: 'Honesty is the post that makes the other six believable.',
    img: '/assets/photo/sys-work.jpg',
  },
]

/* `f` stays English, because the markup below asks it which icon to draw. `label` is what shows */
const ES = {
  delivery: 'Y además planifica tu semana',
  title: 'Tu semana, planificada. Sin adivinar.',
  sub: 'Publica los siete o elige tres: Bauhly se adapta a tu ritmo y sube el listón poco a poco cuando la constancia ya es fácil.',
  carousel: 'Carrusel',
  days: [
    { d: 'Lun', label: 'Carrusel', hook: 'Los 40 cm que salvaron esta cocina', why: 'Los clientes no contratan fotos: contratan criterio. Una decisión visible demuestra años de experiencia.' },
    { d: 'Mar', label: 'Carrusel', hook: 'La madera cara no siempre es la respuesta', why: 'Los propietarios preguntan justo esto. Responde con honestidad y te recordarán como quien sabe.' },
    { d: 'Mié', label: 'Post', hook: 'La pared estaba torcida. Mejor.', why: 'Cualquiera publica un resultado final. Enseñar la parte caótica es lo que hace que los clientes te confíen la suya.' },
    { d: 'Jue', label: 'Post', hook: 'La pintura habría arruinado esta pared', why: 'El conocimiento concreto es inconfundible. La inspiración genérica es invisible.' },
    { d: 'Vie', label: 'Carrusel', hook: 'Lo que dicen los clientes y lo que quieren decir', why: 'Tus futuros clientes se reconocen y se imaginan trabajando contigo.' },
    { d: 'Sáb', label: 'Carrusel', hook: 'El detalle que el 99 % de la gente pasa por alto', why: 'Un ojo entrenado, demostrado en diez segundos. Esfuerzo de fin de semana: casi cero.' },
    { d: 'Dom', label: 'Post', hook: 'Lo que pasó de verdad esta semana', why: 'La honestidad es el post que hace creíbles los otros seis.' },
  ],
  notes: [
    { tag: 'Estrategia, no suposiciones.', when: 'Cada post tiene un motivo.', why: 'Cada post explica por qué está ahí: qué muestra de tu estudio y de qué parte de tu material nace. Bauhly planifica primero el tipo de post que menos has mostrado.' },
    { tag: 'Memoria', when: 'Nada de lo que compartes se pierde.', why: 'Todo lo que capturas se guarda. Cuando no tienes nada nuevo, Bauhly parte del material que compartiste antes y aún no has usado.' },
  ],
}

export default function S2SecondJob() {
  const [lang] = useLang()
  const es = lang === 'es'
  const [active, setActive] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setActive((a) => (a + 1) % week.length), HOLD)
    return () => clearInterval(id)
  }, [reduced])

  const dayAt = (i) => (es ? { ...week[i], ...ES.days[i] } : week[i])
  const day = dayAt(active)

  return (
    <section className="block b2" id="plan">
      <div className="container">
        <motion.div className="wk-delivery" {...pop}>
          <span className="wk-bell" aria-hidden="true" />
          {/* was `Monday, 08:00 — your week just arrived`. The plan is what
              Bauhly ALSO does now, after the post (Leon, Nov 5 — D1, S5), and
              this is the line that says so. */}
          {es ? ES.delivery : 'And it plans your week'}
        </motion.div>

        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          {es ? ES.title : 'Your week, planned. Zero guessing.'}
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.1)}>
          {es ? ES.sub : 'Post all seven or pick three — Bauhly plans around your pace, and gently raises the bar as consistency gets easy.'}
        </motion.p>

        <motion.div className="wk-rail" {...popDelayed(0.14)}>
          {week.map((_, i) => dayAt(i)).map((w, i) => (
            <button
              key={week[i].d}
              className={`wk-tab ${active === i ? 'active' : ''}`}
              onClick={() => setActive(i)}
              aria-pressed={active === i}
            >
              <span className="wk-tab-d">{w.d}</span>
              <span className="wk-tab-f">{w.label ?? w.f}</span>
            </button>
          ))}
        </motion.div>

        <div className="wk-layout">
          <div className="wk-brief">
            <AnimatePresence mode="wait">
              <motion.article
                key={active}
                className="wk-card"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
              >
                <header className="wk-card-head">
                  <span className="wk-chip wk-chip-active">{day.d} · {day.time}</span>
                  <span className="wk-chip">{day.label ?? day.f}</span>
                </header>
                <h3 className="wk-hook">“{day.hook}”</h3>
                <p className="wk-why-line">{day.why}</p>
              </motion.article>
            </AnimatePresence>
          </div>

          <div className="ig-post">
            <div className="ig-head">
              <span className="ig-avatar" aria-hidden="true" />
              <p className="ig-user">bauhly</p>
            </div>
            <div className="ig-photo">
              <AnimatePresence mode="wait">
                <motion.img
                  key={day.img}
                  src={day.img}
                  alt=""
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                />
              </AnimatePresence>
              {day.f === 'Reel' && (
                <span className="ig-format" aria-label="Reel">
                  <IconPlay size={15} />
                </span>
              )}
              {day.f === 'Carousel' && (
                <>
                  <span className="ig-format" aria-label={es ? ES.carousel : 'Carousel'}>
                    <IconCarouselStack size={15} />
                  </span>
                  <span className="ig-dots" aria-hidden="true">
                    <span className="ig-dot active" />
                    <span className="ig-dot" />
                    <span className="ig-dot" />
                  </span>
                </>
              )}
            </div>
            {/* WHAT USED TO BE HERE: `liked by 1,204 others`, a different number
                on each of the seven days (Leon, Nov 5 — landing audit, E1). None
                of them was a measurement of anything, and this page shows no
                invented metric (CLAUDE.md §2). The caption stays: it is the
                post's own words. */}
            <p className="ig-caption">
              <b>bauhly</b> {day.hook}
            </p>
          </div>
        </div>

        {/* ── TWO SECTIONS, FOLDED INTO TWO PANELS (Leon, Nov 5 — landing
            audit, S5; wording approved) ─────────────────────────────────
            `Strategy, not guesswork.` and `Nothing valuable gets lost.` were
            each a full section about the plan, which made planning the
            subject of four sections in a row on a page whose promise is the
            post. They are two short panels under the planner now, and each
            says only what the product does today: a post carries its reason
            and the least-shown kind is planned first (`focusOrderOf` in
            lib/planning.js); a capture not yet in a plan is what the next
            run is made from.
            WHAT WENT WITH THEM: the `market` card and its mosaic, `what
            actually works`, `across the industry`, `what your audience cares
            about right now`, `Who your audience really is`, `right when your
            audience is asking about exactly that` — none has anything real
            behind it (docs/LANDING_AUDIT_PHASE1.md, claims audit).
            REUSED, NOT REDRAWN: the grid, the card and its label are the
            Intelligence section's own (`.intel-inputs`, `.intel-card`,
            `.intel-card-tag`), and the two type sizes are its output card's.
            The one new rule is where the pair sits (`.plan-notes`).
            `intelligence` is the anchor the footer's `The evidence` has
            always pointed at. `Memory` is the retired section's own name,
            added so the two labels line up — the one word here Leon has not
            seen. */}
        <div className="intel-inputs plan-notes" id="intelligence">
          <motion.article className="intel-card" {...popDelayed(0.06)}>
            <span className="intel-card-tag">{es ? ES.notes[0].tag : 'Strategy, not guesswork.'}</span>
            <h3 className="intel-out-when">{es ? ES.notes[0].when : 'Every post has a reason.'}</h3>
            <p className="intel-out-why">
              {es ? ES.notes[0].why : 'Each post comes with why it is there: what it shows about your studio and what in your own material it is built from. Bauhly plans first the kind of post you have shown least.'}
            </p>
          </motion.article>
          <motion.article className="intel-card" {...popDelayed(0.14)}>
            <span className="intel-card-tag">{es ? ES.notes[1].tag : 'Memory'}</span>
            <h3 className="intel-out-when">{es ? ES.notes[1].when : 'Nothing you share gets lost.'}</h3>
            <p className="intel-out-why">
              {es ? ES.notes[1].why : 'Everything you capture is kept. When you have nothing new, Bauhly builds from material you shared earlier and have not used yet.'}
            </p>
          </motion.article>
        </div>
      </div>
    </section>
  )
}
