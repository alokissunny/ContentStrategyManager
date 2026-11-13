const mongoose = require('mongoose');

// A 9:16 Instagram reel made from one capture (Captures › Generate reel) by
// services/captureReelAgent.js. Generation runs in the background; the page
// polls this document. `stage` is what the studio sees while it works.
const captureReelSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, trim: true, lowercase: true, default: null },
    // the capture session it was cut from (every member capture of the row)
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    captureIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    direction: { type: String, default: '' }, // the studio's note for this reel
    status: { type: String, enum: ['queued', 'working', 'done', 'error'], default: 'queued' },
    stage: { type: String, default: 'queued' }, // reading | writing | voicing | cutting | saving
    error: { type: String, default: '' },
    // what actually went wrong (for the team: debug panel / admin), never shown as is
    errorDetail: { type: String, default: '' },
    // the director's cut list (as returned, validated) + the frame timeline rendered
    plan: { type: mongoose.Schema.Types.Mixed, default: null },
    timeline: { type: mongoose.Schema.Types.Mixed, default: null },
    caption: { type: String, default: '' },
    hashtags: { type: [String], default: [] },
    videoKey: { type: String, default: '' },
    posterKey: { type: String, default: '' },
    voiceKey: { type: String, default: '' },
    musicKey: { type: String, default: '' }, // generated music bed (styled reels)
    // Captures › Generate reel › Choose reel style (null = Bauhly's default look)
    styleId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReelStyle', default: null },
    styleName: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    model: { type: String, default: '' },
    costUsd: { type: Number, default: 0 },
    // ms per stage (reading, writing, voicing, cutting, rendering, saving, render · bundle, render · frames)
    timings: { type: mongoose.Schema.Types.Mixed, default: null },
    // the calendar post it was placed on (PlannedPost, format Reel)
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlannedPost', default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

captureReelSchema.index({ user: 1, captureIds: 1, createdAt: -1 });

module.exports = mongoose.model('CaptureReel', captureReelSchema);
