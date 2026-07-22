import type { ExamplePost } from '../../types'

/*
 * The primary source. Every claim in this product is an aggregate over
 * Instagram posts, and until now no screen ever showed one — a strategist
 * had to trust "22% publish design-decision stories" with nothing to read.
 *
 * These are the posts behind the patterns. When the Apify adapter lands,
 * this file is replaced by real collected posts; the shape is already the
 * one `types/signal.ts` defines, so nothing downstream changes.
 *
 * Captions are excerpts, deliberately. Storing and re-displaying full
 * captions of accounts we do not own is a licensing question the team has
 * not answered, so the UI shows an excerpt and links out to the source.
 */

/** Keyed by the pattern the post is evidence for. */
export const postsByPattern: Record<string, ExamplePost[]> = {
  'Reels (Voice-over)': [
    {
      id: 'post-vo-1',
      username: 'casanorte.estudio',
      captionExcerpt:
        'We nearly demolished this wall. Here is why we did not — and what it saved the client…',
      permalink: 'https://www.instagram.com/p/CxVo1aBcDeF/',
      format: 'Reel',
      postedAt: '2026-07-14T09:12:00+02:00',
      likeCount: 3184,
      commentCount: 96,
    },
    {
      id: 'post-vo-2',
      username: 'estudio.piedra',
      captionExcerpt:
        'Three minutes on why we specified microcement over tile in a flat with two dogs…',
      permalink: 'https://www.instagram.com/p/CxWq7hJkLmN/',
      format: 'Reel',
      postedAt: '2026-07-11T18:40:00+02:00',
      likeCount: 2410,
      commentCount: 143,
    },
    {
      id: 'post-vo-3',
      username: 'hauscasa',
      captionExcerpt: 'Walking you through the lighting plan, room by room. Turn the sound on…',
      permalink: 'https://www.instagram.com/p/CxYr2pQrStU/',
      format: 'Reel',
      postedAt: '2026-07-09T13:05:00+02:00',
      likeCount: 5077,
      commentCount: 201,
    },
  ],
  'Carousels (Educational)': [
    {
      id: 'post-dd-1',
      username: 'ateliercasa',
      captionExcerpt:
        'We chose oak over walnut here. It costs less, but that is not why. The room faces north…',
      permalink: 'https://www.instagram.com/p/CxZa4bCdEfG/',
      format: 'Carousel',
      postedAt: '2026-07-15T11:30:00+02:00',
      likeCount: 1892,
      commentCount: 74,
    },
    {
      id: 'post-dd-2',
      username: 'surcraft',
      captionExcerpt:
        'The client wanted an island. The kitchen is 9m². Here is what we did instead…',
      permalink: 'https://www.instagram.com/p/CxAb5cDeFgH/',
      format: 'Carousel',
      postedAt: '2026-07-12T08:15:00+02:00',
      likeCount: 2733,
      commentCount: 188,
    },
  ],
  'Materials & finishes': [
    {
      id: 'post-mf-1',
      username: 'formaliving',
      captionExcerpt:
        'Six months of wear on four worktop materials, photographed in the same light…',
      permalink: 'https://www.instagram.com/p/CxBc6dEfGhI/',
      format: 'Carousel',
      postedAt: '2026-07-16T10:00:00+02:00',
      likeCount: 4102,
      commentCount: 312,
    },
    {
      id: 'post-mf-2',
      username: 'lumen.casa',
      captionExcerpt: 'Travertine looks beautiful and stains if you look at it wrong. Read this first…',
      permalink: 'https://www.instagram.com/p/CxCd7eFgHiJ/',
      format: 'Carousel',
      postedAt: '2026-07-13T16:22:00+02:00',
      likeCount: 3560,
      commentCount: 240,
    },
  ],
  'Small spaces': [
    {
      id: 'post-ss-1',
      username: 'volta.estudio',
      captionExcerpt: '38m² in Gràcia. One wall moved, nothing else structural…',
      permalink: 'https://www.instagram.com/p/CxDe8fGhIjK/',
      format: 'Carousel',
      postedAt: '2026-07-08T12:44:00+02:00',
      likeCount: 2201,
      commentCount: 88,
    },
  ],
  'Project story': [
    {
      id: 'post-cs-1',
      username: 'norte.interiors',
      captionExcerpt:
        'They had a 12m² kitchen and three kids. This is what mattered to them, in their words…',
      permalink: 'https://www.instagram.com/p/CxEf9gHiJkL/',
      format: 'Image',
      postedAt: '2026-07-10T19:05:00+02:00',
      likeCount: 1455,
      commentCount: 61,
    },
    {
      id: 'post-cs-2',
      username: 'ambienta.projects',
      captionExcerpt: 'Two years later, we went back to photograph it lived in. Nothing styled…',
      permalink: 'https://www.instagram.com/p/CxFg1hIjKlM/',
      format: 'Carousel',
      postedAt: '2026-07-07T09:50:00+02:00',
      likeCount: 3890,
      commentCount: 127,
    },
  ],
  'Single Image (Text)': [
    {
      id: 'post-si-1',
      username: 'piedraliving',
      captionExcerpt: 'Sunday in the Empordà house.',
      permalink: 'https://www.instagram.com/p/CxGh2iJkLmN/',
      format: 'Image',
      postedAt: '2026-07-06T17:30:00+02:00',
      likeCount: 612,
      commentCount: 9,
    },
  ],
  'Problem + Consequence': [
    {
      id: 'post-pc-1',
      username: 'surcraft',
      captionExcerpt:
        'Most rentals fail on lighting, and it costs you every evening you live there…',
      permalink: 'https://www.instagram.com/p/CxHi3jKlMnO/',
      format: 'Reel',
      postedAt: '2026-07-15T20:10:00+02:00',
      likeCount: 6120,
      commentCount: 274,
    },
    {
      id: 'post-pc-2',
      username: 'estudio.piedra',
      captionExcerpt: 'Your kitchen feels small because of one thing, and it is not the size…',
      permalink: 'https://www.instagram.com/p/CxIj4kLmNoP/',
      format: 'Reel',
      postedAt: '2026-07-12T21:00:00+02:00',
      likeCount: 4380,
      commentCount: 198,
    },
  ],
  'Educational explanation': [
    {
      id: 'post-ee-1',
      username: 'lumen.casa',
      captionExcerpt: 'Colour temperature, explained with four photos of the same room…',
      permalink: 'https://www.instagram.com/p/CxJk5lMnOpQ/',
      format: 'Carousel',
      postedAt: '2026-07-14T14:25:00+02:00',
      likeCount: 2905,
      commentCount: 156,
    },
  ],
  'Kitchen projects': [
    {
      id: 'post-kp-1',
      username: 'hauscasa',
      captionExcerpt: 'Nine square metres, two cooks, one very specific brief…',
      permalink: 'https://www.instagram.com/p/CxKl6mNoPqR/',
      format: 'Carousel',
      postedAt: '2026-07-11T10:40:00+02:00',
      likeCount: 3344,
      commentCount: 119,
    },
  ],
  'Before & After': [
    {
      id: 'post-ba-1',
      username: 'formaliving',
      captionExcerpt: 'Same corner, eleven weeks apart. Swipe for the structural bit…',
      permalink: 'https://www.instagram.com/p/CxLm7nOpQrS/',
      format: 'Carousel',
      postedAt: '2026-07-16T08:30:00+02:00',
      likeCount: 7210,
      commentCount: 302,
    },
  ],
  'Question hook': [
    {
      id: 'post-qh-1',
      username: 'volta.estudio',
      captionExcerpt: 'Would you have kept this wall? We were split on it for a week…',
      permalink: 'https://www.instagram.com/p/CxMn8oPqRsT/',
      format: 'Reel',
      postedAt: '2026-07-13T19:15:00+02:00',
      likeCount: 1980,
      commentCount: 411,
    },
  ],
  'Generic reveal': [
    {
      id: 'post-gr-1',
      username: 'piedraliving',
      captionExcerpt: 'Wait for the end 👀 #reform #transformation',
      permalink: 'https://www.instagram.com/p/CxNo9pQrStU/',
      format: 'Reel',
      postedAt: '2026-07-05T16:00:00+02:00',
      likeCount: 430,
      commentCount: 7,
    },
  ],
}

/** Posts for a pattern, or an empty list when we have collected none. */
export function postsFor(pattern: string): ExamplePost[] {
  return postsByPattern[pattern] ?? []
}
