import mongoose, { Schema } from 'mongoose'

/*
 * One Claude analysis of the competitor register over a fixed window.
 * Latest completed run powers the Overview intelligence dashboard.
 */
const competitorAnalysisSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['running', 'completed', 'failed'],
      required: true,
      default: 'running',
    },
    windowDays: { type: Number, required: true },
    /** Claude model id (llmModel — Document.model is reserved by Mongoose). */
    llmModel: { type: String, default: null },
    /** Legacy free-form report; kept for debugging. Prefer `dashboard`. */
    markdown: { type: String, default: null },
    /** Structured Overview dashboard payload (summary, findings, hooks, …). */
    dashboard: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    accountsAnalyzed: { type: Number, default: 0 },
    postsAnalyzed: { type: Number, default: 0 },
    /** Filters used when this analysis was generated (location / followers / period). */
    filterScope: {
      type: {
        location: { type: String, default: 'Global' },
        followerRangeLabel: { type: String, default: 'All sizes' },
        period: { type: String, default: 'last-30' },
        windowDays: { type: Number, default: 30 },
      },
      default: null,
    },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'competitoranalyses' },
)

competitorAnalysisSchema.index({ finishedAt: -1 })
competitorAnalysisSchema.index({ status: 1, startedAt: -1 })
/** Lookup completed reports by the Overview filter combination. */
competitorAnalysisSchema.index({
  'filterScope.location': 1,
  'filterScope.followerRangeLabel': 1,
  'filterScope.period': 1,
  status: 1,
  finishedAt: -1,
})

export const CompetitorAnalysis = mongoose.model('CompetitorAnalysis', competitorAnalysisSchema)
