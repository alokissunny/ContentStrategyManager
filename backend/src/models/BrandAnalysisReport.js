const mongoose = require('mongoose');

const memoryGapSchema = new mongoose.Schema(
  {
    key: { type: String, default: '' },
    missing: { type: String, default: '' },
    why: { type: String, default: '' },
    improves: { type: String, default: '' },
    prompt: { type: String, default: '' },
    question: { type: String, default: '' },
  },
  { _id: false }
);

const brandAnalysisReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, required: true, trim: true, lowercase: true },
    s3Key: { type: String, required: true },
    model: { type: String, required: true },
    // Brand Profile fields (all inferred from the analyzed page).
    whatYouOffer: { type: String, default: '' },
    whoYouHelp: { type: String, default: '' },
    firstProblem: { type: String, default: '' },
    position: { type: String, default: '' },
    proof: { type: String, default: '' },
    howYouSound: { type: String, default: '' },
    visualStyle: { type: String, default: '' },
    neverDo: { type: String, default: '' },
    confirmedAt: { type: Date, default: null },
    brandDnaClearedAt: { type: Date, default: null },
    // Planning gaps for the Business memory banner — written from this account's
    // current fields, not a hardcoded catalog. Empty array means nothing blocking.
    memoryGaps: { type: [memoryGapSchema], default: [] },
    memoryGapsAssessedAt: { type: Date, default: null },
    // Link to the detailed competitor-analysis Markdown (stored in S3).
    competitorAnalysisS3Key: { type: String, default: '' },
    competitorAnalysisAt: { type: Date, default: null },
  },
  { timestamps: true }
);

brandAnalysisReportSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('BrandAnalysisReport', brandAnalysisReportSchema);
