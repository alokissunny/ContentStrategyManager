import { z } from 'zod'

/*
 * Shared building blocks for all entities.
 *
 * Conventions:
 * - Ids are opaque strings (portable across mock data, a future DB, and
 *   external platform ids, which get their own `platform*Id` fields).
 * - Timestamps are ISO 8601 strings; date-only fields are YYYY-MM-DD.
 * - Anything collected from an external platform is nullable: absence of a
 *   field is data (it feeds data-quality status), never a parse failure.
 */

export const id = z.string().min(1)
export const isoDateTime = z.iso.datetime({ offset: true })
export const isoDate = z.iso.date()

export const dateRange = z.object({
  from: isoDate,
  to: isoDate,
})
export type DateRange = z.infer<typeof dateRange>

export const location = z.object({
  country: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
})
export type Location = z.infer<typeof location>

export const followerRange = z.object({
  min: z.number().int().nonnegative(),
  /** null = unbounded ("Over 50K"). */
  max: z.number().int().positive().nullable(),
})
export type FollowerRange = z.infer<typeof followerRange>

/** Bauhly Authority pillars. Discovery/Credibility/Trust are primary. */
export const authorityPillar = z.enum([
  'discovery',
  'credibility',
  'trust',
  'conversion',
  'community',
  'brand-expression',
])
export type AuthorityPillar = z.infer<typeof authorityPillar>

/** How strongly the data supports a finding. Never presented as certainty. */
export const evidenceStrength = z.enum([
  'strong',
  'moderate',
  'exploratory',
  'inconclusive',
])
export type EvidenceStrength = z.infer<typeof evidenceStrength>

/**
 * Provenance of any value or claim shown to the strategist (section 37 of the
 * brief). Every finding-level statement must be traceable to one of these.
 */
export const evidenceKind = z.enum([
  'observed-public-fact',
  'connected-private-metric',
  'calculated-metric',
  'ai-classification',
  'human-reviewed-classification',
  'strategic-interpretation',
  'hypothesis',
  'unknown',
])
export type EvidenceKind = z.infer<typeof evidenceKind>

/** Lifecycle states shared by pattern movement and trend detection. */
export const patternState = z.enum([
  'emerging',
  'strengthening',
  'stable',
  'weakening',
  'saturated',
  'disappearing',
  'resurfacing',
  'volatile',
  'inconclusive',
])
export type PatternState = z.infer<typeof patternState>

export const dataQualityStatus = z.enum(['complete', 'partial', 'low', 'failed'])
export type DataQualityStatus = z.infer<typeof dataQualityStatus>

/**
 * The sample behind a percentage or comparison. Displayed with every finding
 * so no number appears without its basis.
 */
export const sampleContext = z.object({
  accountsAnalyzed: z.number().int().nonnegative(),
  postsAnalyzed: z.number().int().nonnegative(),
  dateRange,
  locations: z.array(location),
  followerRange: followerRange.nullable(),
  comparisonGroupLabel: z.string(),
  lastCollectionDate: isoDateTime.nullable(),
})
export type SampleContext = z.infer<typeof sampleContext>
