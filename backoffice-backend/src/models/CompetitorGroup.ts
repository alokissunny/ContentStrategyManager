import mongoose, { Schema } from 'mongoose'

export const GROUP_TYPES = ['peer', 'local', 'content-style', 'emerging', 'larger-account'] as const

const competitorGroupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: GROUP_TYPES, default: 'peer' },
    origin: { type: String, enum: ['manual', 'auto-suggested'], default: 'manual' },
    /** Auto-created groups stay unreviewed until a human confirms them. */
    reviewed: { type: Boolean, default: false },
    /** null = global internal group; set = customer-specific group. */
    customerId: { type: String, default: null },
    memberAccountIds: { type: [Schema.Types.ObjectId], ref: 'CompetitorAccount', default: [] },
    criteriaNote: { type: String, default: null },
  },
  { timestamps: true },
)

const competitorSuggestionSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, lowercase: true },
    reason: { type: String, default: '' },
    similarity: {
      locationMatch: { type: Boolean, default: null },
      followerRangeMatch: { type: Boolean, default: null },
      serviceMatch: { type: Boolean, default: null },
      contentStyleMatch: { type: Boolean, default: null },
    },
    suggestedRole: { type: String, default: 'peer-benchmark' },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'saved-for-later'],
      default: 'pending',
    },
    /** Set when rejected so the same account isn't re-suggested silently. */
    rejectionReason: { type: String, default: null },
    suggestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)
competitorSuggestionSchema.index({ status: 1 })

export const CompetitorGroup = mongoose.model('CompetitorGroup', competitorGroupSchema)
export const CompetitorSuggestion = mongoose.model('CompetitorSuggestion', competitorSuggestionSchema)
