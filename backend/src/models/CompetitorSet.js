const mongoose = require('mongoose');

const competitorSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    name: { type: String, default: '' },
    region: { type: String, default: '' },
    designStyle: { type: String, default: '' },
    targetClient: { type: String, default: '' },
    serviceOffering: { type: String, default: '' },
    estimatedFollowers: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
    followersVerified: { type: Boolean, default: false },
    profilePicUrl: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    matchReasons: { type: [String], default: [] },
    exists: { type: Boolean, default: null },
    cohort: { type: String, enum: ['similar', 'higher', 'smaller'], default: 'similar' },
  },
  { _id: false }
);

const competitorSetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    baseRegion: { type: String, default: '' },
    baseFollowers: { type: Number, default: 0 },
    model: { type: String, default: '' },
    competitors: [competitorSchema],
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One competitor set per (user, handle); re-running overwrites the snapshot.
competitorSetSchema.index({ user: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('CompetitorSet', competitorSetSchema);
