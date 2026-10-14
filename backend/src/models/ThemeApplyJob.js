const mongoose = require('mongoose');

// One background Theme Apply run (POST /posts/:id/theme-image with async: true).
// The request returns this job's id at once; the studio polls
// GET /posts/theme-jobs/:jobId until it is done. A long all-slides run then
// never holds an HTTP request open, and a server restart mid-run (e.g. out of
// memory on a small instance) shows up as `interrupted` instead of a bare
// "Network Error". `bootId` is the server process that runs it.
const themeApplyJobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'PlannedPost', required: true },
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
    bootId: { type: String, default: '' },
    slideIndexes: { type: [Number], default: [] },
    // what POST /theme-image would have answered: { code, body } (JSON string —
    // agent output keys never collide with MongoDB's field-name rules)
    result: { type: String, default: '' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// finished or abandoned jobs go after a day
themeApplyJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports = mongoose.model('ThemeApplyJob', themeApplyJobSchema);
