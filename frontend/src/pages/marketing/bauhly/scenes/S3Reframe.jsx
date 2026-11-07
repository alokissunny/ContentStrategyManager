import { motion } from 'motion/react'
import { pop, popDelayed, slide } from '../lib/motion.js'
import { useLang } from '../lib/lang.js'

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

/* ── FROM A PROJECT TO A POST, NOT FROM A PAGE TO A WEEK (Leon, Nov 5 —
 * landing audit, S3; wording approved) ───────────────────────────────────
 * These five used to describe how the weekly plan is built, starting with
 * `Analyse your page`. The agreed journey starts with Capture, and the plan is
 * a supporting capability now (D1), so this section tells the road a studio
 * actually walks: share, be asked, get a post, adjust it, keep it.
 * Each step names something the product does today — with one exception,
 * said plainly: 05. The approved line is `Add it to your calendar`, which
 * waits for B2 to be built; `Keep it for your week` is the approved stand-in.
 * Neither is fully true yet (a made post does not reach the calendar), so
 * this is the line to revisit the day B2 lands.
 * THE LAYOUT IS UNTOUCHED: five nodes, the same markers, the same accent on
 * the fourth. The five drawings are the existing five; 03 and 04 swapped
 * theirs, because the picture-with-a-spark is the story being found.
 * THE CHIP MOVED: `"I don't have any ideas"` sat on 02, `Set this week's
 * focus`, which is no longer a step. It is on 03 now. */
const steps = [
  {
    n: '01',
    shape: 'circle',
    Glyph: GlyphAnalyze,
    title: 'Share what you have',
    body: 'Photos, a voice note or a few lines about a project, a decision, or something a client said.',
  },
  {
    n: '02',
    shape: 'quarter',
    Glyph: GlyphFocus,
    title: 'Bauhly asks what it needs',
    body: 'If something is unclear, it asks a short question instead of guessing.',
  },
  {
    n: '03',
    shape: 'leaf',
    Glyph: GlyphIdeas,
    title: 'It finds the story',
    body: 'Your material becomes one post with a clear narrative, slide by slide.',
    /* kept, on the step that answers it (Leon, Nov 5): a studio with no ideas
       does not need one — the story is found in what they shared */
    chip: '“I don’t have any ideas”',
  },
  {
    n: '04',
    shape: 'half',
    Glyph: GlyphStrategy,
    title: 'Review and adjust',
    body: 'Change the layout, type and colours, or edit any slide. What you change shapes the next posts.',
    accent: true,
  },
  {
    n: '05',
    shape: 'square',
    Glyph: GlyphWeek,
    title: 'Keep it for your week',
    body: 'Nothing is published for you.',
  },
]

const ES = {
  eyebrow: 'Cómo funciona',
  title: 'De tu proyecto a un post',
  sub: 'Empieza con lo que tienes. Bauhly le da forma; tú decides qué sale.',
  step: 'Paso',
  steps: [
    { title: 'Comparte lo que tienes', body: 'Fotos, una nota de voz o unas líneas sobre un proyecto, una decisión o algo que dijo un cliente.' },
    { title: 'Bauhly pregunta lo que necesita', body: 'Si algo no está claro, hace una pregunta breve en vez de suponer.' },
    { title: 'Encuentra la historia', body: 'Tu material se convierte en un post con un hilo claro, diapositiva a diapositiva.', chip: '“No tengo ideas”' },
    { title: 'Revisa y ajusta', body: 'Cambia el diseño, la tipografía y los colores, o edita cualquier diapositiva. Lo que cambias da forma a los siguientes posts.' },
    { title: 'Guárdalo para tu semana', body: 'Nada se publica por ti.' },
  ],
}

export default function S3Reframe() {
  const [lang] = useLang()
  const es = lang === 'es'
  return (
    <section className="block b3" id="how">
      <div className="container">
        <motion.span className="b3-eyebrow" {...pop}>
          {es ? ES.eyebrow : 'How it works'}
        </motion.span>
        <motion.h2 className="block-title" {...popDelayed(0.06)}>
          {es ? ES.title : 'From your project to a post'}
        </motion.h2>
        <motion.p className="b3-sub" {...popDelayed(0.12)}>
          {es ? ES.sub : 'Start with what you have. Bauhly does the shaping; you decide what goes out.'}
        </motion.p>

        <ol className="b3-flow">
          {steps.map((base, i) => {
            const s = es ? { ...base, ...ES.steps[i] } : base
            return (
            <motion.li
              key={s.n}
              className={`b3-node ${i % 2 === 0 ? 'is-left' : 'is-right'} ${s.accent ? 'is-accent' : ''}`}
              {...slide(0, i % 2 === 0 ? -1 : 1)}
            >
              <div className="b3-card">
                <div className="b3-illo">
                  <s.Glyph />
                </div>
                <span className="b3-step-label">{es ? ES.step : 'Step'} {s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.chip && <span className="b3-chip">{s.chip}</span>}
              </div>
              <span className={`b3-marker b3-marker-${s.shape}`} aria-hidden="true" />
            </motion.li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
