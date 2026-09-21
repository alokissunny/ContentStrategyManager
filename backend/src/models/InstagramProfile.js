const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    externalId: String,
    caption: String,
    likesCount: Number,
    commentsCount: Number,
    timestamp: Date,
    type: String,
    url: String,
    displayUrl: String,
  },
  { _id: false }
);

const instagramProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    fullName: { type: String, default: '' },
    biography: { type: String, default: '' },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
    profilePicUrl: { type: String, default: '' },
    // Durable S3 key for the avatar — Graph/Instagram CDN URLs expire; we re-sign this on read.
    profilePicKey: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    externalUrl: { type: String, default: '' },
    posts: [postSchema],
    // Account-level Graph insights when the handle is Meta-connected (null for Apify scrapes).
    insights: {
      fetchedAt: { type: Date, default: null },
      source: { type: String, default: '' },
      impressions: { type: Number, default: null },
      reach: { type: Number, default: null },
      profileViews: { type: Number, default: null },
      views: { type: Number, default: null },
      totalInteractions: { type: Number, default: null },
    },
    // The studio's publishing-day rule for this handle — the single source of
    // truth for which weekdays new posts may be allocated onto (the Distribute
    // panel edits it). Monday-indexed 0..6. 'days' names an explicit weekday set;
    // 'weekly' is an even spread and carries no weekday restriction into the fill.
    // Every new-post allocation consults this, so the rule governs the future
    // regardless of which client triggered generation.
    publishing: {
      mode: { type: String, enum: ['days', 'weekly'], default: 'days' },
      days: { type: [Number], default: [0, 2, 4] }, // Mon / Wed / Fri
    },
    // Where the last snapshot came from: 'apify' | 'graph'.
    dataSource: { type: String, default: 'apify' },
    fetchedAt: { type: Date, default: Date.now },
    // When this handle was last made the *current* one (via analyze or an
    // explicit switch in the header). The app's "current profile" is the handle
    // with the newest activatedAt, falling back to fetchedAt for legacy rows.
    activatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One document per (user, handle). Users can connect several handles and
// switch which one is current via activatedAt.
instagramProfileSchema.index({ user: 1, username: 1 }, { unique: true });

module.exports = mongoose.model('InstagramProfile', instagramProfileSchema);
