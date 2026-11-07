import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { useLang } from '../lib/lang.js'
import { startCapture } from '../components/HeroCapture.jsx'

/* ── WHAT THIS BLOCK NO LONGER SAYS (Leon, Nov 5 — landing audit, E1) ──────
 * Four things were on these cards that nobody has confirmed, and each is gone
 * rather than reworded, because the honest replacement for an unconfirmed
 * claim is not a softer one:
 *   · the struck-through `€39` and `Launch price — yours to keep` — "the
 *     wording implies €39 is a discounted introductory price and that
 *     customers can retain it permanently. Neither condition has been
 *     confirmed." (D5a)
 *   · the guarantee band, `Not convinced after 2 months? One month back.` —
 *     "not true or approved" (D5). `Cancel anytime` sat inside it and went
 *     with it; it is one of the things still to confirm.
 *   · `Project files → polished posts · First on Studio+`, its note, and the
 *     two taglines (`The strategy` / `The strategy, plus the making`) — "post
 *     generation is now a core part of Bauhly, not a waitlisted extra. Remove
 *     any messaging suggesting otherwise." (D3)
 * NOTHING WAS ADDED. The first card does not gain a line saying it makes
 * posts, because what each tier includes — and what the tiers are called, and
 * which prices may be shown at all — is P1–P9 in docs/LANDING_AUDIT_PHASE1.md
 * and has not been answered. The prices, names and remaining features below
 * are the ones that were already here, and they are still assumptions.
 * `was`, `tag`, `badge` and `note` are still read by the markup, so a
 * confirmed value can come back as data without touching the layout. */
const tiers = [
  {
    name: 'Studio',
    price: '€29',
    featured: true,
    flag: 'Recommended',
    cta: 'Analyse my profile →',
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
    price: '€59',
    startingAt: true,
    badge: 'Early access',
    featured: false,
    cta: 'Join the waitlist',
    listLabel: 'Everything in Studio, plus',
    items: [
      'Auto-publishing — plans go live on their own',
      'LinkedIn, coming to Studio+ first',
      'Up to 3 profiles',
    ],
  },
]

/* Translated only. The names, prices and features are the same unconfirmed ones, for the
   same P1–P9 decisions; the amounts are written the way Spain writes them. */
const ES = {
  title: 'Un estratega en tu equipo. Sin nómina.',
  sub: 'Todo tu mes de contenido, planificado, por menos de una hora facturable.',
  starting: 'Desde',
  per: '/mes',
  makersLabel: 'Quién está detrás',
  makersLine: 'Creado por el equipo del Content Strategy Hub de ',
  tiers: [
    {
      price: '29 €',
      flag: 'Recomendado',
      cta: 'Analizar mi perfil →',
      listLabel: 'Qué incluye',
      items: [
        'Un estratega con IA que aprende de tu estudio',
        'Tu semana planificada cada lunes, a tu ritmo',
        'Textos, ganchos y horarios con tu voz',
        'El motivo detrás de cada post',
        'Una memoria creciente de tus proyectos y resultados',
      ],
    },
    {
      price: '59 €',
      badge: 'Acceso anticipado',
      /* short on purpose: a button does not wrap, and the longer `Apúntate a la lista de
         espera` pushed the card's contents past the edge of a 320 screen. MEASURED */
      cta: 'Únete a la lista',
      listLabel: 'Todo lo de Studio, y además',
      items: [
        'Publicación automática: los planes salen solos',
        'LinkedIn, primero en Studio+',
        'Hasta 3 perfiles',
      ],
    },
  ],
}

export default function S7Pricing() {
  const [lang] = useLang()
  const es = lang === 'es'
  /* not mounted in the live app (invite-only); kept in step with the reference */
  const goSignup = () => startCapture()

  return (
    <section className="block b7" id="pricing">
      <div className="container">
        <motion.h2 className="block-title b7-title" {...pop}>
          {es ? ES.title : 'A strategist on your team. Not a salary.'}
        </motion.h2>
        <motion.p className="b7-sub" {...popDelayed(0.06)}>
          {es ? ES.sub : 'Your whole month of content, planned — for less than one billable hour.'}
        </motion.p>

        <div className="price-grid">
          {tiers.map((base, i) => {
            const t = es ? { ...base, ...ES.tiers[i] } : base
            return (
            <motion.div
              key={t.name}
              className={`price-card ${t.featured ? 'featured' : ''}`}
              {...popDelayed(0.08 + i * 0.08)}
            >
              {t.flag && <span className="price-flag">{t.flag}</span>}
              <span className="price-plan">{t.name}</span>
              {t.tag && <span className="price-tagline">{t.tag}</span>}
              <div className="b7-price">
                <span className="b7-qualifier">
                  {t.was && <span className="b7-was">{t.was}</span>}
                  {t.startingAt && <span className="b7-starting">{es ? ES.starting : 'Starting at'}</span>}
                </span>
                <span className="b7-amount-row">
                  <span className="b7-amount">{t.price}</span>
                  <span className="b7-per">{es ? ES.per : '/month'}</span>
                </span>
              </div>
              {/* the row is kept when it is empty: both cards hang their lists
                  from it — 19px of text with 36px under it at 1280 — and a card
                  without one would start its list that much higher than its
                  neighbour. MEASURED after the change: both `What's included`
                  labels sit at the same y, and so do both buttons. */}
              <span className={`b7-launch ${t.featured ? '' : 'b7-launch-alt'}`}>{t.badge || '\u00a0'}</span>

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
            )
          })}
        </div>

        <motion.div className="b7-makers" {...popDelayed(0.3)}>
          <span className="b7-makers-label">{es ? ES.makersLabel : <>Who&rsquo;s behind this</>}</span>
          <p className="b7-makers-line">
            {es ? ES.makersLine : 'Built by the team behind the Content Strategy Hub at '}
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
