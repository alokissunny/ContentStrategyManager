import { z } from 'zod'
import { authorityPillar, dataQualityStatus, id, isoDateTime, location } from './common'

/*
 * Bauhly customers and their analytics (sections 20–24, 34 of the brief).
 *
 * Customer data (connected Meta metrics + product events) is a separate
 * world from competitor public data and is never mixed into competitor
 * benchmarks without an explicit comparison context.
 */

export const customerStatus = z.enum([
  'improving',
  'stable',
  'declining',
  'new-or-insufficient-data',
  'collection-error',
])
export type CustomerStatus = z.infer<typeof customerStatus>

export const onboardingStage = z.enum([
  'account-created',
  'instagram-connection-started',
  'instagram-connection-completed',
  'analysis-started',
  'analysis-completed',
  'analysis-viewed',
  'brand-info-viewed',
  'answers-confirmed',
  'review-mode-started',
  'review-mode-completed',
  'brand-profile-completed',
  'first-recommendation-viewed',
  'first-recommendation-accepted',
  'first-content-published',
])
export type OnboardingStage = z.infer<typeof onboardingStage>

export const customer = z.object({
  id,
  name: z.string().min(1),
  instagramUsername: z.string().nullable(),
  email: z.string().nullable(),
  location,
  plan: z.string().nullable(),
  peerGroupId: id.nullable(),

  connectionStatus: z.enum(['connected', 'disconnected', 'expired-token', 'never-connected']),
  onboardingStage,
  reviewModeStatus: z.enum(['not-started', 'in-progress', 'completed']),
  status: customerStatus,
  /** Why the status is what it is — the logic must be transparent. */
  statusReason: z.string().nullable(),

  /* Denormalized latest values for list rendering. */
  latestFollowerCount: z.number().int().nonnegative().nullable(),
  authorityGap: z
    .object({
      discovery: z.number().min(0).max(100).nullable(),
      credibility: z.number().min(0).max(100).nullable(),
      trust: z.number().min(0).max(100).nullable(),
    })
    .nullable(),
  lastActivityAt: isoDateTime.nullable(),
  dataQuality: dataQualityStatus.nullable(),
  createdAt: isoDateTime,
})
export type Customer = z.infer<typeof customer>

/** Timestamped connected-account metrics. Every field nullable — Meta
 * availability is verified per-field during integration, never assumed. */
export const customerMetricSnapshot = z.object({
  id,
  customerId: id,
  collectedAt: isoDateTime,
  periodDays: z.number().int().positive(),
  followers: z.number().int().nonnegative().nullable(),
  reach: z.number().int().nonnegative().nullable(),
  impressions: z.number().int().nonnegative().nullable(),
  saves: z.number().int().nonnegative().nullable(),
  shares: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  profileVisits: z.number().int().nonnegative().nullable(),
  websiteActions: z.number().int().nonnegative().nullable(),
  postsPublished: z.number().int().nonnegative().nullable(),
  missingFields: z.array(z.string()),
})
export type CustomerMetricSnapshot = z.infer<typeof customerMetricSnapshot>

export const editIntensity = z.enum([
  'no-edit',
  'light-edit',
  'meaningful-edit',
  'major-rewrite',
  'complete-replacement',
])
export type EditIntensity = z.infer<typeof editIntensity>

export const correctionCategory = z.enum([
  'tone',
  'brand-wording',
  'length',
  'factual-project-detail',
  'hook',
  'caption-structure',
  'cta',
  'publishing-day',
  'publishing-time',
  'content-format',
  'authority-pillar',
  'strategic-direction',
  'image-choice',
  'topic',
  'audience-fit',
])
export type CorrectionCategory = z.infer<typeof correctionCategory>

/** One generated content item's journey through review → publication
 * (sections 21–22). Adoption metrics are computed from these records. */
export const contentAdoptionRecord = z.object({
  id,
  customerId: id,
  recommendationId: id.nullable(),
  contentType: z.string().nullable(),
  authorityPillar: authorityPillar.nullable(),
  deliveredAt: isoDateTime,
  reviewedAt: isoDateTime.nullable(),
  decidedAt: isoDateTime.nullable(),
  publishedAt: isoDateTime.nullable(),
  outcome: z.enum(['pending', 'accepted', 'edited', 'rejected', 'abandoned']),
  editIntensity: editIntensity.nullable(),
  correctionCategories: z.array(correctionCategory),
})
export type ContentAdoptionRecord = z.infer<typeof contentAdoptionRecord>
