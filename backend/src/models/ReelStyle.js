const mongoose = require('mongoose');

// A reel style — the editing pattern of a reference Instagram reel (pacing, cut
// rhythm, hook, on-screen type, captions, audio/music, structure), analysed by
// services/reelStyleAnalyzer.js. Captures › Generate reel › Choose reel style
// cuts a capture into a reel that follows it. Styles are shared across the app
// (curated by admins); the reference's own audio and footage are never reused —
// only its measured pattern.
const reelStyleSchema = new mongoose.Schema(
  {
    shortCode: { type: String, required: true, unique: true },
    sourceUrl: { type: String, default: '' },
    ownerUsername: { type: String, default: '' },
    name: { type: String, default: '' },
    summary: { type: String, default: '' },
    status: { type: String, enum: ['analyzing', 'ready', 'error'], default: 'analyzing' },
    error: { type: String, default: '' },
    thumbKey: { type: String, default: '' }, // S3 key of a still from the reference
    durationSec: { type: Number, default: 0 },
    // measured: cuts (sec), shot stats, tempo, speech rate — see analyzer
    measured: { type: mongoose.Schema.Types.Mixed, default: null },
    // the style spec the director + renderer follow (see analyzer STYLE_TOOL)
    style: { type: mongoose.Schema.Types.Mixed, default: null },
    order: { type: Number, default: 0 },
    // shared = in everyone's picker (curated); otherwise only the studios in
    // addedBy see it (pasted from a reel link in Generate reel). hidden takes a
    // shared style out of the shared list (an admin's Remove).
    shared: { type: Boolean, default: false },
    addedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    hidden: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    model: { type: String, default: '' },
    costUsd: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReelStyle', reelStyleSchema);
