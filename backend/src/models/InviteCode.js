const mongoose = require('mongoose');

/*
 * Invitation codes: a new account needs one, and each works once. Admins make and revoke them in the
 * backoffice (backoffice-backend, same `invitecodes` collection); this API only redeems them.
 */
const inviteCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    note: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    usedAt: { type: Date, default: null },
    usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    usedByEmail: { type: String, default: '' },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'invitecodes' },
);

inviteCodeSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('InviteCode', inviteCodeSchema);
