import mongoose, { Schema, type InferSchemaType } from 'mongoose'

/*
 * The competitor register: identity + internal management state only.
 *
 * This record is NEVER the source of truth for metrics — followers and other
 * time-varying values live in append-only AccountSnapshots. The few metric
 * fields here are denormalized copies of the latest snapshot, kept purely so
 * the list view can render without an aggregation per row.
 */

export const APPROVAL_STATUSES = [
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
] as const

export const COMPETITOR_ROLES = [
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
] as const

export const DATA_QUALITY = ['complete', 'partial', 'low', 'failed'] as const

/** Statuses that make up the "tracked" working set (and get collected). */
export const TRACKED_STATUSES = ['included-in-benchmarks', 'approved', 'watchlist-only'] as const

const locationSchema = new Schema(
  {
    country: { type: String, default: null },
    region: { type: String, default: null },
    city: { type: String, default: null },
  },
  { _id: false },
)

const competitorAccountSchema = new Schema(
  {
    platform: { type: String, enum: ['instagram'], default: 'instagram' },
    username: { type: String, required: true, trim: true, lowercase: true },
    displayName: { type: String, default: null },
    profileImageUrl: { type: String, default: null },
    website: { type: String, default: null },
    location: { type: locationSchema, default: () => ({}) },
    language: { type: String, default: null },
    niche: { type: String, default: null },
    services: { type: [String], default: [] },
    specialization: { type: String, default: null },
    targetAudience: { type: String, default: null },
    positioningNote: { type: String, default: null },

    role: { type: String, enum: COMPETITOR_ROLES, default: 'peer-benchmark' },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'awaiting-review' },
    groupIds: { type: [String], default: [] },
    relevantCustomerIds: { type: [String], default: [] },
    internalNotes: { type: String, default: null },

    // Denormalized from the latest snapshot — snapshots stay authoritative.
    latestFollowerCount: { type: Number, default: null },
    lastSuccessfulCollectionAt: { type: Date, default: null },
    /**
     * When posts were last scraped (profile-only runs leave this untouched).
     * Drives the "already scraped recently, skip" check on manual post
     * collection, so it must not be conflated with the profile timestamp above.
     */
    lastPostsCollectedAt: { type: Date, default: null },
    /**
     * When Claude enrichment last completed. Drives the "already enriched
     * recently, skip" check on Run enrichment (same window as post scrape).
     */
    lastEnrichmentAt: { type: Date, default: null },
    /** Structured metadata from Run enrichment — useful for later analysis. */
    enrichment: {
      type: {
        country: { type: String, default: null },
        countryConfidence: { type: String, default: null },
        accountType: { type: String, default: null },
        followersCount: { type: Number, default: null },
        postsAnalyzed: { type: Number, default: null },
        averagePostsPerWeek: { type: Number, default: null },
        postingFrequency: { type: String, default: null },
        averageLikes: { type: Number, default: null },
        averageComments: { type: Number, default: null },
        engagementRate: { type: Number, default: null },
        estimatedPerformance: { type: String, default: null },
        primaryContentType: { type: String, default: null },
        dominantPostFormat: { type: String, default: null },
        latestPostDate: { type: String, default: null },
        model: { type: String, default: null },
      },
      default: null,
    },
    dataQuality: { type: String, enum: [...DATA_QUALITY, null], default: null },

    addedAt: { type: Date, default: Date.now },
    addedBy: { type: String, enum: ['manual', 'discovery'], default: 'manual' },
  },
  { timestamps: true },
)

competitorAccountSchema.index({ platform: 1, username: 1 }, { unique: true })
competitorAccountSchema.index({ approvalStatus: 1 })

export type CompetitorAccountDoc = InferSchemaType<typeof competitorAccountSchema>
export const CompetitorAccount = mongoose.model('CompetitorAccount', competitorAccountSchema)
