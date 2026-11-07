import { motion } from 'motion/react'
import { pop, popDelayed } from '../lib/motion.js'
import { useLang } from '../lib/lang.js'

const faqs = [
  {
    q: 'Do I need to be good at social media?',
    a: 'No — that’s the point. You stay the designer. Bauhly does the strategy: what to post, in which format, and why. You bring the projects and the judgment you already have.',
  },
  {
    q: 'How does it learn my style?',
    /* ── ONLY WHAT IS IMPLEMENTED (Leon, Nov 5) ───────────────────────────
       This said Bauhly reads `your past posts and how your audience responds`
       and that `the voice stays yours`. Neither is in the product: nothing
       reads responses without a connected account, and the post composer
       takes no voice setting (lib/firstpost.js). VERIFIED in the code, and
       these three are what a post is actually made from: the studio's own
       captures (words and photographs), the Brand Kit's colours and faces
       (`kitColours`, `saveLookToKit`), and the layout kept on the review
       screen (`postPrefs.layout`, read by the next run). */
    a: 'From what you give it, not a questionnaire. A post is built from your own photos and words, in the colours and typefaces of your Brand Kit. When you review a post you can change its layout, type and colours — and what you save is used for the next ones.',
  },
  {
    q: 'What do I get in the first week?',
    /* ── CAPTURE FIRST (Leon, Nov 5) ──────────────────────────────────────
       This described the old road: subscribe, have a profile analysed, get a
       full week's plan the same day. The approved road starts with the
       studio's own material and ends in one post to review.
       B2 DEPENDENCY, NOT YET SAID HERE: `…and add it to your calendar`. That
       sentence joins this answer the day the calendar interaction works, and
       not before (Leon: "do not present this as functionality that already
       works"). */
    a: 'You start by sharing something from your work — photos, a voice note or a few lines. Bauhly turns it into a post for you to review and adjust. No blank page, no setup week.',
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
    /* the platform is not named on this page — CLAUDE.md §2 (landing audit, E2).
       Only that clause changed; the LinkedIn sentence is a roadmap claim still
       waiting on a pricing decision (P7 in docs/LANDING_AUDIT_PHASE1.md). */
    a: 'One platform first — the page you already post to. It’s where interior design clients actually look, and going deep on one platform beats being shallow on three. LinkedIn is next: your plan will extend to it, not restart.',
  },
]

/* in the same order, saying the same things and no more: the comments above on what each
   answer may claim hold for these too */
const FAQS_ES = [
  {
    q: '¿Tengo que saber de redes sociales?',
    a: 'No, de eso se trata. Tú sigues siendo quien diseña. Bauhly se ocupa de la estrategia: qué publicar, en qué formato y por qué. Tú aportas los proyectos y el criterio que ya tienes.',
  },
  {
    q: '¿Cómo aprende mi estilo?',
    a: 'De lo que le das, no de un cuestionario. Cada post se crea con tus propias fotos y palabras, en los colores y tipografías de tu Brand Kit. Al revisar un post puedes cambiar el diseño, la tipografía y los colores, y lo que guardas se usa en los siguientes.',
  },
  {
    q: '¿Qué recibo la primera semana?',
    a: 'Empiezas compartiendo algo de tu trabajo: fotos, una nota de voz o unas líneas. Bauhly lo convierte en un post para que lo revises y lo ajustes. Sin página en blanco y sin semana de configuración.',
  },
  {
    q: '¿Tengo que publicar todos los días?',
    a: 'No. Empieza con dos o tres posts a la semana, lo que de verdad te encaje. Bauhly se adapta a tu ritmo y recomienda más poco a poco cuando la constancia ya es fácil, y siempre puedes publicar más cuando quieras. A la larga, lo constante gana a lo espectacular: la constancia es lo que se acumula.',
  },
  {
    q: '¿Cuánto tiempo lleva cada semana?',
    a: 'Minutos. Bauhly hace la parte que lleva tiempo (decidir qué publicar, cuándo y por qué), así que tu plan llega listo cada lunes. Sin calendario en blanco, sin dudas y sin deberes de estrategia.',
  },
  {
    q: '¿Escribe mis textos?',
    a: 'Te da una dirección para el texto y un primer borrador con tu voz; tú lo editas y lo apruebas. Nada se publica por ti ni sin ti.',
  },
  {
    q: '¿Qué pasa si me salto una semana?',
    a: 'Nada malo. Sin rachas y sin culpa. El siguiente plan retoma desde donde estás: se organiza en torno a tu carga de trabajo real, no a una ideal.',
  },
  {
    q: '¿Qué plataformas cubre?',
    a: 'Primero una: la página en la que ya publicas. Es donde de verdad miran los clientes de interiorismo, y profundizar en una plataforma es mejor que quedarse en la superficie de tres. LinkedIn es la siguiente: tu plan se ampliará a ella, sin empezar de cero.',
  },
]

export default function S8Faq() {
  const [lang] = useLang()
  const list = lang === 'es' ? FAQS_ES : faqs
  return (
    <section className="block b8" id="questions">
      <div className="container">
        <motion.h2 className="block-title" {...pop}>
          {lang === 'es' ? 'Preguntas, respondidas.' : 'Questions, answered.'}
        </motion.h2>
        <motion.div className="faq" {...popDelayed(0.1)}>
          {list.map((f, i) => (
            <details key={i} className="faq-item" name="faq">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
