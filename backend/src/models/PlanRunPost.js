const mongoose = require('mongoose');

// One post of a queued PlanRun: the writePlanDay result its post job produced,
// kept until the finalize job assembles and saves the whole plan. A separate
// collection keeps each run well under MongoDB's 16 MB document limit (a post's
// carousel HTML and agent prompts can run to hundreds of KB).
const planRunPostSchema = new mongoose.Schema(
  {
    run: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanRun', required: true },
    index: { type: Number, required: true },
    date: { type: String, default: '' },
    status: { type: String, enum: ['done', 'failed'], default: 'done' },
    result: { type: String, default: '' }, // JSON of the writePlanDay result
    error: { type: String, default: '' },
  },
  { timestamps: true }
);

planRunPostSchema.index({ run: 1, index: 1 }, { unique: true });
planRunPostSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('PlanRunPost', planRunPostSchema);
