import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { pop, popDelayed } from '../lib/motion.js'

const tiers = [
  {
    name: 'Studio',
    tag: 'The strategy',
    price: '€29',
    was: '€39',
    badge: 'Launch price — yours to keep',
    featured: true,
    flag: 'Recommended',
    cta: 'Analyze my profile →',
    listLabel: 'What’s included',
    items: [
      'An AI strategist that learns your studio',
      'Your week planned every Monday, at your pace',
      'Captions, hooks and timing in your voice',
      'The reason behind every post',
      'A growing memory of your projects and results',
    ],
  },
  {
    name: 'Studio+',
    tag: 'The strategy, plus the making',
    price: '€59',
    startingAt: true,
    badge: 'Early access',
    featured: false,
    cta: 'Join the waitlist',
    listLabel: 'Everything in Studio, plus',
    items: [
      { text: 'Project files → polished posts', tag: 'First on Studio+' },
      'Auto-publishing — plans go live on their own',
      'LinkedIn, coming to Studio+ first',
      'Up to 3 profiles',
    ],
    note: 'Upload photos, sketches, plans or mood boards — Bauhly presents them in your style, as carousels, reels and posts.',
  },
]

const guarantee = ['No awkward questions', 'No hidden terms', 'Cancel anytime']

export default function S7Pricing() {
  const nav = useNavigate()
  const goSignup = () => nav('/auth', { state: { mode: 'signup' } })

  return (
    <section className="block b7" id="pricing">
      <div className="container">
        <motion.h2 className="block-title b7-title" {...pop}>
          A strategist on your team. Not a salary.
        </motion.h2>
        <motion.p className="b7-sub" {...popDelayed(0.06)}>
          Your whole month of content, planned — for less than one billable hour.
        </motion.p>

        <div className="price-grid">
          {tiers.map((t, i) => (
            <motion.div
              key={t.name}
              className={`price-card ${t.featured ? 'featured' : ''}`}
              {...popDelayed(0.08 + i * 0.08)}
            >
              {t.flag && <span className="price-flag">{t.flag}</span>}
              <span className="price-plan">{t.name}</span>
              <span className="price-tagline">{t.tag}</span>
              <div className="b7-price">
                <span className="b7-qualifier">
                  {t.was && <span className="b7-was">{t.was}</span>}
                  {t.startingAt && <span className="b7-starting">Starting at</span>}
                </span>
                <span className="b7-amount-row">
                  <span className="b7-amount">{t.price}</span>
                  <span className="b7-per">/month</span>
                </span>
              </div>
              <span className={`b7-launch ${t.featured ? '' : 'b7-launch-alt'}`}>{t.badge}</span>

              {t.listLabel && <span className="price-list-label">{t.listLabel}</span>}

              <ul className="price-list">
                {t.items.map((item) => {
                  const text = typeof item === 'string' ? item : item.text
                  const tag = typeof item === 'string' ? null : item.tag
                  return (
                    <li key={text}>
                      <span>{text}</span>
                      {tag && <span className="price-tag">{tag}</span>}
                    </li>
                  )
                })}
              </ul>

              {t.note && <p className="price-note">{t.note}</p>}

              <button
                className={`cta price-cta ${t.featured ? 'cta-primary' : 'cta-ink'}`}
                onClick={goSignup}
              >
                {t.cta}
              </button>
            </motion.div>
          ))}
        </div>

        <motion.div className="g-band" {...popDelayed(0.22)}>
          <span className="g-band-label">Included — our guarantee, in writing</span>
          <h3>Not convinced after 2 months? One month back.</h3>
          <div className="g-band-items">
            {guarantee.map((line) => (
              <span key={line}>✓ {line}</span>
            ))}
          </div>
        </motion.div>

        <motion.div className="b7-makers" {...popDelayed(0.3)}>
          <span className="b7-makers-label">Who&rsquo;s behind this</span>
          <p className="b7-makers-line">
            Built by the team behind the Content Strategy Hub at{' '}
            <span className="hl-underline">
              VistaPrint
              <svg viewBox="0 0 180 12" aria-hidden="true" preserveAspectRatio="none">
                <path
                  d="M3 7 C 44 2, 96 11, 177 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            .
          </p>
        </motion.div>
      </div>
    </section>
  )
}
