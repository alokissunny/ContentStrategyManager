/*
 * The hero's carousel — real posts, drawn by the product's own renderer (Leon,
 * Nov 5 — landing audit, A4).
 *
 * "Use real posts arranged horizontally, moving around with a 3D-like effect
 *  while remaining flat. Use the best layouts from the layout types we've
 *  already defined, mixing different styles… Each post should include text that
 *  supports the narrative of the first section."
 *
 * ── REAL, IN THE ONE WAY THAT COUNTS ─────────────────────────────────────
 * Each card below is `Preview` from LayoutArt.jsx, the only renderer of a layout
 * in this product (decision 517), given a shape from `LAYOUTS` by its id, one of
 * the Brand Kit's three demo palettes and one of the visual themes. So what a
 * visitor sees here is what the Editor draws, and when a layout changes there it
 * changes here. Nothing is a screenshot and nothing is a second drawing of one.
 *
 * ── THE WORDS ARE THE HERO'S ARGUMENT ────────────────────────────────────
 * Read left to right they show what is sitting in a designer's everyday work: a
 * material decision, a site photo, a door on a plan. Thirteen are a designer's posts
 * and five are Bauhly speaking to the designer (decisions 625, 627).
 * NOTHING HERE MAY CLAIM A RESULT OR AN EVENT (Leon, E1 and D8: "Do not invent client
 * names, testimonials, or project results"; Nov 5: "Don't invent project facts or
 * outcomes"). That is why two layouts in the set are not used: `Client Reaction` and
 * `Quote on a Picture` are testimonials by shape.
 *
 * ── THE PICTURES ─────────────────────────────────────────────────────────
 * Only images already in the project (D8a), and materials, site and drawings rather
 * than finished rooms. The tidy flat-lays of oak, stone and linen went (Leon, Nov 5:
 * "too typical of interior design content, generic, and AI-generated"); the drawer of
 * labelled samples is what he asked for instead. The `bathroom` theme is left out for
 * the same reason: it returns a real photograph.
 *
 * ── THE MOTION (Leon, Nov 5: "a gentle, continuous horizontal wave, with every
 *    post passing through the same centered vertical position and smoothly
 *    fading in and out at the edges") ─────────────────────────────────────────
 * Flat cards, facing forward, at one constant speed. One loop writes one
 * transform per card, so it stays on the compositor; nothing here re-renders
 * React after the first paint.
 * Height, size, opacity and place are all read off one number, how many cards
 * this one is from the middle, so they cannot fall out of step (Leon, Nov 5: "driven
 * by each card's position within the carousel"):
 *   size     largest at the middle, easing down with distance. See `sizeAt`.
 *   place    the row is spaced by the cards' SIZES, with a little more air at the
 *            middle and a little less at the sides. See `travelAt`.
 *   height   a barely visible wave that never rests, with neighbours always
 *            opposite, so no three cards ever line up on a slope. See `waveAt`.
 *   edges    each card fades itself, by how near its own edge is to the panel's (see
 *            `fade`), and a lime gradient lies over both sides (`.hcar::before`), so
 *            a card leaves into the background and is never seen cut.
 * ── ON A TABLET OR A PHONE IT IS A STACK, NOT A ROW (Leon, Nov 5) ────────────
 * Below 900px, where the hero is one column, one card is too wide for a row to
 * show more than a card and two slivers. So the same cards stand in a layered
 * stack and take turns at the front: they hold, then swap. See `stacked` below.
 *
 * WHAT WENT, and why: the drum (`rotateY`, perspective) and the lean. Perspective
 * was also the left-edge bug: cards were hidden by where they were BEFORE
 * projection, and projection draws them nearer the middle, so one could vanish
 * while still on screen. The drum also made the speed uneven. Scroll and hover
 * no longer change the speed: "all posts move at a consistent speed".
 * ── AND THE VISITOR CAN TAKE IT (Leon, Nov 6: "more interactive and responsive") ──
 * Hover is a factor on top of the card's size for where it stands (`LIFT`), so the two
 * compose and hovering neither pauses the row nor moves a neighbour. A drag, a horizontal
 * trackpad swipe or a swipe of the thumb moves `at`, the one number everything is read
 * from, so the row, the wave, the fades and the endless wrap all simply carry on. A row
 * coasts to a stop and eases back up to speed from wherever it is. A stack only rests on a
 * whole card, so it settles on the nearest and its clock starts again from there.
 * It stops when it is off screen or behind Capture, where a blurred backdrop over
 * a moving row spends the frame on something nobody can see. Reduced motion draws
 * the same arrangement once and never moves it.
 */
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import { Preview } from '../../../visuallibrary/LayoutArt.jsx'
import { LAYOUTS } from '../../../../data/layouts.js'
import { Wordmark } from '../../../../brand/Logo.jsx'
import { isCaptureOpen } from '../../../../lib/captureUi'
import { useLang } from '../lib/lang.js'

/* the reference's `paintOf({ palette })`: a palette straight to the artwork's ground vars.
   The live app's `paintOf` reads a saved theme, so this card set paints itself */
const paintOf = ({ palette = {} } = {}) => ({
  ...(palette.ground && { '--t-ground-bg': palette.ground }),
  ...(palette.fg && { '--t-ground-fg': palette.fg }),
  ...(palette.accent && { '--t-accent-bg': palette.accent }),
})

const P = '/assets/photo'
const IMG = {
  site: `${P}/canal-house-03-site.jpg`, // timber boards leaning on a wall, a plan on the floor
  ash: `${P}/canal-house-02-detail-ash.jpg`, // pale joinery against rough plaster
  plan: `${P}/piece-plan.jpg`, // a marked-up plan on paper
  sketch: `${P}/studio/02-sketch.webp`, // an armchair sketched in a corner, marked up, low sun on the paper
  concepts: `${P}/studio/01-concept-board.webp`, // three printed directions, a colour disc on each
  samples: `${P}/studio/08-material-samples.webp`, // a drawer of labelled stone, tile and timber samples
  rough: `${P}/mood/raw-materials.png`, // split stone, a rough block, a timber plank
  handStone: `${P}/ph/ph-mon-5.jpg`, // a hand flat on a stone sample
  rawLight: `${P}/mood/raw-light.png`, // low sun raking across a plaster wall
  linens: `${P}/ph/ph-tue-5.jpg`, // two linen samples held up, one in each hand
  print: `${P}/studio/03-photo-in-hand.webp`, // a print of the stripped room, held up in the finished one
  unfinished: `${P}/studio/07-unfinished-room.webp`, // a ladder, boxes, one good window
  drawing: `${P}/ph/ph-mon-3.jpg`, // a drawing close up, a brass hinge resting on it
  floor: `${P}/studio/04-floor-comparison.webp`, // new boards meeting the raw subfloor, two pairs of site shoes
  /* one room from one spot, stripped and finished: the same doorway and the same
     window, side by side in a single picture. `Before & After` draws each half
     of it — see `.hpost--duo` in scenes.css. */
  room: '/assets/demo/suggestions/demo-project-before-after.png',
}

/* two levels of text, for the compositions whose slot only takes one. The artwork
   prints `head` as it is given, so nothing in the renderer changes. */
const line = (head, body) => (
  <>
    <span className="hpost__h">{head}</span>
    <span className="vl-w__b">{body}</span>
  </>
)

/* WHO IS SPEAKING DECIDES THE COLOUR (Leon, Nov 5: "Reserve Bauhly's stronger brand
   colours for posts where Bauhly itself is communicating"). A designer's post is on
   white or a warm light neutral, with ink for its accent, so its one small mark (the pin
   on a drawing) is not a brand colour either. `WARM` sets no ground and takes the
   artwork's own default, its warm paper. Bauhly's five are on ink, olive or slate,
   with the wordmark. The artwork reads these off its host, so each card can wear its own.
   CALCULATED for contrast: main text 5.4:1 or better on all five. The 74% step the
   artwork derives for secondary text is 6.4:1 or better on the others and 3.8:1 on
   slate, so that ground sets it to the full text colour.
   `mark` is the accent as ink, where the artwork's derived one would wash out. */
const PAPER = { ground: 'var(--paper)', fg: 'var(--ink)', accent: 'var(--ink)' }
const WARM = { fg: 'var(--ink)', accent: 'var(--ink)' }
const INK = { ground: 'var(--ink)', fg: 'var(--paper)', accent: 'var(--signature)', mark: 'var(--signature)' }
const OLIVE = { ground: 'var(--hero-ink)', fg: 'var(--paper)', accent: 'var(--signature)', mark: 'var(--signature)' }
/* a muted slate: the brand's blue let down with the page's own grey (Leon, Nov 5: "too
   saturated and visually disconnected"). About #516c94. It took this ground from Signal
   Blue, which took it from orange. White text 5.4:1; against the lime panel 3.9:1, so it
   still stands out. */
const SLATE = { ground: 'color-mix(in srgb, var(--blue-500) 30%, var(--grey))', fg: 'var(--paper)', accent: 'var(--signature)', mark: 'var(--signature)', mute: 'var(--paper)' }

/* ── EACH POST SAYS ONE THING, AND THE PICTURE IS THE EVIDENCE (Leon, Nov 5) ──
   "Every post should communicate something interesting, useful, or relatable…
    Don't invent project facts or outcomes."
   THE RULE THIS ROW IS HELD TO: start from what is actually in the picture, and say
   what a designer knows about it. Not "we rejected the plaster at 4 pm", which is an
   event that never happened, but "check plaster in low sun", which is true of plaster.
   So: no project events, no results, no client reactions, and no number standing in
   for an insight (40 cm, eleven drawings, 90 mm and six weeks all went). The examples
   that remain (a pipe, a sample, a wall) are examples of the trade, not anyone's job.
   ONLY WHAT THE POST NEEDS. No card is obliged to carry a label, a subtitle or a
   mark, and the artwork's automatic rule above a label is off for the whole row.

   ── TWO VOICES ─────────────────────────────────────────────────────────────
   A DESIGNER'S POST ALWAYS HAS A PICTURE AND NEVER THE WORDMARK. BAUHLY'S NEVER HAS A
   PICTURE AND ALWAYS THE WORDMARK (Leon, Nov 5). So a visitor can tell who is speaking
   before reading a word, and "Everyone wants the after", which is about the work rather
   than about posting, is a designer's post on a before and after. Bauhly's five stand
   about one in four along the row, so neither kind bunches up.
   Each of Bauhly's is one frustration from the two user interviews, close to how it was said:
     deciding   "plenty of projects but very little material they consider
                publishable"; struggling "to identify which parts of their work
                might interest their audience" (Buñola·Ortigosa)
     stories    valuable project stories that never get shared (Leon's brief); site
                photos where "nothing gets published" (Buñola·Ortigosa)
     not good   "nothing they photograph or create ever feels good enough to
     enough     share"; site photos where "nothing gets published" (Buñola·Ortigosa)
     time       "She already has the ideas and images, but turning them into
                finished content takes too much time" (46ymedio)
     consistency  "hasn't been actively posting for over a year" (46ymedio)
   No interviewee is named on the page. The last two rest on one interview each.
   Time says nothing of reels or hours: Bauhly does not edit video, and the
   8 hours she quoted were for that. */
/* LAYOUT VARIETY (Leon, Nov 5: "almost identical layouts, making the carousel feel
   repetitive"). Seven of the thirteen designer posts were a picture on top and words below,
   and two pairs of them stood side by side. Three moved, to layouts the library already has
   and with their pictures and words untouched, so now no two neighbours share that shape. */
const POSTS = [
  { id: 'e-hook-statement', key: 'deciding', palette: OLIVE, logo: true, art: { head: 'Plenty of projects.', accent: 'Nothing to post.', body: 'The hard part is knowing which part of your work people want to see.' }, es: { head: 'Muchos proyectos.', accent: 'Nada que publicar.', body: 'Lo difícil es saber qué parte de tu trabajo quiere ver la gente.' } },
  { id: 'b-hook-bleed', key: 'timber', palette: PAPER, imgs: [IMG.site], art: { eyebrow: null, head: 'Timber needs time in the room.', body: 'Cut it too soon and the boards move after they’re fitted.' }, es: { head: 'La madera necesita reposar en la obra.', body: 'Si la cortas demasiado pronto, las tablas se mueven una vez colocadas.' } },
  { id: 'e-edu-split', palette: WARM, imgs: [IMG.rawLight], art: { eyebrow: null, head: 'Check plaster in low sun.', body: 'Raking light shows every trowel mark that midday hides.' }, es: { head: 'Revisa el yeso con el sol bajo.', body: 'La luz rasante revela cada marca de llana que el mediodía esconde.' } },
  /* the words above the board, not under it: see LAYOUT VARIETY below */
  { id: 'n-edu-mood', cls: 'hpost--mood-head', palette: PAPER, imgs: [IMG.ash, IMG.rough, IMG.handStone], art: { eyebrow: null, head: line('Rough walls need quieter timber.', 'Pale, fine grain lets the plaster do the talking.') }, es: { head: line('Pared rugosa, madera tranquila.', 'Un tono claro y una veta fina dejan hablar al yeso.') } },
  { id: 'n-hook-sub', key: 'stories', palette: SLATE, logo: true, art: { head: 'Your best stories never leave the site.', body: 'The detail you fought for. The problem you solved. Nobody hears about them.' }, es: { head: 'Tus mejores historias no salen de la obra.', body: 'El detalle por el que peleaste. El problema que resolviste. Nadie se entera.' } },
  /* the library's own annotated drawing: one mark, one panel, one decision */
  { id: 'e-edu-annotated', palette: PAPER, imgs: [IMG.plan], art: { eyebrow: null, head: 'Try the door before the wall.', body: 'A small move on the plan can free up a whole room.' }, es: { head: 'Prueba la puerta antes que el muro.', body: 'Un pequeño cambio en el plano puede liberar toda una habitación.' } },
  /* the labels are the point: one room, stripped and finished, and the words say what
     sits between the two */
  { id: 'e-cmp-duo', palette: WARM, imgs: [IMG.room, IMG.room], art: { head: line('Everyone wants the after.', 'The real decisions happen in between: the wall you keep, the pipe you reroute.'), labels: ['Before', 'After'] }, es: { head: line('Todos quieren el después.', 'Las decisiones de verdad están en medio: el muro que conservas, la tubería que desvías.'), labels: ['Antes', 'Después'] } },
  { id: 'n-hook-corner', key: 'good-enough', palette: INK, logo: true, art: { head: 'Nothing ever feels good enough to post.', body: 'So the site photos stay on your phone.' }, es: { head: 'Nada parece lo bastante bueno para publicar.', body: 'Y las fotos de obra se quedan en tu móvil.' } },
  { id: 'q-story-frame', palette: PAPER, imgs: [IMG.print], art: { eyebrow: null, head: 'Keep your first site photo.', body: 'Held up in the finished room, it shows what the design solved.' }, es: { head: 'Guarda tu primera foto de obra.', body: 'Sostenida en la habitación terminada, muestra lo que resolvió el diseño.' } },
  { id: 'e-cta-edge', key: 'linen', palette: WARM, imgs: [IMG.linens], art: { eyebrow: null, head: 'Same colour, different linen.', body: 'Weight changes how it falls and how light passes through.' }, es: { head: 'Mismo color, distinto lino.', body: 'El gramaje cambia cómo cae y cómo pasa la luz.' } },
  /* the same full bleed as the timber post, composed the other way: the words
     stand on the bare wall the picture leaves, facing the window they are about.
     The second line takes the accent because it is the point. */
  { id: 'b-hook-bleed', key: 'ladder', cls: 'hpost--on-wall', palette: PAPER, imgs: [IMG.unfinished], art: { eyebrow: null, head: 'Clients see the ladder.', accent: 'You see the window.', body: 'Mid-build is when they need your eye most.' }, es: { head: 'El cliente ve la escalera.', accent: 'Tú ves la ventana.', body: 'A mitad de obra es cuando más necesita tu mirada.' } },
  { id: 'n-cta-centered', key: 'time', palette: OLIVE, logo: true, art: { head: <>You have the ideas and the photos.<br /><em>Making the post never happens.</em></>, body: null }, es: { head: <>Tienes las ideas y las fotos.<br /><em>El post nunca llega.</em></> } },
  { id: 'n-story-magazine', palette: PAPER, imgs: [IMG.sketch], art: { eyebrow: null, head: 'Start with who sits here.', body: 'A corner works when the sketch begins with the person, not the chair.' }, es: { head: 'Empieza por quién se sienta aquí.', body: 'Un rincón funciona cuando el boceto empieza por la persona, no por la silla.' } },
  /* all three boards have to show, or the sentence is not about this picture */
  { id: 'e-story-hero', key: 'concepts', cls: 'hpost--three', palette: WARM, imgs: [IMG.concepts], art: { eyebrow: null, head: 'Bring three directions, not one.', body: 'A choice starts a better conversation than a single idea.' }, es: { head: 'Lleva tres direcciones, no una.', body: 'Poder elegir abre mejor conversación que una sola idea.' } },
  { id: 'n-story-splittype', key: 'consistency', palette: SLATE, logo: true, art: { head: 'Your last post was months ago.', body: 'Your projects never stopped.' }, es: { head: 'Tu último post fue hace meses.', body: 'Tus proyectos nunca pararon.' } },
  { id: 'n-edu-textfirst', palette: PAPER, imgs: [IMG.drawing], art: { eyebrow: null, head: 'The details nobody sees get drawn first.', body: 'The frame, the stop, the hinge.' }, es: { head: 'Lo que nadie ve se dibuja primero.', body: 'El marco, el tope, la bisagra.' } },
  /* the picture shows what the words are about: where the new boards stop, you
     can see what they will hide */
  { id: 'n-hook-asym', palette: WARM, imgs: [IMG.floor], art: { head: 'Some of the best decisions end up under the floor.', body: 'Pipes, levels, insulation. Every room depends on them.' }, es: { head: 'Las mejores decisiones acaban bajo el suelo.', body: 'Tuberías, niveles, aislamiento. Toda habitación depende de ellos.' } },
  /* the drawer of samples, cropped between the two pairs of hands: labelled, handled,
     and in use, which is what "never pick a material alone" is about */
  { id: 'e-edu-annotated', key: 'samples', cls: 'hpost--panel', palette: PAPER, imgs: [IMG.samples], art: { eyebrow: null, head: 'Never pick a material alone.', body: 'Stone, tile, timber: each one changes how the others look.' }, es: { head: 'Nunca elijas un material solo.', body: 'Piedra, azulejo, madera: cada uno cambia cómo se ven los demás.' } },
]

/* every card keeps its key in both languages, so changing language changes the words in
   place and the row carries on from where it was */
const cardsIn = (lang) => POSTS.map((p) => {
  const shape = LAYOUTS.find((l) => l.id === p.id)
  return {
    key: p.key || p.id,
    kind: shape.kind,
    cls: p.cls || '',
    logo: Boolean(p.logo),
    /* the artwork signs a text-only card with the studio's handle. On this row
       that was `Bauhly Demo` until Leon asked for it to go (Nov 5): a signature
       on a card that did not need one */
    paint: {
      ...paintOf({ palette: p.palette }),
      '--a-sign': '""',
      ...(p.palette.mark && { '--t-ground-mark': p.palette.mark }),
      ...(p.palette.mute && { '--t-ground-mute': p.palette.mute }),
    },
    layout: { ...shape, art: { ...shape.art, ...p.art, ...(lang === 'es' ? p.es : null) }, imgs: p.imgs || [] },
  }
})

const CARDS_IN = { en: cardsIn('en'), es: cardsIn('es') }

const SPEED = 32 // px per second, measured between one and two cards from the middle
const WAVE = 0.006 // of a card's width: how far a card rises or falls from the centre line
const SMALLEST = 0.72 // the size the row eases towards, far from the middle
const SPREAD = 1.5 // in cards: how far from the middle size and gap have eased half way
const GAP = 0.13 // of a card's width: the air between two cards at the sides
const WIDER = 0.03 // how much more air the middle's gap is built from
/* how far past the panel's edge a card's outer edge is, in card widths, when it starts
   to fade and when it has gone. A long band that starts early, tied to the side
   gradients (`.hcar::before`): it starts as the card's outer edge moves into the
   gradient and ends while the card's inner edge is still under it. `fade` below is
   steep in the middle, so it starts earlier and is still quicker where it shows. */
const FADE_FROM = -0.45
const FADE_TO = 0.85
/* A card's size, `d` cards from the middle: 1 there and a smooth peak, not a point,
   so nothing changes abruptly as a card crosses. 0.91 at one card, 0.82 at two, 0.78 at
   three (Leon, Nov 5: "visibly smaller at the sides"). */
const ease = (d) => 1 / (1 + (d / SPREAD) ** 2)
const sizeAt = (d) => SMALLEST + (1 - SMALLEST) * ease(d)
/* Where it stands, in card widths. The distance from one card to the next has to be the
   two half-widths plus the gap, so the place is the running total of size + gap, and
   this is that total worked out: a gap of GAP at the sides, eased up by WIDER towards
   the middle, sharing `ease` with the size so the two move as one (Leon, Nov 5: "more
   spaced out near the center… the side cards sit closer together").
   THE PRICE, and it is not avoidable: centres at different distances cannot all move at
   one speed. A card moves about 24% faster at the middle than at the edge, as gradually
   as it grows. The tighter the sides against the middle, the larger that gets. */
const travelAt = (d) => (SMALLEST + GAP) * d + (1 - SMALLEST + WIDER) * SPREAD * Math.atan(d / SPREAD)
/* How far it sits from the centre line, in card widths: one plain sine, a full cycle
   every two cards, travelling with the row. So it never rests and never turns sharply,
   a card crosses the middle at height zero while still moving, and neighbours are
   always opposite, which is what keeps three cards from lining up on a slope. */
const waveAt = (d) => WAVE * Math.sin(Math.PI * d)
const STACK_BELOW = '(max-width: 900px)' // the width at which the hero becomes one column
const HOLD = 2.4 // seconds a stack rests between swaps
const SWAP = 1.2 // seconds a swap takes
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const LIFT = 0.045 // how much bigger a hovered card is than its place makes it: clear of the narrowest gap (GAP)
const LIFT_TAU = 0.08 // seconds: a card's growth, which `.is-hover`'s 240 ms shadow has settled with by then
const STACK_PULL = 0.7 // in card widths: how far a hand moves a stack by one card
const COAST_TAU = 0.4 // seconds: how quickly a released row loses its speed
const RESUME_AFTER = 1100 // ms a row stays where it was left before it moves again
const RESUME_TAU = 0.7 // seconds: how gently it comes back up to speed
const SETTLE_TAU = 0.14 // seconds: how quickly a released stack reaches its card
const MAX_THROW = 8 // cards per second, whatever the last moment of a drag measured
const WHEEL_IDLE = 160 // ms without a wheel event that ends a swipe
const toward = (dt, tau) => 1 - Math.exp(-dt / tau)

export default function PostCarousel() {
  const [lang] = useLang()
  const CARDS = CARDS_IN[lang]
  const stage = useRef(null)
  const drum = useRef(null)
  const still = useReducedMotion()

  useEffect(() => {
    const root = stage.current
    const row = drum.current
    if (!root || !row) return undefined
    const cards = [...row.children]
    let w = 0
    let step = 0
    let half = 0
    /* where the row is, in CARDS rather than pixels: the size of a card changes
       with the window, and a resize must not make the row jump */
    let at = 2 // opens with the third post, square in the middle
    const lift = cards.map(() => 0) // each card's hover, 0 to 1
    const op = cards.map(() => 0) // how solid each card was last placed

    let stack = false
    let slots = null
    const measure = () => {
      w = cards[0].offsetWidth
      step = w * (travelAt(2) - travelAt(1))
      half = root.clientWidth / 2
      stack = window.matchMedia(STACK_BELOW).matches
      /* WHERE THE STACK'S CARDS STAND, for the room this screen has. Index is how
         many places from the front: x, scale, opacity. A phone shows one card
         each side of the front, a tablet two; the last place is always the one a
         card fades into, tucked behind the last it can be seen at. Each side card
         ends a few pixels inside the panel, so none is cut off at rest. */
      const room = half - 8
      if (half >= w * 1.3) {
        const far = room - 0.37 * w
        slots = [[0, 1, 1], [far * 0.58, 0.86, 1], [far, 0.74, 1], [far * 0.86, 0.66, 0]]
      } else {
        const near = Math.max(room - 0.43 * w, 0)
        slots = [[0, 1, 1], [near, 0.86, 1], [near * 0.8, 0.74, 0]]
      }
    }
    /* HOW SOLID A ROW'S CARD IS, by where its outer edge is against the panel's, the
       same on either side and the same on the way in and out (Leon, Nov 5: "start
       fading earlier and more gradually"; "Synchronize the individual card fading with
       the side gradients"). */
    const fade = (outer) => {
      const t = Math.min(1, Math.max(0, (half + FADE_TO * w - outer) / ((FADE_TO - FADE_FROM) * w)))
      return t * t * t * (t * (6 * t - 15) + 10)
    }
    const put = (card, x, y, scale, o, z) => {
      /* written before the check, so a card can never come back at a stale place */
      card.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      card.style.opacity = o.toFixed(3)
      card.style.visibility = o > 0 ? 'visible' : 'hidden'
      card.style.zIndex = z
    }
    /* THE STACK (Leon, Nov 5: "swapping positions in a layered stack… without abrupt
       jumps or changes in stacking order"). `away` is a card's distance from the
       front, and everything about it is read off `slots`, so a card has one path
       and cannot jump.
       THE SWAP IS WHAT HIDES THE ONE HARD THING. Two cards exchanging front and back
       must change which is on top, and that cannot be animated: done while they
       overlap, the overlap pops. So on the way between front and first place each
       card also swings out sideways, far enough that at the halfway point, where
       they trade places in the order, they are side by side and not touching. */
    const stacked = (card, i, d, grow) => {
      const away = Math.abs(d)
      const side = Math.sign(d)
      const last = slots.length - 1
      const at0 = Math.min(Math.floor(away), last - 1)
      const f = Math.min(1, away - at0)
      const mix = (k) => slots[at0][k] + (slots[at0 + 1][k] - slots[at0][k]) * f
      const near = away < 1
      const swing = near ? Math.sin(Math.PI * away) : 0
      const midScale = (slots[0][1] + slots[1][1]) / 2
      /* half a card apart at the crossing, at the size it is there, and a hair more */
      const out = Math.max(0, midScale * w * 0.5 + 2 - slots[1][0] / 2)
      /* the swing is held inside the panel: the crossing is the widest the pair
         needs to be, and just after it a card is still large and still far out */
      const x = side * Math.min(mix(0) + out * swing, half - 2 - (mix(1) * w) / 2)
      const y = -swing * w * 0.02
      if (away >= last) { op[i] = 0; put(card, x, y, slots[last][1], 0, 0) }
      else {
        op[i] = mix(2)
        /* the order stays the stack's own: raising a side card would drop it over the
           front card's words, with a pop, which is what the swing above exists to avoid */
        put(card, x, y, mix(1) * grow, mix(2), String(100 - Math.round(away * 10)))
      }
    }
    /* how many cards this one is from the middle, wrapped so the row has no
       end. The wrap happens half a row away, far outside the stage. */
    const offset = (i) => {
      const n = cards.length
      return ((((i - at) % n) + n + n / 2) % n) - n / 2
    }
    const place = () => {
      cards.forEach((card, i) => {
        const d = offset(i)
        const grow = 1 + LIFT * lift[i]
        if (stack) { stacked(card, i, d, grow); return }
        const x = travelAt(d) * w
        const scale = sizeAt(d)
        const o = fade(Math.abs(x) + (scale * w) / 2)
        op[i] = o
        /* over its neighbours' shadows and still under the side gradients (z-index 2) */
        put(card, x, waveAt(d) * w, scale * grow, o, lift[i] > 0 ? '1' : '')
      })
    }

    measure()
    place()
    const ro = new ResizeObserver(() => { measure(); place() })
    ro.observe(root)

    let seen = true
    let last = 0
    let raf = 0
    /* the stack's clock. It restarts from a whole card when the mode changes, so
       a window dragged across the breakpoint lands on a card, not between two */
    let clock = 0
    let from = at
    let wasStack = stack

    /* ── THE HAND ─────────────────────────────────────────────────────────── */
    let pointer = null // where a mouse is over the stage
    let hovered = -1
    let drag = null
    let swiping = false
    let wheelAt = 0
    let wheelAxis = 'y'
    let vel = null // a row's speed, in cards per second. Set by the first frame
    let holdUntil = 0
    let settle = null // the whole card a released stack is heading for

    /* how many pixels move a row by one card, at the card being held: the row's spacing
       varies along its length, and this keeps that card under the cursor */
    const pull = (i) => {
      if (stack) return w * STACK_PULL
      if (i < 0) return step
      const d = offset(i)
      return (w * (travelAt(d + 0.01) - travelAt(d - 0.01))) / 0.02
    }
    const cardAt = (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest?.('.hpost')
      const i = el ? cards.indexOf(el) : -1
      return i >= 0 && op[i] > 0.5 ? i : -1
    }
    const letGo = (speed, now) => {
      holdUntil = now + RESUME_AFTER
      if (stack) settle = Math.round(at + Math.max(-1, Math.min(1, speed * 0.18)))
      else vel = still ? 0 : Math.max(-MAX_THROW, Math.min(MAX_THROW, speed))
    }
    const onDown = (e) => {
      if (e.button !== 0 || isCaptureOpen()) return
      drag = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0, mouse: e.pointerType === 'mouse', grab: cardAt(e.clientX, e.clientY) }
      settle = null
      vel = 0
      root.setPointerCapture(e.pointerId)
      root.classList.add('is-dragging')
    }
    const onMove = (e) => {
      if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY }
      if (!drag || e.pointerId !== drag.id) return
      const moved = -(e.clientX - drag.x) / pull(drag.grab)
      const dt = (e.timeStamp - drag.t) / 1000
      at += moved
      if (dt > 0) drag.v = drag.v * 0.6 + (moved / dt) * 0.4
      drag.x = e.clientX
      drag.t = e.timeStamp
    }
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return
      /* a hand that stopped before it let go threw nothing */
      letGo(e.type === 'pointerup' && e.timeStamp - drag.t < 80 ? drag.v : 0, e.timeStamp)
      drag = null
      root.classList.remove('is-dragging')
    }
    const onLeave = (e) => { if (e.pointerType === 'mouse') pointer = null }
    /* A gesture is one axis from its first event, so a swipe that wanders does not also scroll
       the page. A vertical one is left alone for the page. Stopped here because Lenis listens
       further up, and prevented because the browser would take a horizontal one as "back". */
    const onWheel = (e) => {
      if (isCaptureOpen()) return
      const dx = e.deltaX * (e.deltaMode === 1 ? 16 : 1)
      if (e.timeStamp - wheelAt > WHEEL_IDLE) wheelAxis = Math.abs(dx) > Math.abs(e.deltaY) ? 'x' : 'y'
      wheelAt = e.timeStamp
      if (wheelAxis !== 'x') return
      e.preventDefault()
      e.stopPropagation()
      at += dx / pull(hovered)
      settle = null
      vel = 0
      swiping = true
    }
    const noDrag = (e) => e.preventDefault()
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('pointerleave', onLeave)
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('dragstart', noDrag)

    const hover = (dt) => {
      const under = drag ? (drag.mouse ? drag.grab : -1) : pointer ? cardAt(pointer.x, pointer.y) : -1
      if (under !== hovered) {
        cards[hovered]?.classList.remove('is-hover')
        cards[under]?.classList.add('is-hover')
        hovered = under
      }
      let moving = false
      lift.forEach((l, i) => {
        const aim = i === hovered ? 1 : 0
        if (l === aim) return
        moving = true
        const next = still ? aim : l + (aim - l) * toward(dt, LIFT_TAU)
        lift[i] = Math.abs(aim - next) < 0.002 ? aim : next
      })
      return moving
    }

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0)
      last = now
      if (!seen || isCaptureOpen() || !step) return
      if (stack !== wasStack) {
        wasStack = stack
        clock = 0
        at = Math.round(at)
        from = at
        settle = null
        vel = null
      }
      let moved = hover(dt)
      if (swiping && now - wheelAt >= WHEEL_IDLE) {
        swiping = false
        letGo(0, now)
      }
      if (drag || swiping) moved = true
      else if (stack) {
        if (settle !== null) {
          at += (settle - at) * toward(dt, SETTLE_TAU)
          moved = true
          if (Math.abs(settle - at) < 0.002) {
            at = settle
            from = settle
            clock = 0
            settle = null
          }
        } else if (!still) {
          clock += dt
          const round = HOLD + SWAP
          const turns = Math.floor(clock / round)
          const into = clock - turns * round
          at = from + turns + (into < HOLD ? 0 : easeInOut((into - HOLD) / SWAP))
          moved = true
        }
      } else {
        const aim = still || now < holdUntil ? 0 : SPEED / step
        vel = vel ?? aim
        vel += (aim - vel) * toward(dt, aim ? RESUME_TAU : COAST_TAU)
        at += vel * dt
        moved = moved || vel !== 0
      }
      if (moved) place()
    }
    raf = requestAnimationFrame(frame)
    const io = new IntersectionObserver(([en]) => { seen = en.isIntersecting; last = 0 })
    io.observe(root)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('pointerleave', onLeave)
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('dragstart', noDrag)
      root.classList.remove('is-dragging')
      cards.forEach((card) => card.classList.remove('is-hover'))
    }
  }, [still])

  return (
    <div className="hcar" ref={stage} aria-hidden="true">
      <div className="hcar__drum" ref={drum}>
        {CARDS.map((c) => (
          <div key={c.key} className={`hpost hpost--${c.kind} ${c.logo ? 'hpost--logo' : ''} ${c.cls}`.replace(/\s+/g, ' ').trim()} style={c.paint}>
            <Preview l={c.layout} />
            {c.logo && (
              <span className="hpost__logo">
                <Wordmark size="5.2cqw" color="var(--t-ground-fg)" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
