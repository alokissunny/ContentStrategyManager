const mongoose = require('mongoose');

// One generated day of the weekly route: a content direction plus the full
// drafted content (caption, on-screen text, strategy, prompts…) behind it.
const daySchema = new mongoose.Schema(
  {
    day: { type: String, required: true },
    dateLabel: { type: String, default: '' },
    time: { type: String, default: '' },
    format: { type: String, enum: ['Reel', 'Carousel', 'Post', 'Story'], default: 'Post' },
    contentType: { type: String, default: '' },
    pillar: { type: String, enum: ['discovery', 'credibility', 'trust'], default: 'discovery' },
    goalTag: { type: String, default: '' },
    title: { type: String, default: '' },
    direction: { type: String, default: '' },
    published: { type: Boolean, default: false },
    content: {
      onScreenText: { type: [String], default: [] },
      caption: { type: String, default: '' },
      cta: { type: String, default: '' },
      hashtags: { type: [String], default: [] },
      strategy: { type: String, default: '' },
      prompts: { type: [String], default: [] },
      plan: { type: String, default: '' },
    },
  },
  { _id: false }
);

const funnelStageSchema = new mongoose.Schema(
  {
    pillar: { type: String, enum: ['discovery', 'credibility', 'trust'], required: true },
    score: { type: Number, default: 0 },
    verdict: { type: String, default: '' },
    evidence: { type: [String], default: [] },
    whyMatters: { type: String, default: '' },
    recommendation: { type: String, default: '' },
  },
  { _id: false }
);

const weeklyRouteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, default: '' },
    weekOf: { type: Date, required: true },
    weekLabel: { type: String, default: '' },
    model: { type: String, default: '' },
    // Weekly focus narrative (the "This week's focus" card).
    focus: {
      pillar: { type: String, enum: ['discovery', 'credibility', 'trust'], default: 'trust' },
      headline: { type: String, default: '' },
      hypothesis: { type: String, default: '' },
      recommendation: { type: String, default: '' },
      whyMatters: { type: String, default: '' },
      observation: { type: String, default: '' },
    },
    // Discovery → Credibility → Trust status (deterministic from the snapshot).
    funnel: [funnelStageSchema],
    days: [daySchema],
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One current route per user; regenerating overwrites it.
weeklyRouteSchema.index({ user: 1, weekOf: -1 });

module.exports = mongoose.model('WeeklyRoute', weeklyRouteSchema);
