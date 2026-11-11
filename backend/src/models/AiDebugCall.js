const mongoose = require('mongoose');

/*
 * AI calls that ran in the background for a studio who had the debug panel on (onboarding's
 * Instagram analysis when it finished after the claim, the background Brand Voice read): no request
 * was waiting to carry their rows back, so they wait here until the panel fetches them
 * (GET /api/debug/background, frontend lib/backgroundDebug.js). `debug` is the usual
 * { mode, model, elapsedMs, agents[] } block. Kept two days.
 */
const aiDebugCallSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, default: '' },
    debug: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now, expires: 2 * 24 * 3600 },
  },
  { minimize: false }
);

aiDebugCallSchema.index({ user: 1, createdAt: 1 });

module.exports = mongoose.model('AiDebugCall', aiDebugCallSchema);
