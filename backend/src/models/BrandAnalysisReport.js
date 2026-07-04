const mongoose = require('mongoose');

const brandAnalysisReportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, required: true, trim: true, lowercase: true },
    s3Key: { type: String, required: true },
    model: { type: String, required: true },
    whoYouHelp: { type: String, default: '' },
    whatYouOffer: { type: String, default: '' },
    howYouSound: { type: String, default: '' },
    mission: { type: String, default: '' },
    values: { type: String, default: '' },
    differentiator: { type: String, default: '' },
    contentPillars: { type: String, default: '' },
    proof: { type: String, default: '' },
    visualStyle: { type: String, default: '' },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BrandAnalysisReport', brandAnalysisReportSchema);
