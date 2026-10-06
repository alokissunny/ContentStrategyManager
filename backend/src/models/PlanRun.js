const mongoose = require('mongoose');

// One queued post-generation run (POST /posts/generate with PLAN_QUEUE on).
// The jobs in services/planQueue carry only this run's id; everything they
// hand to each other lives here (state) or on PlanRunPost (one per post), so a
// retried job sees exactly the inputs the first attempt saw.
const planRunSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, required: true },
    trigger: { type: String, default: 'generate' },
    status: {
      type: String,
      enum: ['queued', 'planning', 'writing', 'finalizing', 'done', 'needs-input', 'failed'],
      default: 'queued',
    },
    planSource: {
      sessionId: { type: String, default: '' },
      captureIds: { type: [String], default: [] },
      // Mixed, not [Number]: null ("any weekday") must survive the round trip —
      // an array path would come back as [] and allow no weekday at all.
      allowedWeekdays: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    // JSON of { pre, phase, usedAssetKeys } — weeklyPlan.prepareWeeklyPlan and
    // planOrchestrator.runStrategistPhase output. Stored as a string so model
    // output keys never collide with MongoDB's field-name rules.
    state: { type: String, default: '' },
    totalPosts: { type: Number, default: 0 },
    // The response POST /posts/generate would have sent, once finished.
    result: {
      postIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      count: { type: Number, default: 0 },
      emptyReason: { type: String, default: '' },
      needsInput: { type: Boolean, default: false },
      debug: { type: String, default: '' }, // JSON of the plan debug trace
    },
    error: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

planRunSchema.index({ user: 1, instagramUsername: 1, status: 1 });
// Finished runs are only needed for status polling and debugging.
planRunSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('PlanRun', planRunSchema);
