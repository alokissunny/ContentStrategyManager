import mongoose, { Schema } from 'mongoose'

/*
 * Timestamped observations. These collections are APPEND-ONLY: a collection run
 * adds rows, it never updates old ones. Any "observed change" shown in the UI is
 * the difference between two snapshot rows — never a stored growth figure.
 *
 * The one exception is competitor posts, which hold immutable *facts* about a
 * post (caption, format, publishedAt). Those are upserted on re-collection so a
 * post isn't duplicated; changing metrics go to post_metric_snapshots instead.
 *
 * COLLECTION NAMES ARE PINNED EXPLICITLY, deliberately.
 *
 * We share a database with the customer API, so Mongoose's default (lowercased,
 * pluralised model name) is not safe: `Post` resolves to `posts`, which the
 * customer app already owns — including a UNIQUE, NON-SPARSE index on
 * `instagramId`. Backoffice posts have no `instagramId`, so Mongo read them all
 * as `instagramId: null` and let exactly ONE be inserted; every post after the
 * first failed with E11000. That surfaced as accounts stuck on
 * dataQuality: 'partial' with no posts, which looks like a scraper problem and
 * is not one. Competitor posts therefore live in their own collection, and
 * every model below names its collection so the next one cannot collide by
 * accident.
 */

const accountSnapshotSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'CompetitorAccount', required: true },
    collectedAt: { type: Date, default: Date.now },
    collectionSource: { type: String, enum: ['apify', 'manual', 'mock'], default: 'apify' },
    collectionRunId: { type: Schema.Types.ObjectId, ref: 'CollectionRun', default: null },

    username: { type: String, required: true },
    displayName: { type: String, default: null },
    biography: { type: String, default: null },
    website: { type: String, default: null },
    category: { type: String, default: null },
    followerCount: { type: Number, default: null },
    followingCount: { type: Number, default: null },
    visiblePostCount: { type: Number, default: null },
    verified: { type: Boolean, default: null },

    /** Field names the source did not return this run — feeds dataQuality. */
    missingFields: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'accountsnapshots' },
)
accountSnapshotSchema.index({ accountId: 1, collectedAt: -1 })

export const POST_FORMATS = ['image', 'carousel', 'reel', 'video', 'unknown'] as const

const postSchema = new Schema(
  {
    platformPostId: { type: String, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CompetitorAccount', required: true },
    url: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    caption: { type: String, default: null },
    hashtags: { type: [String], default: [] },
    mentions: { type: [String], default: [] },
    format: { type: String, enum: POST_FORMATS, default: 'unknown' },
    carouselCount: { type: Number, default: null },
    videoDurationSeconds: { type: Number, default: null },
    mediaRef: { type: String, default: null },
    collaborators: { type: [String], default: [] },

    firstCollectedAt: { type: Date, default: Date.now },
    /** No longer visible at the source; kept for history and flagged. */
    deleted: { type: Boolean, default: false },
    /** Account hides like counts — metrics may be permanently null. */
    metricsHidden: { type: Boolean, default: false },
    classificationStatus: {
      type: String,
      enum: ['unclassified', 'classified', 'failed', 'stale'],
      default: 'unclassified',
    },
    /** Bauhly Authority pillar from Claude classification. */
    authorityPillar: {
      type: String,
      enum: ['discovery', 'credibility', 'trust'],
      default: null,
    },
    classifiedHookType: { type: String, default: null },
    classifiedTopic: { type: String, default: null },
    classifiedAt: { type: Date, default: null },
    classifiedModel: { type: String, default: null },
  },
  { timestamps: true, collection: 'competitor_posts' },
)
postSchema.index({ accountId: 1, platformPostId: 1 }, { unique: true })
postSchema.index({ accountId: 1, publishedAt: -1 })
postSchema.index({ authorityPillar: 1, publishedAt: -1 })

const postMetricSnapshotSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'CompetitorAccount', required: true },
    collectedAt: { type: Date, default: Date.now },
    collectionRunId: { type: Schema.Types.ObjectId, ref: 'CollectionRun', default: null },
    likes: { type: Number, default: null },
    comments: { type: Number, default: null },
    views: { type: Number, default: null },
  },
  { timestamps: true, collection: 'postmetricsnapshots' },
)
postMetricSnapshotSchema.index({ postId: 1, collectedAt: -1 })
postMetricSnapshotSchema.index({ accountId: 1, collectedAt: -1 })

/*
 * The untouched Apify item behind each post, kept so the backoffice can show
 * what the source actually returned. Normalisation is lossy and defensive (it
 * reads a few aliases per field and drops the rest), so when a number looks
 * wrong this is the only way to tell a scraper problem from a mapping problem.
 *
 * Latest-only, unlike the snapshot collections: one document per post, replaced
 * on re-collection. This is a debugging aid, not observed history — keeping a
 * copy per run would multiply the largest documents in the database by every
 * collection, and the metrics that genuinely change are already tracked in
 * post_metric_snapshots.
 */
const rawPostPayloadSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'CompetitorAccount', required: true },
    platformPostId: { type: String, required: true },
    collectedAt: { type: Date, default: Date.now },
    source: { type: String, enum: ['apify', 'manual', 'mock'], default: 'apify' },
    /** Exactly what the actor returned for this post — never reshaped. */
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'rawpostpayloads' },
)
rawPostPayloadSchema.index({ accountId: 1, platformPostId: 1 }, { unique: true })
rawPostPayloadSchema.index({ accountId: 1, collectedAt: -1 })

const collectionRunSchema = new Schema(
  {
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    source: { type: String, default: 'Apify' },
    trigger: { type: String, enum: ['manual', 'scheduled'], default: 'manual' },
    accountsProcessed: { type: Number, default: 0 },
    postsCollected: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    /** Per-account outcome so a partial run is still auditable. */
    results: {
      type: [
        new Schema(
          {
            accountId: { type: Schema.Types.ObjectId, ref: 'CompetitorAccount' },
            username: String,
            ok: Boolean,
            postsCollected: { type: Number, default: 0 },
            error: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'collectionruns' },
)
collectionRunSchema.index({ startedAt: -1 })

export const AccountSnapshot = mongoose.model('AccountSnapshot', accountSnapshotSchema)
export const Post = mongoose.model('Post', postSchema)
export const PostMetricSnapshot = mongoose.model('PostMetricSnapshot', postMetricSnapshotSchema)
export const CollectionRun = mongoose.model('CollectionRun', collectionRunSchema)
export const RawPostPayload = mongoose.model('RawPostPayload', rawPostPayloadSchema)
