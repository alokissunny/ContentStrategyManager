const mongoose = require('mongoose');

// Meta / Instagram Professional connection for Content Publishing API.
// One row per Instagram Professional account linked to a Bauhly user — so a
// login with several app handles can each have its own Meta Page token.
// Tokens are long-lived Page tokens; never expose them to the client.
const metaConnectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Instagram Business / Creator user id (Graph).
    igUserId: { type: String, default: '', required: true },
    igUsername: { type: String, default: '', trim: true, lowercase: true },
    // Facebook Page that owns the IG account.
    pageId: { type: String, default: '' },
    pageName: { type: String, default: '' },
    // Encrypted-at-rest later; stored server-side only.
    accessToken: { type: String, default: '', select: false },
    tokenExpiresAt: { type: Date, default: null },
    scopes: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['connected', 'expired', 'revoked', 'pending'],
      default: 'pending',
    },
    connectedAt: { type: Date, default: null },
    lastPublishAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One Meta IG account per Bauhly user (reconnect updates the same row).
metaConnectionSchema.index({ user: 1, igUserId: 1 }, { unique: true });
metaConnectionSchema.index({ user: 1, igUsername: 1 });

module.exports = mongoose.model('MetaConnection', metaConnectionSchema);
