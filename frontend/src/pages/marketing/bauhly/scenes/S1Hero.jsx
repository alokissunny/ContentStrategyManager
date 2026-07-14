import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { heroPop } from '../lib/motion.js'
import Nav from '../components/Nav.jsx'

const HOLD_MS = 3200
const MOVE_MS = 900

/* each slot renders at PEEK% of the stage's height instead of 100% —
   the leftover space is split evenly above/below the active slot, so
   at rest you see a sliver of both the previous and next photo */
const PEEK = 0.78

const frames = [
  {
    id: 'struggle',
    img: '/assets/photo/sys-night.jpg',
    tag: '“It’s Sunday night. I still don’t know what to post.”',
  },
  {
    id: 'work',
    img: '/assets/photo/sys-work.jpg',
    tag: '“The project was stunning. The feed barely noticed.”',
  },
  {
    id: 'learning',
    img: '/assets/photo/sys-sorting.jpg',
    tag: 'Bauhly studies your projects, your audience, what worked.',
  },
]

const N = frames.length
const REPEAT = 3 // duplicate the set 3x so there's always real content peeking on both sides
const BASE = N // we scroll through the middle copy, so both neighbors always exist

/* Builds a percentage keyframe track for a continuous vertical marquee
   where the active frame is vertically CENTERED in the stage (not
   top-aligned) — slot k's center is placed at the stage's own center,
   expressed as a %-of-track transform so it's viewport-independent. */
function useMarquee(n) {
  return useMemo(() => {
    const trackLen = n * REPEAT
    const total = n * (HOLD_MS + MOVE_MS)

    const yForSlot = (k) => (100 * (0.5 - PEEK * (k + 0.5))) / (trackLen * PEEK)

    const values = [yForSlot(BASE)]
    const times = [0]
    const eases = []
    let t = 0
    for (let j = 0; j < n; j++) {
      t += HOLD_MS
      values.push(yForSlot(BASE + j))
      times.push(t / total)
      eases.push('linear')
      t += MOVE_MS
      values.push(yForSlot(BASE + j + 1))
      times.push(t / total)
      eases.push('easeInOut')
    }
    return { values, times, eases, duration: total / 1000, trackLen }
  }, [n])
}

function HeroDeck() {
  const reduced = useReducedMotion()
  const { values, times, eases, duration, trackLen } = useMarquee(N)
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setActiveIdx((a) => (a + 1) % N), HOLD_MS + MOVE_MS)
    return () => clearInterval(id)
  }, [reduced])

  const track = reduced ? frames : Array.from({ length: trackLen }, (_, i) => frames[i % N])

  return (
    <div className="hdeck">
      <div className="hdeck-stage">
        <motion.div
          className="hdeck-track"
          style={{ height: `${trackLen * 100 * PEEK}%` }}
          animate={reduced ? { y: `${values[0]}%` } : { y: values.map((v) => `${v}%`) }}
          transition={
            reduced ? { duration: 0 } : { duration, times, ease: eases, repeat: Infinity }
          }
        >
          {track.map((f, i) => {
            const isActive = i % N === activeIdx
            return (
              <div
                className="hdeck-slot"
                key={`${f.id}-${i}`}
                style={{ height: `${100 / trackLen}%` }}
              >
                <div className="hdeck-card">
                  <img
                    className={`hdeck-img ${isActive ? 'is-active' : ''}`}
                    src={f.img}
                    alt=""
                  />
                  <AnimatePresence>
                    {isActive && (
                      <motion.span
                        className="hdeck-tag"
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.15 }}
                      >
                        {f.tag}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )
          })}
        </motion.div>
      </div>
    </div>
  )
}

export default function S1Hero() {
  const nav = useNavigate()

  return (
    <section className="h1s">
      <Nav />
      <span className="h1s-orb" aria-hidden="true" />
      <div className="container block-grid h1s-inner">
        <div className="h1s-copy">
          <motion.h1 className="h1s-title" {...heroPop(0)}>
            Your studio&rsquo;s Instagram. Planned every Monday.
          </motion.h1>
          <motion.p className="h1s-lead" {...heroPop(0.05)}>
            Built for{' '}
            <span className="hl-designers">
              interior designers
              <svg viewBox="0 0 220 14" aria-hidden="true" preserveAspectRatio="none">
                <path
                  d="M4 9 C 50 3, 110 12, 216 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M14 12 C 70 8, 150 13, 205 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  opacity="0.55"
                />
              </svg>
            </span>
          </motion.p>
          <motion.p className="h1s-sub" {...heroPop(0.12)}>
            Bauhly studies your projects and your market, then hands you a strategic week of
            posts in minutes — captions, timing, and the reason behind each one.
          </motion.p>

          <motion.div className="h1s-ctas" {...heroPop(0.2)}>
            <button
              className="cta cta-ink h1s-main-cta"
              onClick={() => nav('/auth', { state: { mode: 'signup' } })}
            >
              Analyze my profile →
            </button>
          </motion.div>
        </div>

        <motion.div className="h1s-stage" {...heroPop(0.25)}>
          <HeroDeck />
          <div className="hero-static" aria-hidden="true">
            {frames.map((f, i) => (
              <figure key={f.id} className={`hstat hstat-${i + 1}`}>
                <img src={f.img} alt="" />
              </figure>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
