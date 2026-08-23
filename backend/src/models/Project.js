const mongoose = require('mongoose');

// AI-derived metadata for one asset — filled in on demand when the user runs
// "Analyze with AI". `status` tracks the run so the UI can show a spinner /
// error and re-analysis. The descriptive fields are best-effort: the model may
// leave some empty, so nothing here is required.
const analysisSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ['pending', 'done', 'error'], default: 'pending' },
    summary: { type: String, default: '' }, // one-line caption
    description: { type: String, default: '' }, // a fuller paragraph
    tags: { type: [String], default: [] }, // keywords for search / planning
    colors: { type: [String], default: [] }, // dominant colours (names or hex)
    mood: { type: String, default: '' }, // overall feeling / tone
    subjects: { type: [String], default: [] }, // main objects / people / scene
    text: { type: String, default: '' }, // any legible text in the image
    model: { type: String, default: '' }, // which model produced this
    inputTokens: { type: Number, default: 0 }, // vision-request input tokens (image + prompt)
    outputTokens: { type: Number, default: 0 }, // response tokens
    costUsd: { type: Number, default: 0 }, // approximate USD cost of this analysis
    error: { type: String, default: '' }, // message when status === 'error'
    analyzedAt: { type: Date, default: null },
  },
  { _id: false }
);

// One media file on a capture. Stored as an S3 object key; the API serves a
// short-lived presigned URL for it, never the key's public address. `analysis`
// holds the AI-derived metadata once it has been run for this asset.
const attachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    key: { type: String, required: true }, // S3 object key
    analysis: { type: analysisSchema, default: null },
  },
  { _id: true }
);

// Strategy-neutral understanding of a Capture — the five core signals plus a
// faithful summary. Filled at Capture time so planning can read meaning later
// without re-interpreting (or rewriting) the user's truth.
const understandingSchema = new mongoose.Schema(
  {
    happened: { type: String, default: '' },
    intent: { type: String, default: '' },
    difficulty: { type: String, default: '' },
    actionTaken: { type: String, default: '' },
    outcome: { type: String, default: '' },
    summary: { type: String, default: '' },
    presentSignals: { type: [String], default: [] },
    missingPiece: { type: String, default: '' },
    askedQuestion: { type: String, default: '' },
    askedAnswer: { type: String, default: '' },
    knownLimitation: { type: String, default: '' },
    visualAssetChoice: { type: String, default: '' },
    captureStatus: { type: String, default: '' },
    originalCapture: { type: String, default: '' },
    sourceRef: { type: String, default: '' },
    distinctSignals: { type: [mongoose.Schema.Types.Mixed], default: [] },
    captureId: { type: String, default: '' },
    sourceStoryId: { type: String, default: '' },
    segmentId: { type: String, default: '' },
    relatedSegmentIds: { type: [String], default: [] },
    relationships: { type: [mongoose.Schema.Types.Mixed], default: [] },
    verifiedFacts: { type: [String], default: [] },
    openQuestions: { type: [String], default: [] },
    relevantAssetContext: { type: [String], default: [] },
    model: { type: String, default: '' },
    understoodAt: { type: Date, default: null },
  },
  { _id: false }
);

// One captured moment — a note, a photo set, or a clip. The visual `type` is
// the primary kind; a note can still carry attachments. Text is the note (or a
// photo's context). Mirrors the frontend capture model.
const captureSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['note', 'photo', 'video'], default: 'note' },
    text: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    understanding: { type: understandingSchema, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// A project holds the raw material a studio gathers through the week; the weekly
// plan reads it back. Scoped to a user.
const projectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The Instagram handle this project belongs to — the app's "current" account
    // when the project was created. Projects follow the header account switcher,
    // so each handle sees only its own projects. Null for projects created
    // before any handle was connected (or before this field existed).
    instagramUsername: { type: String, trim: true, lowercase: true, default: null },
    name: { type: String, required: true, trim: true },
    captures: { type: [captureSchema], default: [] },
  },
  { timestamps: true }
);

projectSchema.index({ user: 1, instagramUsername: 1, updatedAt: -1 });

module.exports = mongoose.model('Project', projectSchema);
