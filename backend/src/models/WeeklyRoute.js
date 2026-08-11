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
      // Structured slides for carousels / multi-frame posts. Roles like Hook,
      // Setup, Process, Result, CTA. assetKey ties a slide to a project photo.
      slides: {
        type: [
          {
            role: { type: String, default: '' },
            title: { type: String, default: '' },
            // The supporting line under the title — the second piece of on-slide
            // copy the layout can show (e.g. a subtitle beneath a hook). Real
            // words written with the plan, so a layout's body slot is never a
            // placeholder. Empty is fine — the slide is then title-only.
            subtitle: { type: String, default: '' },
            // A rich, self-contained BASE image prompt for this slide, written
            // while the plan is built so it already carries the post's topic,
            // this slide's role and message, subject, setting and composition.
            // The studio's live Visual Brand (palette, type) and Visual Mood are
            // layered on at generation time (see WeekView CreateImageChat) — this
            // is only the context-heavy base, never the brand/mood.
            imagePrompt: { type: String, default: '' },
            assetKey: { type: String, default: '' },
            // Layout id from the Visual Brand layout system (e.g. a hook layout
            // 'H1'/'H2'/'H3'). Empty = the slide's default composition.
            layout: { type: String, default: '' },
          },
        ],
        default: [],
      },
      onScreenText: { type: [String], default: [] },
      caption: { type: String, default: '' },
      cta: { type: String, default: '' },
      hashtags: { type: [String], default: [] },
      strategy: { type: String, default: '' },
      prompts: { type: [String], default: [] },
      plan: { type: String, default: '' },
      notes: { type: String, default: '' },
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
    // ── Monthly plan grouping ──────────────────────────────────────────────
    // A plan is a month of 4 weeks that share one focus. These stamp which
    // month/week a route is, so the queue can group by month and lock the ones
    // Bauhly hasn't written yet.
    monthKey: { type: String, default: '' },   // e.g. "Aug 2026" — the group key
    monthName: { type: String, default: '' },  // e.g. "August"
    monthIndex: { type: Number, default: 0 },   // 0 = this month's run, 1 = next
    weekIndex: { type: Number, default: 0 },    // 0..3 within the month
    startsAt: { type: Date, default: null },     // the Monday this week starts
    // When Bauhly "finishes writing" this week. A draft with readyAt in the
    // future is locked/disabled in the UI ("finishes writing it on <date>").
    readyAt: { type: Date, default: null },
    // A placeholder week: scheduled but no strategy written yet (next month).
    draft: { type: Boolean, default: false },
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
    // LLM usage for this week's generation (for cost / token display on Your plans).
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      estimatedCostUsd: { type: Number, default: 0 },
      model: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

// One current route per user; regenerating overwrites it.
weeklyRouteSchema.index({ user: 1, weekOf: -1 });

module.exports = mongoose.model('WeeklyRoute', weeklyRouteSchema);
