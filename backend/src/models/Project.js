const mongoose = require('mongoose');

// One media file on a capture. Stored as an S3 object key; the API serves a
// short-lived presigned URL for it, never the key's public address.
const attachmentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    key: { type: String, required: true }, // S3 object key
  },
  { _id: true }
);

// One captured moment — a note, a photo set, or a clip. The visual `type` is
// the primary kind; a note can still carry attachments. Text is the note (or a
// photo's context). Mirrors the frontend capture model.
const captureSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['note', 'photo', 'video'], default: 'note' },
    text: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// A project holds the raw material a studio gathers through the week; the weekly
// plan reads it back. Scoped to a user.
const projectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    captures: { type: [captureSchema], default: [] },
  },
  { timestamps: true }
);

projectSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('Project', projectSchema);
