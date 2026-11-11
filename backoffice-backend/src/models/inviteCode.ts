import mongoose, { Schema } from 'mongoose'

/*
 * Invitation codes for creating a Bauhly account. Admins make and revoke them here; the customer API
 * redeems one (once) on sign-up. Same collection, `invitecodes`, in the shared database.
 */

const inviteCodeSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    note: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    usedAt: { type: Date, default: null },
    usedBy: { type: Schema.Types.ObjectId, default: null },
    usedByEmail: { type: String, default: '' },
    revokedAt: { type: Date, default: null },
  },
  { collection: 'invitecodes', strict: false, timestamps: true },
)

inviteCodeSchema.index({ code: 1 }, { unique: true })

export const InviteCode =
  mongoose.models.BackofficeInviteCode ?? mongoose.model('BackofficeInviteCode', inviteCodeSchema)
