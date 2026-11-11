const mongoose = require('mongoose');

/*
 * A landing visitor's Instagram, read before they have an account (bauhly-v3 Flow B, Nov 10: the
 * visitor gives their profile in Capture and the read runs in the background while they answer the
 * studio questions). The same read onboarding does — the public profile, its recent posts, and the
 * brand analysis — held here under a random token until the visitor makes an account and claims it
 * (services/visitorInstagram.js). Unclaimed reads expire after a week.
 */
const visitorInstagramReadSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    handle: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
    error: { type: String, default: '' },
    // the scraped profile fields and posts, in InstagramProfile's shape
    profile: { type: mongoose.Schema.Types.Mixed, default: null },
    posts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // generateBrandAnalysis's output
    analysis: { type: mongoose.Schema.Types.Mixed, default: null },
    // set when an account claims the read; a read still running attaches itself when it finishes
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    attachedAt: { type: Date, default: null },
    attaching: { type: Boolean, default: false },
    ip: { type: String, default: '' },
    // the read's own rows for the AI debug panel (the Apify scrape, the account analysis); a claim that
    // wanted them takes them, or — the read still running — names `debugTo`, and they are logged for that
    // account when it finishes (services/aiDebugLog.js)
    debug: { type: [mongoose.Schema.Types.Mixed], default: [] },
    debugTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 3600 },
  },
  { minimize: false }
);

visitorInstagramReadSchema.index({ handle: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('VisitorInstagramRead', visitorInstagramReadSchema);
