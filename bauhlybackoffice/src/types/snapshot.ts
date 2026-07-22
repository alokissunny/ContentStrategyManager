import { z } from 'zod'
import { id, isoDateTime } from './common'

/*
 * Timestamped observations (sections 28–29 of the brief).
 *
 * Snapshots are append-only: a new collection run adds rows, it never
 * updates old ones. "Observed change" is always the difference between two
 * snapshots — never a claim about organic growth.
 */

export const accountSnapshot = z.object({
  id,
  accountId: id,
  collectedAt: isoDateTime,
  collectionSource: z.enum(['apify', 'manual', 'mock']),
  collectionRunId: id.nullable(),

  username: z.string(),
  displayName: z.string().nullable(),
  biography: z.string().nullable(),
  website: z.string().nullable(),
  category: z.string().nullable(),
  followerCount: z.number().int().nonnegative().nullable(),
  followingCount: z.number().int().nonnegative().nullable(),
  visiblePostCount: z.number().int().nonnegative().nullable(),
  verified: z.boolean().nullable(),

  /** Field names the source did not return this run. */
  missingFields: z.array(z.string()),
  warnings: z.array(z.string()),
})
export type AccountSnapshot = z.infer<typeof accountSnapshot>

export const postFormat = z.enum(['image', 'carousel', 'reel', 'video', 'unknown'])
export type PostFormat = z.infer<typeof postFormat>

/** Permanent record of a post. Immutable facts only — public metrics live in
 * PostMetricSnapshot, classifications in Classification. */
export const post = z.object({
  id,
  platformPostId: z.string(),
  accountId: id,
  url: z.string().nullable(),
  publishedAt: isoDateTime.nullable(),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()),
  mentions: z.array(z.string()),
  format: postFormat,
  carouselCount: z.number().int().positive().nullable(),
  videoDurationSeconds: z.number().nonnegative().nullable(),
  mediaRef: z.string().nullable(),
  collaborators: z.array(z.string()),

  firstCollectedAt: isoDateTime,
  /** Post no longer visible at the source (kept for history, flagged). */
  deleted: z.boolean(),
  /** Account hides like counts etc. — metrics may be permanently null. */
  metricsHidden: z.boolean(),
  classificationStatus: z.enum(['unclassified', 'classified', 'failed', 'stale']),
})
export type Post = z.infer<typeof post>

export const postMetricSnapshot = z.object({
  id,
  postId: id,
  collectedAt: isoDateTime,
  collectionRunId: id.nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  views: z.number().int().nonnegative().nullable(),
})
export type PostMetricSnapshot = z.infer<typeof postMetricSnapshot>
