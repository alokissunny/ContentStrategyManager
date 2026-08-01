const mongoose = require('mongoose');

// Meta / Instagram Professional connection for Content Publishing API.
// Tokens are long-lived Page tokens; never expose them to the client.
const metaConnectionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Instagram Business / Creator user id (Graph).
    igUserId: { type: String, default: '' },
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

metaConnectionSchema.index({ user: 1 }, { unique: true });

module.exports = mongoose.model('MetaConnection', metaConnectionSchema);
