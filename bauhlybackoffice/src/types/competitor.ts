import { z } from 'zod'
import { dataQualityStatus, id, isoDateTime, location } from './common'

/*
 * Competitor accounts and groups (sections 25–26 of the brief).
 *
 * The account record holds identity and internal management state only.
 * Anything that changes over time (followers, biography, …) lives in
 * timestamped AccountSnapshots — the account record is never the source of
 * truth for metrics.
 */

export const approvalStatus = z.enum([
  'suggested',
  'awaiting-review',
  'approved',
  'included-in-benchmarks',
  'watchlist-only',
  'excluded',
  'inactive',
  'private',
  'collection-failed',
  'deleted',
  'needs-reclassification',
])
export type ApprovalStatus = z.infer<typeof approvalStatus>

export const competitorRole = z.enum([
  'direct-competitor',
  'peer-benchmark',
  'local-competitor',
  'high-performing-peer',
  'aspirational',
  'emerging',
  'content-style',
  'format-specialist',
  'positioning-reference',
  'negative-reference',
  'category-leader',
])
export type CompetitorRole = z.infer<typeof competitorRole>

export const competitorAccount = z.object({
  id,
  platform: z.literal('instagram'),
  username: z.string().min(1),
  displayName: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  website: z.string().nullable(),
  location,
  language: z.string().nullable(),
  niche: z.string().nullable(),
  services: z.array(z.string()),
  specialization: z.string().nullable(),
  targetAudience: z.string().nullable(),
  positioningNote: z.string().nullable(),

  role: competitorRole,
  approvalStatus,
  groupIds: z.array(id),
  relevantCustomerIds: z.array(id),
  internalNotes: z.string().nullable(),

  /* Denormalized from the latest snapshot for list rendering — the snapshot
   * remains authoritative. */
  latestFollowerCount: z.number().int().nonnegative().nullable(),
  lastSuccessfulCollectionAt: isoDateTime.nullable(),
  /** Null until posts have been scraped at least once via Scrape posts. */
  lastPostsCollectedAt: isoDateTime.nullable().optional(),
  /** Null until Run enrichment has completed at least once. */
  lastEnrichmentAt: isoDateTime.nullable().optional(),
  enrichment: z
    .object({
      country: z.string().nullable(),
      countryConfidence: z.string().nullable(),
      accountType: z.string().nullable(),
      followersCount: z.number().nullable(),
      postsAnalyzed: z.number().nullable(),
      averagePostsPerWeek: z.number().nullable(),
      postingFrequency: z.string().nullable(),
      averageLikes: z.number().nullable(),
      averageComments: z.number().nullable(),
      engagementRate: z.number().nullable(),
      estimatedPerformance: z.string().nullable(),
      primaryContentType: z.string().nullable(),
      dominantPostFormat: z.string().nullable(),
      latestPostDate: z.string().nullable(),
      model: z.string().nullable(),
    })
    .nullable()
    .optional(),
  dataQuality: dataQualityStatus.nullable(),

  addedAt: isoDateTime,
  addedBy: z.enum(['manual', 'discovery']),
})
export type CompetitorAccount = z.infer<typeof competitorAccount>

export const groupType = z.enum([
  'peer',
  'local',
  'content-style',
  'emerging',
  'larger-account',
])
export type GroupType = z.infer<typeof groupType>

export const competitorGroup = z.object({
  id,
  name: z.string().min(1),
  type: groupType,
  origin: z.enum(['manual', 'auto-suggested']),
  /** Auto-created groups stay unreviewed until a human confirms them. */
  reviewed: z.boolean(),
  /** null = global internal group; set = customer-specific group. */
  customerId: id.nullable(),
  memberAccountIds: z.array(id),
  criteriaNote: z.string().nullable(),
  createdAt: isoDateTime,
})
export type CompetitorGroup = z.infer<typeof competitorGroup>

/** An automatic discovery suggestion awaiting human review (section 25.3). */
export const competitorSuggestion = z.object({
  id,
  username: z.string().min(1),
  reason: z.string(),
  similarity: z.object({
    locationMatch: z.boolean().nullable(),
    followerRangeMatch: z.boolean().nullable(),
    serviceMatch: z.boolean().nullable(),
    contentStyleMatch: z.boolean().nullable(),
  }),
  suggestedRole: competitorRole,
  confidence: z.number().min(0).max(1),
  status: z.enum(['pending', 'approved', 'rejected', 'saved-for-later']),
  /** Set when rejected so the same account isn't re-suggested silently. */
  rejectionReason: z.string().nullable(),
  suggestedAt: isoDateTime,
})
export type CompetitorSuggestion = z.infer<typeof competitorSuggestion>

/*
 * The untouched Apify item behind a collected post.
 *
 * `payload` is deliberately unvalidated: it is whatever the actor returned, and
 * the whole point of showing it is to see fields our mapping does not know
 * about. Validating it would defeat the purpose. `null` means the post predates
 * raw capture — an absent record, not an empty one.
 */
export const rawPostItem = z.object({
  platformPostId: z.string(),
  publishedAt: isoDateTime.nullable(),
  url: z.string().nullable(),
  collectedAt: isoDateTime.nullable(),
  source: z.string().nullable(),
  payload: z.unknown().nullable(),
})
export type RawPostItem = z.infer<typeof rawPostItem>

export const rawPostsResponse = z.object({
  username: z.string(),
  /** Null when collection has never succeeded for this account. */
  lastCollectedAt: isoDateTime.nullable(),
  /** The backfill window, so an empty list can say what it was measured against. */
  windowDays: z.number(),
  /** Posts on record for the account, which may exceed the page returned. */
  totalPosts: z.number(),
  /** How many of them have a stored raw payload. */
  capturedCount: z.number(),
  items: z.array(rawPostItem),
})
export type RawPostsResponse = z.infer<typeof rawPostsResponse>
