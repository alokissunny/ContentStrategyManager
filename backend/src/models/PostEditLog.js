const mongoose = require('mongoose');

// What a studio did to its planned posts after generation — one row per edit
// action (see middleware/postEditLog.js). Read by the backoffice (Customers ›
// Activity › Edits) so the team can see how customers work with what Bauhly
// wrote. Repeated saves of the same kind on the same post within a short window
// fold into one row (`count`, `changes` merged) so editor autosave isn't noise.
const changeSchema = new mongoose.Schema(
  {
    field: { type: String, default: '' }, // "Caption", "Slide 2 · title", "Scheduled"…
    before: { type: String, default: '' },
    after: { type: String, default: '' },
  },
  { _id: false }
);

const postEditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instagramUsername: { type: String, trim: true, lowercase: true, default: '' },
    // null for calendar-wide actions (Distribute, Shift, Clear upcoming)
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'PlannedPost', default: null },
    postTitle: { type: String, default: '' },
    postDate: { type: String, default: '' },
    action: { type: String, default: 'edit' }, // edit | schedule | publish | layout | theme | …
    label: { type: String, default: '' }, // human line: "Edited caption and slide 2"
    changes: { type: [changeSchema], default: [] },
    // the carousel document before/after, when the edit changed it — the
    // backoffice draws the changed slides from these (Before | After previews).
    // On a merged row: the first save's before, the latest save's after.
    hasDocs: { type: Boolean, default: false },
    beforeHtml: { type: String, default: '' },
    afterHtml: { type: String, default: '' },
    count: { type: Number, default: 1 },
    firstAt: { type: Date, default: Date.now },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

postEditLogSchema.index({ user: 1, at: -1 });
postEditLogSchema.index({ user: 1, instagramUsername: 1, at: -1 });

module.exports = mongoose.model('PostEditLog', postEditLogSchema);
