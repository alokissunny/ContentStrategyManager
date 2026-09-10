import mongoose, { Schema } from 'mongoose'

/*
 * Read-only view of the customer API's early-access waitlist.
 * The customer app owns writes (public form on /auth); we only list them.
 */

const earlyAccessRequestSchema = new Schema(
  {
    name: String,
    instagramHandle: String,
  },
  { collection: 'earlyaccessrequests', strict: false, timestamps: true },
)

export const EarlyAccessRequest =
  mongoose.models.BackofficeEarlyAccessRequest ??
  mongoose.model('BackofficeEarlyAccessRequest', earlyAccessRequestSchema)
