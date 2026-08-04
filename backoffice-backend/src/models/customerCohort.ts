import mongoose, { Schema } from 'mongoose'

/*
 * Backoffice-owned assignment of a competitor cohort (Business Type + Location)
 * to one of a customer's Instagram accounts. One row per (user, handle) so a
 * customer with several connected accounts can be benchmarked differently on
 * each. Kept in an explicitly-named collection so we never write into the
 * customer app's read-only collections (User / InstagramProfile / WeeklyRoute).
 */

export const COHORT_BUSINESS_CATEGORIES = [
  'interior-designer',
  'bauhly-competitor',
  'other',
] as const

const customerCohortSchema = new Schema(
  {
    /** Customer's user id. */
    user: { type: Schema.Types.ObjectId, required: true },
    /** Instagram handle this cohort applies to (lowercase). */
    instagramUsername: { type: String, required: true, trim: true, lowercase: true },
    businessCategory: {
      type: String,
      enum: COHORT_BUSINESS_CATEGORIES,
      required: true,
      default: 'interior-designer',
    },
    /** 'Global' or a country label matching the competitor register. */
    location: { type: String, required: true, default: 'Global' },
  },
  { collection: 'backoffice_customer_cohorts', timestamps: true },
)

// One assigned cohort per Instagram account on a customer.
customerCohortSchema.index({ user: 1, instagramUsername: 1 }, { unique: true })

export const CustomerCohort =
  mongoose.models.CustomerCohort ?? mongoose.model('CustomerCohort', customerCohortSchema)
