const mongoose = require('mongoose');

/*
 * Somebody without an invitation code who asked to be told when there is a place (the landing's
 * Sign in box and Capture's sign-up step, "Join the waitlist"; bauhly-v3 decision 875). One row per
 * address; joining again only refreshes it.
 */
const waitlistEntrySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    /* where they joined from: 'capture' (after Build post) or 'login' (the Sign in box) */
    source: { type: String, default: '' },
    joinedCount: { type: Number, default: 1 },
    invitedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'waitlist' },
);

waitlistEntrySchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('WaitlistEntry', waitlistEntrySchema);
