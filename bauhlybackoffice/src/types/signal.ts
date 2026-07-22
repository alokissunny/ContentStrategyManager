import { z } from 'zod'
import { authorityPillar, evidenceStrength, id, isoDateTime } from './common'

/*
 * A signal is something that changed and is worth five minutes of a
 * strategist's attention. It is never computed from its own data: every
 * signal is derived from a number that already exists elsewhere in the
 * repository layer and cites where that number lives. If a signal and a
 * panel ever disagree, the signal is wrong by construction.
 */

/** An actual Instagram post. The primary source behind a claim. */
export const examplePost = z.object({
  id,
  username: z.string(),
  /** First lines of the caption, not the whole thing. */
  captionExcerpt: z.string(),
  permalink: z.url(),
  format: z.enum(['Carousel', 'Reel', 'Image']),
  postedAt: isoDateTime,
  /** Public metrics only. Reach and saves are not observable for competitors. */
  likeCount: z.number().int().nonnegative().nullable(),
  commentCount: z.number().int().nonnegative().nullable(),
})
export type ExamplePost = z.infer<typeof examplePost>

export const signalKind = z.enum([
  /** A pattern crossed a threshold in the competitor set. */
  'pattern',
  /** A customer changed state, went silent, or is failing a plan. */
  'customer',
  /** Search demand exists that nobody in the competitor set is answering. */
  'demand-gap',
  /** A play we recommend is measurably not working for customers. */
  'recommendation',
  /** Collection broke, so some other number is now stale. */
  'collection',
])
export type SignalKind = z.infer<typeof signalKind>

/** What the reader should do about it, not how bad it is. */
export const signalTone = z.enum(['opportunity', 'alert', 'watch'])
export type SignalTone = z.infer<typeof signalTone>

export const signalAction = z.object({
  label: z.string(),
  /** In-app route. Null for actions handled on the feed itself. */
  to: z.string().nullable(),
})

export const signal = z.object({
  id,
  kind: signalKind,
  tone: signalTone,
  /** One sentence. The whole point of the card. */
  headline: z.string(),
  /** The evidence, in one line. */
  detail: z.string(),
  pillar: authorityPillar.nullable(),
  /** Named facts behind the headline, each a number that exists elsewhere. */
  evidence: z.array(z.object({ label: z.string(), value: z.string() })),
  /** Where the headline number is computed. Shown so it can be checked. */
  derivedFrom: z.string(),
  strength: evidenceStrength,
  posts: z.array(examplePost),
  actions: z.array(signalAction),
  /** Higher sorts first. Composed from magnitude, recency and reach. */
  priority: z.number(),
  detectedAt: isoDateTime,
})
export type Signal = z.infer<typeof signal>
