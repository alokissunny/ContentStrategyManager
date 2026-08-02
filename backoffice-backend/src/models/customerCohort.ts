import mongoose, { Schema } from 'mongoose'

/*
 * Backoffice-owned assignment of a competitor cohort (Business Type + Location)
 * to a customer's Instagram account. Kept in its own explicitly-named
 * collection so we never write into the customer app's read-only collections
 * (User / InstagramProfile / WeeklyRoute), and the name can't collide with a
 * customer-app collection on the shared database.
 */

export const COHORT_BUSINESS_CATEGORIES = [
  'interior-designer',
  'bauhly-competitor',
  'other',
] as const

const customerCohortSchema = new Schema(
  {
    /** Customer's user id — one assigned cohort per customer. */
    user: { type: Schema.Types.ObjectId, required: true, unique: true },
    /** The Instagram account this cohort was assigned to, for reference. */
    instagramUsername: { type: String, default: null },
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

export const CustomerCohort =
  mongoose.models.CustomerCohort ?? mongoose.model('CustomerCohort', customerCohortSchema)
