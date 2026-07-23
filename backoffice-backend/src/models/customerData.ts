import mongoose, { Schema } from 'mongoose'

/*
 * Read-only views of customer-API collections in the shared MongoDB.
 * The customer app owns the schemas — we mirror enough fields to list
 * signups and show the weekly plan that was presented to each user.
 */

const instagramProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true },
    username: String,
    fullName: String,
    followersCount: Number,
    postsCount: Number,
    fetchedAt: Date,
  },
  { collection: 'instagramprofiles', strict: false },
)

export const InstagramProfile =
  mongoose.models.BackofficeInstagramProfile ??
  mongoose.model('BackofficeInstagramProfile', instagramProfileSchema)

const weeklyRouteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, required: true },
    instagramUsername: String,
    weekOf: Date,
    weekLabel: String,
    model: String,
    focus: Schema.Types.Mixed,
    funnel: [Schema.Types.Mixed],
    days: [Schema.Types.Mixed],
    generatedAt: Date,
  },
  { collection: 'weeklyroutes', strict: false, timestamps: true },
)

export const WeeklyRoute =
  mongoose.models.BackofficeWeeklyRoute ??
  mongoose.model('BackofficeWeeklyRoute', weeklyRouteSchema)
