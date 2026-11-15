/*
 * The landing page's language (Leon, Nov 5: "switch between English and Spanish").
 *
 * The choice lives in the one store, under `lang`, so a visitor keeps it between
 * visits, and there is no second localStorage key (CLAUDE.md §2).
 *
 * The navbar's and the hero's words are here. Each section below keeps its Spanish beside
 * its English, in its own file, so the comments that say why a claim reads as it does stay
 * next to both (decision 635). Capture and the Sign in box are the product and are still English.
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

/* ── THE EXAMPLE'S OWN PICTURES (Leon, Nov 12 — decision 831: "Use the material image from the attached reference and
   build a realistic story around it… Don't limit the story to just two images. Use as many relevant images as needed…
   Each image should support the story and help explain the designer's thinking") ── four, in the order the story tells
   them, each with one job: the sample drawer (the stones and timbers the choice was made from), the bare room in strong
   window light (why a photo was the wrong way to choose), the samples laid out on the plan in daylight (the test), and
   oak, linen, pale stone and brass together in sun (the palette it became). All already in the project (D8a), high
   resolution, and illustrative: the studio library's README asserts none of them as one documented project, and the
   story claims nothing they do not show. The drawer's hands are cropped by the slides, never retouched (its README).
   WHAT USED TO BE HERE: the marble and oak samples and the dining room (decision 829, the same morning; Leon: "I don't
   like the current story or image selection"); before them, the plaster wall, the desk and the ash (Nov 6). */
const EXAMPLE_PHOTOS = [
  '/assets/photo/studio/08-material-samples.webp',
  '/assets/photo/studio/07-unfinished-room.webp',
  '/assets/photo/canal-house-04-desk.jpg',
  '/assets/photo/piece-swatches.jpg',
]

/* ══ WHAT BAUHLY MAKES OF THE EXAMPLE (Leon, Nov 12 — decision 832, the example-narrative brief: "The slides should tell a
   connected story… Hook → Setup → Decision → Result → Lesson or CTA, where relevant… Choose the layout based on the
   content, narrative role, and image focal point… Use annotations only to highlight real, relevant details… Don't cover
   the subject with text"; and "Use as many relevant images as needed… Each image should support the story") ══════════
   Five slides, one per role, nothing the capture or its pictures do not say:
     1 Hook      The sample drawer, the whole slide, the line on a floating panel (Leon's reference card): the stones the
                 choice was made from, and the tension in one line. Cropped up and in so the hands at its lower edge and
                 top right are out of the frame (studio README: crop, never retouch).
     2 Problem   The bare room in strong window light above, the words below (Split band): why a photo was the wrong
                 way to choose. Over the photograph the words sat on the bright window, unreadable (MEASURED).
     3 Decision  The samples on the plan, as a plate (Editorial), on Nature read dark: the test, and why it was done that
                 way.
     4 Result    Oak, linen, pale stone and brass together in sun above, the words below (Split band, as slide 2, not next
                 to it): what was chosen, and the green's fate, in the capture's words. On a panel over the picture the
                 words covered the pale stone itself (MEASURED).
     5 Lesson    Text only, centred, on Nature read dark: what to take from it, and the reason to save it — the CTA the
                 brief allows "where relevant", because the lesson is the one thing a reader can do with the story.
   One colour set (decision 748), grounds alternating between the pictures and dark/light; no labels on the pictures
   (decision 734). `base` is the library layout whose words the slide carries; `layout` the flow type; `picture` the
   crop; `refine` the block's Refine Layout settings; `tune` a line set apart from its block.
   WHAT USED TO BE HERE: the marble-or-oak table in four slides (decision 830's note, the same morning, never accepted);
   before it, the plaster wall in seven (decisions 733–739, 748). */
const examplePost = (t) => ({
  id: 'own-example',
  caption: t.caption,
  format: '5-slide carousel',
  formatId: 'example-5',
  slides: [
    /* the panel small and low, so the drawer stays the picture; cropped in and down so neither hand is in frame
       (MEASURED: at 50% 40% × 1.15 the top right hand showed, and a large panel covered half the drawer) */
    { i: 0, base: 'b-hook-bleed', kind: 'hero', layout: 'panel', photo: EXAMPLE_PHOTOS[0], picture: { at: '42% 55%', zoom: 1.35 }, set: 'nature',
      refine: { textProminence: 'small', titleGroupPosition: 'bottom' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: '', headline: t.s[0][0], body: t.s[0][1] },
    /* the room above and the words under it: over the photograph they sat on the bright window, unreadable, and covered
       the light that is the problem (MEASURED) */
    { i: 1, base: 'q-story-frame', kind: 'hero', layout: 'band', photo: EXAMPLE_PHOTOS[1], picture: { at: '45% 45%' }, set: 'nature',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: '', headline: t.s[1][0], body: t.s[1][1] },
    { i: 2, base: 'e-story-hero', kind: 'hero', layout: 'editorial', photo: EXAMPLE_PHOTOS[2], picture: { at: '45% 55%' }, set: 'nature', tone: 'dark',
      refine: { textProminence: 'small' }, tune: { title: { textProminence: 'medium' } },
      eyebrow: '', headline: t.s[2][0], body: t.s[2][1] },
    /* the palette above and the words under it: on a panel over the photograph the words covered the pale stone, the
       sample the slide is about, and a square picture in a 4:5 slide cannot be moved up out of its way (MEASURED) */
    { i: 3, base: 'q-story-frame', kind: 'hero', layout: 'band', photo: EXAMPLE_PHOTOS[3], picture: { at: '50% 50%' }, set: 'nature',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'large' } },
      eyebrow: '', headline: t.s[3][0], body: t.s[3][1] },
    { i: 4, base: 'n-cta-centered', kind: 'cta', layout: 'bleed', photo: null, set: 'nature', tone: 'dark',
      refine: { textProminence: 'medium' }, tune: { title: { textProminence: 'large' } },
      eyebrow: '', headline: t.s[4][0], body: t.s[4][1] },
  ],
  basis: { captureIds: ['example'], photos: 4, photosFromProject: false, fromAssets: 4, derived: 0, made: 4, sentences: 5, shortOfWords: 0, dropped: 0, mayPromiseSwipe: true, mayPromiseTour: false, note: 'The example, told as one decision in five slides.' },
});
const EXAMPLE_POST_EN = examplePost({
  caption: 'The client chose a dark green stone from a photo. But the room gets strong sun all day. So we tested our samples in real light, next to the oak. The green looked heavy. The pale stone stayed calm, so that’s the one we chose. Test materials where they will live.',
  s: [
    ['Never choose a stone from a photo.', ''],
    ['The client chose a dark green stone online.', 'But this room gets strong sun all day.'],
    ['So we tested samples in real light.', 'Next to the oak, not on a screen.'],
    ['The pale stone won.', 'Next to the oak, the green looked heavy. The pale stone stayed calm.'],
    ['Test materials where they will live.', 'Save this for your next material choice.'],
  ],
});
const EXAMPLE_POST_ES = examplePost({
  caption: 'El cliente eligió una piedra verde oscura por una foto. Pero la habitación recibe sol fuerte todo el día. Así que probamos nuestras muestras con luz real, junto al roble. La verde se veía pesada. La clara se mantenía tranquila, así que elegimos esa. Prueba los materiales donde van a vivir.',
  s: [
    ['Nunca elijas una piedra por una foto.', ''],
    ['El cliente eligió una piedra verde oscura en internet.', 'Pero esta habitación recibe sol fuerte todo el día.'],
    ['Así que probamos muestras con luz real.', 'Junto al roble, no en una pantalla.'],
    ['Ganó la piedra clara.', 'Junto al roble, la verde se veía pesada. La clara se mantenía tranquila.'],
    ['Prueba los materiales donde van a vivir.', 'Guárdalo para tu próxima elección de materiales.'],
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
      /* ── A PROBLEM, A DECISION, A RESULT (Leon, Nov 11 — decision 822: "really clear, quick and very easy to understand
         read quickly, like starting with a problem, continuing with a decision and the result, but as brief as possible to
         complete the story") ── one sentence each, 33 words, the same story as the photos and the post (the plaster wall,
         the samples by the plan, pale ash). The result is the room's, not a client's or a number (D8).
         WHAT USED TO BE HERE (56 words): "We kept the old plaster on the long wall, rough as it was. In low sun it showed every
         trowel mark, and the darker timber I'd drawn just fought with it. So I put samples next to the plan and went with
         pale ash. Now the plaster is the only rough thing in the room." */
      /* ── ONE EVERYDAY DECISION, IN EVERYDAY WORDS (Leon, Nov 12 — decision 831, the example-narrative brief: "Keep the
         story short, engaging, and easy to understand, especially for non-native English speakers… a clear problem,
         decision, and result… realistic") ── five short sentences, 42 words: the problem (a dark green stone chosen
         from a photo, for a room in strong sun), the decision (the samples tested in real light, beside the oak), the
         result (the green heavy, the pale stone calm, and chosen). Every fact is one the four pictures can stand behind:
         green and pale stones and timber in the drawer, the room's strong light, the samples on the plan in daylight,
         oak and pale stone together in sun. No client reaction: this capture has none to report.
         WHAT USED TO BE HERE: the marble-or-oak table (decision 829, the same morning); before it, the plaster wall
         (decision 822). */
      text: 'The client chose a dark green stone from a photo. But the room gets strong sun all day. We tested our samples in real light, next to the oak. The green looked heavy. The pale stone looked calm, so we chose it.',
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
      /* decision 831, as the English: problem, decision, result */
      text: 'El cliente eligió una piedra verde oscura por una foto. Pero la habitación recibe sol fuerte todo el día. Probamos nuestras muestras con luz real, junto al roble. La verde se veía pesada. La piedra clara se veía tranquila, así que la elegimos.',
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
