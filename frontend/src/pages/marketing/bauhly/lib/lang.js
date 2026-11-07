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
    /* Capture's `See an example`. How someone tells a colleague, not a caption: one decision and
       how it travelled, and every part of it is something a picture below can show. An example
       and not anybody's project: no names, no figures, no client, no result (D8; decision 653). */
    example: {
      say: 'See an example',
      photosSay: 'See example photos',
      ctaSay: 'Create your own',
      postSay: 'Generate example',
      photos: EXAMPLE_PHOTOS,
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
      say: 'Ver un ejemplo',
      photosSay: 'Ver fotos de ejemplo',
      ctaSay: 'Crea el tuyo',
      postSay: 'Generar ejemplo',
      photos: EXAMPLE_PHOTOS,
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
