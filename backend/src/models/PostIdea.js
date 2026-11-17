const mongoose = require('mongoose');

/*
 * "What could you share next?" — one next-post idea the Next-post idea agent
 * (services/nextPostIdea.js) suggested after a plan run. Ideas come in batches
 * of up to 3 (rank 1 first; "Another idea" moves along the batch on the
 * device). `basedOn` is a fingerprint of what the agent read: while it is
 * unchanged the stored batch is served again instead of a new model call.
 *
 * status: suggested → accepted (Explore idea, a capture was started from it)
 *                   → saved     (that capture was saved for later)
 *                   → dismissed (never suggested again; fed back to the agent)
 */
const sourceRefSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['capture', 'post', 'igPost', 'memory'], required: true },
    id: { type: String, default: '' },
    label: { type: String, default: '' },
  },
  { _id: false }
);

const suggestedAssetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // S3 key of an existing capture photo / video
    captureId: { type: String, default: '' },
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const postIdeaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, trim: true, lowercase: true, default: '' },
    batchId: { type: String, required: true },
    rank: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['suggested', 'accepted', 'saved', 'dismissed'],
      default: 'suggested',
    },

    pillar: { type: String, enum: ['passion', 'skills', 'story'], required: true },
    // the ONE content mission the post serves (prompts/next-post-idea.md)
    // ('' only on ideas stored before missions existed; the agent's code requires one on every new idea)
    mission: { type: String, enum: ['', 'attract', 'nurture', 'position', 'convert'], default: '' },
    missionWhy: { type: String, default: '' }, // "Convert is missing." — why this mission now
    title: { type: String, default: '' },
    eyebrow: { type: String, default: '' }, // "Inspired by your bathroom project"
    why: { type: String, default: '' }, // why it is worth sharing, one or two sentences
    opening: { type: String, default: '' }, // Capture's first line when explored
    questions: { type: [String], default: [] }, // 1–2 things still missing
    known: { type: [String], default: [] }, // facts already on file it builds on
    sources: { type: [sourceRefSchema], default: [] },
    // no capture / post / memory behind it: it can only be asked, never claimed
    questionLed: { type: Boolean, default: false },
    assets: { type: [suggestedAssetSchema], default: [] },
    scores: { type: mongoose.Schema.Types.Mixed, default: null }, // relevance, balance, novelty, info (0–5)

    basedOn: { type: String, default: '' },
    locale: { type: String, default: 'en' },
    model: { type: String, default: '' },
    captureId: { type: String, default: '' }, // the capture started from it
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

postIdeaSchema.index({ user: 1, instagramUsername: 1, createdAt: -1 });
postIdeaSchema.index({ user: 1, instagramUsername: 1, status: 1 });

module.exports = mongoose.model('PostIdea', postIdeaSchema);
