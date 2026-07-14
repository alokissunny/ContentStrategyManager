import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/* one illustration per step, in the page's 1.5–2px line-glyph voice */
function GlyphAnalyze() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="7" y="8" width="24" height="19" rx="2" {...S} />
      <path d="M12 22l5-5 4 3 5-6" {...S} />
      <circle cx="30" cy="30" r="8" {...S} />
      <path d="M36 36l5 5" {...S} />
    </svg>
  )
}

function GlyphFocus() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="16" {...S} />
      <circle cx="24" cy="24" r="7" {...S} />
      <circle cx="24" cy="24" r="1.6" fill="currentColor" stroke="none" />
      <path d="M24 4v5M24 39v5M4 24h5M39 24h5" {...S} />
    </svg>
  )
}

function GlyphStrategy() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M7 11l15 12M41 11L26 23" {...S} />
      <path d="M24 24v14" {...S} />
      <circle cx="24" cy="24" r="3.4" {...S} />
      <circle cx="7" cy="11" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="41" cy="11" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function GlyphIdeas() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="8" y="16" width="20" height="18" rx="2" {...S} />
      <path d="M13 27l4-4 3 2 4-5" {...S} />
      <path d="M35 8l1.8 4.6L41 14l-4.2 1.8L35 20l-1.8-4.2L29 14l4.2-1.4z" {...S} />
    </svg>
  )
}

function GlyphWeek() {
  return (
    <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
      <rect x="8" y="11" width="32" height="28" rx="3" {...S} />
      <path d="M8 19h32M16 7v6M32 7v6" {...S} />
      <path d="M15 27l3 3 6-6" {...S} />
      <path d="M28 33h7" {...S} />
    </svg>
  )
}

const steps = [
  {
    n: '01',
    shape: 'circle',
    Glyph: GlyphAnalyze,
    title: 'Analyze your Instagram',
    body: 'Bauhly reads your work and your feed, and finds the opportunities you’re already sitting on.',
  },
  {
    n: '02',
    shape: 'quarter',
    Glyph: GlyphFocus,
    title: 'Set this week’s focus',
    body: 'Tell it what you’re working on, what to promote, how much time you have — or hand it over entirely. You’re always in control.',
    chip: '“I don’t have any ideas”',
  },
  {
    n: '03',
    shape: 'leaf',
    Glyph: GlyphStrategy,
    title: 'Build your strategy',
    body: 'Your direction meets what your audience already cares about — and becomes a focused weekly plan.',
  },
  {
    n: '04',
    shape: 'half',
    Glyph: GlyphIdeas,
    title: 'Never run out of ideas',
    body: 'Out of inspiration? Bauhly reaches back into your past projects and finds the story people are ready to hear today.',
    accent: true,
  },
  {
    n: '05',
    shape: 'square',
    Glyph: GlyphWeek,
    title: 'Receive your week',
    body: 'Ready-to-create posts — format, timing and reasoning included. Your week decided upfront, not the night before.',
  },
]

export default function S3Reframe() {
  return (
    <section className="block b3" id="how">
      <div className="container">
        <motion.span className="b3-eyebrow" {...pop}>
          How it works
        </motion.span>
        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          How Bauhly builds your week
        </motion.h2>
        <motion.p className="b3-sub" {...popDelayed(0.12)}>
          From your Instagram to a strategic week of content — in just a few guided steps.
        </motion.p>

        <ol className="b3-flow">
          {steps.map((s, i) => (
            <motion.li
              key={s.n}
              className={`b3-node ${i % 2 === 0 ? 'is-left' : 'is-right'} ${s.accent ? 'is-accent' : ''}`}
              {...slide(0, i % 2 === 0 ? -1 : 1)}
            >
              <div className="b3-card">
                <div className="b3-illo">
                  <s.Glyph />
                </div>
                <span className="b3-step-label">Step {s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.chip && <span className="b3-chip">{s.chip}</span>}
              </div>
              <span className={`b3-marker b3-marker-${s.shape}`} aria-hidden="true" />
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}
