import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { IconCarouselStack, IconPlay } from '../svg/glyphs.jsx'

const HOLD = 6000

const week = [
  {
    d: 'Mon',
    f: 'Reel',
    time: '18:30',
    hook: 'The 40 cm that saved this kitchen',
    why: 'Clients don’t hire photos — they hire judgment. One visible decision proves years of it.',
    img: '/assets/photo/canal-house-01-hero.jpg',
    likes: '1,204',
  },
  {
    d: 'Tue',
    f: 'Carousel',
    time: '12:30',
    hook: 'Expensive wood isn’t always the answer',
    why: 'Homeowners are asking this exact question right now — answer it honestly and you’re the expert they remember.',
    img: '/assets/photo/canal-house-02-detail-ash.jpg',
    likes: '892',
  },
  {
    d: 'Wed',
    f: 'Story',
    time: '17:00',
    hook: 'The wall was crooked. Good.',
    why: 'Anyone can post a reveal. Showing the messy middle is what makes clients trust you with theirs.',
    img: '/assets/photo/canal-house-03-site.jpg',
    likes: '347',
  },
  {
    d: 'Thu',
    f: 'Post',
    time: '18:30',
    hook: 'Paint would have ruined this wall',
    why: 'Specific expertise is unmistakable. Generic inspiration is invisible.',
    img: '/assets/photo/canal-house-04-desk.jpg',
    likes: '1,560',
  },
  {
    d: 'Fri',
    f: 'Carousel',
    time: '12:00',
    hook: 'What clients say vs. what they mean',
    why: 'Future clients recognize themselves — and picture working with you.',
    img: '/assets/photo/piece-sketch.jpg',
    likes: '2,013',
  },
  {
    d: 'Sat',
    f: 'Story',
    time: '11:00',
    hook: 'The detail 99% of people walk past',
    why: 'A trained eye, proven in ten seconds. Weekend effort: near zero.',
    img: '/assets/photo/piece-swatches.jpg',
    likes: '498',
  },
  {
    d: 'Sun',
    f: 'Post',
    time: '19:00',
    hook: 'What actually happened this week',
    why: 'Honesty is the post that makes the other six believable.',
    img: '/assets/photo/sys-work.jpg',
    likes: '731',
  },
]

export default function S2SecondJob() {
  const [active, setActive] = useState(0)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setActive((a) => (a + 1) % week.length), HOLD)
    return () => clearInterval(id)
  }, [reduced])

  const day = week[active]

  return (
    <section className="block b2" id="plan">
      <div className="container">
        <motion.div className="wk-delivery" {...pop}>
          <span className="wk-bell" aria-hidden="true" />
          Monday, 08:00 — your week just arrived
        </motion.div>

        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          Your week, planned. Zero guessing.
        </motion.h2>
        <motion.p className="block-sub" {...popDelayed(0.1)}>
          Post all seven or pick three — Bauhly plans around your pace, and gently raises the
          bar as consistency gets easy.
        </motion.p>

        <motion.div className="wk-rail" {...popDelayed(0.14)}>
          {week.map((w, i) => (
            <button
              key={w.d}
              className={`wk-tab ${active === i ? 'active' : ''}`}
              onClick={() => setActive(i)}
              aria-pressed={active === i}
            >
              <span className="wk-tab-d">{w.d}</span>
              <span className="wk-tab-f">{w.f}</span>
            </button>
          ))}
        </motion.div>

        <div className="wk-layout">
          <div className="wk-brief">
            <AnimatePresence mode="wait">
              <motion.article
                key={day.d}
                className="wk-card"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
              >
                <header className="wk-card-head">
                  <span className="wk-chip wk-chip-active">{day.d} · {day.time}</span>
                  <span className="wk-chip">{day.f}</span>
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
                  <span className="ig-format" aria-label="Carousel">
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
            <p className="ig-likes">
              liked by <b>{day.likes} others</b>
            </p>
            <p className="ig-caption">
              <b>bauhly</b> {day.hook}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
