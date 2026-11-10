/*
 * The landing page's language (Leon, Nov 5: "switch between English and Spanish").
 *
 * The choice lives in the one store, under `lang`, so a visitor keeps it between
 * visits, and there is no second localStorage key (CLAUDE.md §2).
 *
 * The navbar's and the hero's words are here. Each section below keeps its Spanish beside
 * its English, in its own file, so the comments that say why a claim reads as it does stay
 * next to both (decision 635). Capture and /auth are the product and are still English.
 * The Spanish was written by Claude and has not had a native read.
 */
import { useCallback, useEffect } from 'react'
/* the live app has ONE language setting (Settings › Language, `bauhly.locale`), so the landing
   page's switch is that setting rather than a second store key */
import { setLocale, useLocale } from '../../../../i18n'

export const LANGS = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'es', short: 'ES', name: 'Español' },
]

/* Capture's example and its pictures are one thing, written together (Leon, Nov 6: "Build the
   example text and photo selection together"). One decision, three pictures, in the order the
   story tells them: the rough wall in low sun, the samples against the plan, the ash beside the
   plaster. All already in the project (D8a), and none of them a finished room. */
const EXAMPLE_PHOTOS = [
  '/assets/photo/mood/raw-light.png',
  '/assets/photo/canal-house-04-desk.jpg',
  '/assets/photo/canal-house-02-detail-ash.jpg',
]

/* ══ WHAT BAUHLY MAKES OF THE EXAMPLE (Leon, Nov 9 — decisions 733, 734) ═════════════════════════════════════════
   "Keep the story cohesive, with each slide naturally leading to the next… Use different layout types… Don't force
    layout variety… Avoid annotations… Include a meaningful CTA on the final slide… Use different colour sets across
    slides when they help communicate the narrative… The current hook text is too small for a hook."
   Seven slides on the Content OS frame (Hook, Struggle, Shift, Takeaway, then ONE ask), one decision told in the order
   it was made. EVERY FACT IS THE CAPTURE'S (D8, decision 653): the plaster kept, low sun and the trowel marks, the
   darker timber on the drawing fighting it, samples beside the plan, pale ash, and the plaster as the only rough thing
   left. What is added is the reading a designer brings to it, never a name, a figure, a client or a result. No labels
   or marks on the photographs (734): the pictures carry the evidence on their own.
   Each slide's arrangement is chosen for what it carries, not for variety:
     1 Hook       Full bleed: the wall in low sun is strong enough to carry the headline; the words sit low, on the
                  floor's shadow, clear of the light on the wall. The headline is large, over a small line.
     2 Context    Split band: the trowel marks, cropped close, take most of the slide; an observation, so a medium
                  headline over small type.
     3 Struggle   Text only: the problem has no picture, and a large headline is the turn in the story.
     4 Shift      Editorial: the desk set as a plate with the page around it, so the samples AND the plan stay in
                  view (a floating panel sits in the bottom-left corner, which on this photograph is the plan).
     5 Decision   Split band: the ash beside the plaster above, the decision large below.
     6 Takeaway   Text only, large.
     7 Ask        Editorial: the wall again, closing where the story opened, as a plate cropped to the light and its
                  shadow, on Nature's deep green, with the ask under it (decision 739; WHAT USED TO BE HERE, 735: an
                  orange floating panel over the floor, which Leon found disconnected from the picture).
   The hook sits at the foot with `spacious` padding, which keeps it clear of the preview's dots.
   Colour follows the turn (decisions 735, 738), and the grounds alternate light and dark so no two neighbours look
   alike (738: the test on cream beside the decision on sand read as one slide twice): picture, cream, near-black,
   cream, deep green, sand, orange. The problem is the Primary set read DARK (cream on near-black), the one hard stop;
   the test is back on cream; the decision is Nature read DARK (sand on deep green), the post's decision said with
   weight and set against its own pale photograph of ash; the takeaway is Nature as it is (green on sand), the palette
   relaxing once the problem is solved; the ask (decision 739) is Nature read dark again: Leon,
   "the current orange panel feels disconnected from the image… Don't force the accent colour into the composition
   if it doesn't work". The deep green is the colour the decision was made in and it sits with the warm plaster rather
   than against it; the ask is the last thing said in it. Its words close the hook's loop ("We kept the rough wall" →
   "the next wall worth keeping"), the kicker says when to use it ("Before your next sample day"), the ask is large,
   and the line under it is the takeaway as the reason to save. The light on the wall stays the picture: the plate
   is cropped to it (`at: 64% 34%`, a little closer), so no panel sits on it. Every tone is the set's own three colours (lib/postcolors.js).
   Type follows the job (decision 735): the problem is the loudest line in the post, a statement; the hook is large
   but low and small enough to leave the light on the wall in view; the ask is a compact panel, so the wall it closes
   on is still the picture.
   `base` is the library layout whose words the slide carries; `layout` the flow type (a slide with no photograph
   takes the text stack); `picture` the crop that keeps the subject in view; `refine` the block's Refine Layout
   settings (`textProminence` sizes the block, `titleGroupPosition` places it); `tune` a line set apart from its
   block (`partAlign`).
   ── ONE SET FOR THE WHOLE CAROUSEL (Leon, Nov 9 — decision 748: "For demo purposes only, use one colour set throughout
   each generated carousel… Allow different combinations of the colours within that set to create contrast and
   variety… Don't change the existing colour selection behaviour for posts generated in the main Bauhly app") ──
   Nature, every slide: its deep green and its sand are the plaster's own warmth and the decision's colour, and the
   example already closed in it. The variety is the set's own readings: the hook on its photograph, sand grounds with
   green type (slides 2, 4, 6) and green grounds with sand type (3, 5, 7), so no two neighbours share a ground. The
   accent reading (sage) is left out as a ground: green type on it is about 3.8:1, under what the body lines need.
   The app's own posts still choose per slide (`colourPlan`, lib/firstpost.js). */
const examplePost = (t) => ({
  id: 'own-example',
  caption: t.caption,
  format: '7-slide carousel',
  formatId: 'example-7',
  slides: [
    { i: 0, base: 'b-hook-bleed', kind: 'hero', layout: 'bleed', photo: EXAMPLE_PHOTOS[0], picture: { at: '58% 52%' }, set: 'nature',
      refine: { textProminence: 'small', titleGroupPosition: 'bottom', postPadding: 'spacious' }, tune: { title: { textProminence: 'large' } },
      eyebrow: t.s[0][0], headline: t.s[0][1], body: t.s[0][2] },
    { i: 1, base: 'e-edu-split', kind: 'hero', layout: 'band', photo: EXAMPLE_PHOTOS[0], picture: { at: '62% 38%', zoom: 1.8 }, set: 'nature',
      refine: { textProminence: 'small' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: t.s[1][0], headline: t.s[1][1], body: t.s[1][2] },
    { i: 2, base: 'n-edu-callout', kind: 'type', layout: 'bleed', photo: null, set: 'nature', tone: 'dark',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'statement' } },
      eyebrow: t.s[2][0], headline: t.s[2][1], body: t.s[2][2] },
    { i: 3, base: 'e-story-hero', kind: 'hero', layout: 'editorial', photo: EXAMPLE_PHOTOS[1], picture: { at: '45% 55%' }, set: 'nature',
      refine: { textProminence: 'small' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: t.s[3][0], headline: t.s[3][1], body: t.s[3][2] },
    { i: 4, base: 'q-story-frame', kind: 'hero', layout: 'band', photo: EXAMPLE_PHOTOS[2], picture: { at: '55% 45%' }, set: 'nature', tone: 'dark',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'large' } },
      eyebrow: t.s[4][0], headline: t.s[4][1], body: t.s[4][2] },
    { i: 5, base: 'e-story-title', kind: 'type', layout: 'bleed', photo: null, set: 'nature',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'large' } },
      eyebrow: t.s[5][0], headline: t.s[5][1], body: t.s[5][2] },
    { i: 6, base: 'e-cta-edge', kind: 'cta', layout: 'editorial', photo: EXAMPLE_PHOTOS[0], picture: { at: '64% 34%', zoom: 1.25 }, set: 'nature', tone: 'dark',
      refine: { textProminence: 'small' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: t.s[6][0], headline: t.s[6][1], body: t.s[6][2] },
  ],
  basis: { captureIds: ['example'], photos: 3, photosFromProject: false, fromAssets: 3, derived: 0, made: 3, sentences: 4, shortOfWords: 0, dropped: 0, mayPromiseSwipe: true, mayPromiseTour: false, note: 'The example, told as one decision in seven slides.' },
});
const EXAMPLE_POST_EN = examplePost({
  caption: 'We kept the old plaster on the long wall, rough as it was. Low sun showed every trowel mark, and the darker timber on the drawing fought with it. Samples next to the plan settled it: pale ash, fine grain. Now the plaster is the only rough thing in the room.',
  s: [
    ['The long wall', 'We kept the rough wall.', 'In the end, it chose the timber.'],
    ['Low sun', 'Raking light shows every trowel mark.', 'Midday flattens a wall like this. Low sun turns it into texture.'],
    ['The problem', 'The darker timber I’d drawn fought with it.', 'Two strong textures side by side, both asking to be looked at.'],
    ['The test', 'So the samples went next to the plan.', 'Plaster, two timbers and the drawing, in the same light.'],
    ['The decision', 'Pale ash, fine grain.', 'Quiet enough to let the plaster lead.'],
    ['What changed', 'Now the plaster is the only rough thing in the room.', 'Pale ash beside it lets the wall be the first thing you see.'],
    ['Before your next sample day', 'Save this for the next wall worth keeping.', 'Then test the timber against it, in its own light.'],
  ],
});
const EXAMPLE_POST_ES = examplePost({
  caption: 'Dejamos el yeso viejo de la pared larga tal cual, rugoso. Con el sol bajo se veía cada marca de llana, y la madera oscura del plano se peleaba con él. Las muestras junto al plano lo decidieron: fresno claro, veta fina. Ahora lo único rugoso de la habitación es el yeso.',
  s: [
    ['La pared larga', 'Dejamos la pared rugosa.', 'Al final, ella eligió la madera.'],
    ['Sol bajo', 'La luz rasante muestra cada marca de llana.', 'A mediodía una pared así parece plana. Con el sol bajo, es pura textura.'],
    ['El problema', 'La madera oscura que había dibujado se peleaba con ella.', 'Dos texturas fuertes, una al lado de la otra, pidiendo atención a la vez.'],
    ['La prueba', 'Así que las muestras fueron junto al plano.', 'Yeso, dos maderas y el dibujo, bajo la misma luz.'],
    ['La decisión', 'Fresno claro, veta fina.', 'Lo bastante tranquilo para que mande el yeso.'],
    ['Qué cambió', 'Ahora lo único rugoso de la habitación es el yeso.', 'Con el fresno claro al lado, la pared es lo primero que ves.'],
    ['Antes de tu próxima prueba de muestras', 'Guárdalo para la próxima pared que merezca quedarse.', 'Y prueba la madera junto a ella, con su propia luz.'],
  ],
});

export const COPY = {
  en: {
    links: ['The problem', 'How it works', 'Your week', 'Questions'],
    login: 'Log in',
    signup: 'Sign up',
    language: 'Language',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    title: 'Turn your everyday work into stories worth sharing.',
    subBefore: 'Bauhly is your content partner, turning ',
    subWho: 'architects’ and interior designers’',
    subAfter: ' project photos, ideas and decisions into meaningful stories, with a clear plan to reach the right clients.',
    ask: 'Tell me about your project',
    /* Capture's `Try an example`: it says try because the visitor does it, pressing submit and
       answering, and nothing here is a video to watch (decision 664). The text is how someone
       tells a colleague, not a caption: one decision and how it travelled, and every part of it is
       something a picture below can show. An example and not anybody's project: no names, no
       figures, no client, no result (D8; decision 653). */
    example: {
      say: 'Try an example',
      photosSay: 'See example photos',
      ctaSay: 'Create your own',
      postSay: 'Generate example',
      readySay: 'Your example is ready.',
      revealSay: 'Here’s what I created from your example. Swipe through the slides to see how the story comes together.',
      editSay: 'Try editing',
      ownAsk: 'Now let’s create something from your own studio. Tell me about a project, detail, or decision you’d like to share.',
      photos: EXAMPLE_PHOTOS,
      post: EXAMPLE_POST_EN,
      text: 'We kept the old plaster on the long wall, rough as it was. In low sun it showed every trowel mark, and the darker timber I’d drawn just fought with it. So I put samples next to the plan and went with pale ash. Now the plaster is the only rough thing in the room.',
    },
    start: 'Start capturing',
    /* What a designer or architect says to this field in a working day. From the two
       interviews, n = 2, and written as examples rather than as anybody's project:
       decisions and details noted as they happen, on site (Buñola·Ortigosa: site photos
       taken with no thought for what comes after), details that get forgotten later
       (46ymedio), and clients changing things late (Buñola·Ortigosa). Short, because a
       phone has room for about 38 characters. Longer ones are cut at the head. */
    examples: [
      'We changed the kitchen layout today…',
      'The client wasn’t sold on the sample…',
      'Found a lighting problem on site…',
      'This detail took us three attempts…',
      'We decided to keep the original floor…',
      'The client changed the tiles late on…',
      'The builder found a pipe in the wall…',
      'Sketched the staircase again today…',
    ],
  },
  es: {
    links: ['El problema', 'Cómo funciona', 'Tu semana', 'Preguntas'],
    login: 'Entrar',
    signup: 'Regístrate',
    language: 'Idioma',
    openMenu: 'Abrir menú',
    closeMenu: 'Cerrar menú',
    title: 'Convierte tu trabajo diario en historias que merecen compartirse.',
    subBefore: 'Bauhly es tu socio de contenidos: convierte las fotos, ideas y decisiones de proyecto de ',
    subWho: 'arquitectos e interioristas',
    subAfter: ' en historias con sentido, con un plan claro para llegar a los clientes adecuados.',
    ask: 'Cuéntame sobre tu proyecto',
    example: {
      say: 'Prueba un ejemplo',
      photosSay: 'Ver fotos de ejemplo',
      ctaSay: 'Crea el tuyo',
      postSay: 'Generar ejemplo',
      readySay: 'Tu ejemplo está listo.',
      revealSay: 'Esto es lo que he creado a partir de tu ejemplo. Desliza las diapositivas para ver cómo se construye la historia.',
      editSay: 'Prueba a editar',
      ownAsk: 'Ahora creemos algo de tu propio estudio. Cuéntame sobre un proyecto, un detalle o una decisión que quieras compartir.',
      photos: EXAMPLE_PHOTOS,
      post: EXAMPLE_POST_ES,
      text: 'Dejamos el yeso viejo de la pared larga tal cual, rugoso. Con el sol bajo se veía cada marca de llana, y la madera oscura que había dibujado se peleaba con él. Así que puse muestras junto al plano y me fui a un fresno claro. Ahora lo único rugoso de la habitación es el yeso.',
    },
    /* short on purpose: the pill is a fixed 244 wide, and `Empezar a capturar` ran under its arrow */
    start: 'Empieza aquí',
    /* the same eight, said as they would be in Spain, held to the same 38 characters */
    examples: [
      'Hoy hemos cambiado la cocina de sitio…',
      'Al cliente no le convenció la muestra…',
      'Problema de iluminación en la obra…',
      'Este detalle nos llevó tres intentos…',
      'Decidimos mantener el suelo original…',
      'El cliente cambió los azulejos al final…',
      'Apareció una tubería en la pared…',
      'Hoy he vuelto a dibujar la escalera…',
    ],
  },
}

export function useLang() {
  const stored = useLocale()
  const lang = stored === 'es' ? 'es' : 'en'
  const setLang = useCallback((id) => setLocale(id), [])
  return [lang, setLang, COPY[lang]]
}

/* the page says what language it is in, for screen readers and hyphenation, and hands
   the document back as it was: the product is English */
export function useDocumentLang(lang) {
  useEffect(() => {
    const title = document.title
    document.documentElement.lang = lang
    if (lang === 'es') document.title = 'Bauhly — Sigue siendo quien diseña'
    return () => {
      document.title = title
    }
  }, [lang])
}
