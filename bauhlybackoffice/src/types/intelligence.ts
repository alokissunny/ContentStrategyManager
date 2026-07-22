import { z } from 'zod'
import {
  authorityPillar,
  evidenceKind,
  evidenceStrength,
  id,
  isoDateTime,
  patternState,
  sampleContext,
} from './common'

/*
 * Analysis output entities: findings, patterns, trends, recommendations,
 * the live intelligence document, and the monthly review
 * (sections 11–15, 31–33 of the brief).
 *
 * A Finding is the atomic unit: a comparative claim plus the full sample
 * context and limitations behind it. Nothing here implies causality.
 */

/** A comparative or descriptive claim backed by data. */
export const finding = z.object({
  id,
  title: z.string().min(1),
  explanation: z.string(),
  kind: z.enum([
    'stronger-account-difference',
    'common-pattern',
    'pattern-movement',
    'monthly-change',
    'biography-positioning',
    'weekly-behavior',
    'hook-performance',
    'customer-gap',
  ]),
  dimension: z.string().nullable(),
  authorityPillar: authorityPillar.nullable(),

  /** e.g. "22% of relevant posts" for the focus group. */
  focusValue: z.number().nullable(),
  comparisonValue: z.number().nullable(),
  /** Percentage points, ratio, or absolute — declared, never implied. */
  valueUnit: z.enum(['percent-of-posts', 'percent-of-accounts', 'per-week', 'ratio', 'absolute']).nullable(),
  /** Visible definition of what the numbers mean (section 13). */
  metricDefinition: z.string(),

  sample: sampleContext,
  evidenceStrength,
  evidenceKinds: z.array(evidenceKind),
  limitations: z.array(z.string()),
  /** Always present: public data cannot see ads/boosts (section 37). */
  paidDistributionUncertainty: z.boolean(),
  exampleAccountIds: z.array(id),
  examplePostIds: z.array(id),

  /* Recommendation-ready gate (section 15) — computed in code from the
   * thresholds config, stored with the reasons so the gate is inspectable. */
  recommendationReady: z.boolean(),
  recommendationReadyReasons: z.array(z.string()),
  reproducibilityNote: z.string().nullable(),
  suggestedExperiment: z.string().nullable(),
  relevantCustomerIds: z.array(id),

  humanReviewed: z.boolean(),
  detectedAt: isoDateTime,
})
export type Finding = z.infer<typeof finding>

/** One row in the pattern-movement table (section 13). */
export const patternMovement = z.object({
  id,
  dimension: z.enum([
    'format',
    'topic',
    'hook',
    'caption-structure',
    'hashtag',
    'authority-pillar',
    'visual-attribute',
    'posting-day',
    'posting-time',
    'content-type',
  ]),
  pattern: z.string(),
  previousValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  changePp: z.number().nullable(),
  state: patternState,
  metricDefinition: z.string(),
  relativePerformance: z.number().nullable(),
  sample: sampleContext,
  evidenceStrength,
})
export type PatternMovement = z.infer<typeof patternMovement>

/** Longer-lived trend record (section 31). */
export const trend = z.object({
  id,
  name: z.string(),
  scope: z.enum(['platform', 'category', 'geographic', 'account-size', 'seasonal']),
  firstDetectedAt: isoDateTime,
  state: patternState,
  adoptionRate: z.number().nullable(),
  previousAdoptionRate: z.number().nullable(),
  accountsUsing: z.number().int().nonnegative(),
  postsUsing: z.number().int().nonnegative(),
  durationDays: z.number().int().nonnegative().nullable(),
  saturationRisk: z.enum(['low', 'medium', 'high']).nullable(),
  brandFitNote: z.string().nullable(),
  evidenceStrength,
  recommendationState: z.enum(['use', 'adapt', 'watch', 'ignore', 'retire']),
})
export type Trend = z.infer<typeof trend>

export const recommendation = z.object({
  id,
  findingIds: z.array(id).min(1),
  customerId: id.nullable(),
  title: z.string(),
  body: z.string(),
  authorityPillar: authorityPillar.nullable(),
  status: z.enum(['draft', 'approved', 'delivered', 'retired']),
  /** A strategist must approve before anything reaches a customer. */
  approvedBy: z.string().nullable(),
  approvedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
})
export type Recommendation = z.infer<typeof recommendation>

/* ── Live intelligence document (section 33) ─────────────────────────────── */

export const documentSection = z.object({
  id,
  kind: z.enum([
    'active-filters',
    'executive-summary',
    'stronger-account-differences',
    'common-patterns',
    'emerging-patterns',
    'weakening-patterns',
    'authority-pillar-findings',
    'hooks-and-captions',
    'weekly-behavior',
    'customer-gaps',
    'recommendation-ready',
    'limitations',
    'data-quality',
    'custom-note',
  ]),
  title: z.string(),
  /** Generated content refreshes with filters; pinned/edited content is
   * preserved and marked as possibly out of sync with current filters. */
  source: z.enum(['generated', 'pinned', 'manually-edited']),
  matchesCurrentFilters: z.boolean(),
  findingIds: z.array(id),
  body: z.string().nullable(),
  order: z.number().int().nonnegative(),
})
export type DocumentSection = z.infer<typeof documentSection>

export const intelligenceDocument = z.object({
  id,
  title: z.string(),
  /** Serialized filter state the document was generated from. */
  filterState: z.record(z.string(), z.unknown()),
  sections: z.array(documentSection),
  linkedCustomerIds: z.array(id),
  savedAsMonthlyReviewId: id.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})
export type IntelligenceDocument = z.infer<typeof intelligenceDocument>

/* ── Monthly review (section 32) ─────────────────────────────────────────── */

export const monthlyReview = z.object({
  id,
  period: z.object({ month: z.number().int().min(1).max(12), year: z.number().int() }),
  comparedToPeriod: z.object({ month: z.number().int().min(1).max(12), year: z.number().int() }),
  summary: z.object({
    accountsMonitored: z.number().int().nonnegative(),
    newAccountsAdded: z.number().int().nonnegative(),
    newPostsCollected: z.number().int().nonnegative(),
    collectionFailures: z.number().int().nonnegative(),
    customersAffected: z.number().int().nonnegative(),
    recommendationReadyCount: z.number().int().nonnegative(),
  }),
  findingIds: z.array(id),
  patternMovementIds: z.array(id),
  outlierNotes: z.array(
    z.object({
      accountId: id.nullable(),
      kind: z.enum([
        'sudden-follower-change',
        'unusual-high-performing-post',
        'activity-decline',
        'new-campaign',
        'positioning-change',
        'new-format-adoption',
        'potential-paid-influence',
        'collection-anomaly',
      ]),
      note: z.string(),
    }),
  ),
  createdAt: isoDateTime,
})
export type MonthlyReview = z.infer<typeof monthlyReview>
