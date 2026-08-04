import { CustomerCohort } from '../models/customerCohort.ts'
import { InstagramProfile } from '../models/customerData.ts'

/**
 * Older DBs had a unique index on `user` alone (one cohort per customer). Drop
 * it, backfill missing usernames onto legacy rows, and sync the compound unique
 * index so each Instagram handle can have its own cohort.
 */
export async function ensureCustomerCohortIndexes() {
  try {
    const indexes = await CustomerCohort.collection.indexes()
    if (indexes.some((ix) => ix.name === 'user_1')) {
      await CustomerCohort.collection.dropIndex('user_1')
      console.log('[backoffice] Dropped stale unique index backoffice_customer_cohorts.user_1')
    }
  } catch (err) {
    console.warn(
      `[backoffice] Could not check/drop stale CustomerCohort index: ${(err as Error).message}`,
    )
  }

  // Legacy rows stored a single cohort per user with instagramUsername null or
  // stale. Attach each to that user's primary profile so lookups by handle work.
  const legacy = await CustomerCohort.find({
    $or: [{ instagramUsername: null }, { instagramUsername: '' }, { instagramUsername: { $exists: false } }],
  }).lean()

  for (const row of legacy) {
    const profile = (await InstagramProfile.findOne({ user: row.user })
      .select('username')
      .sort({ activatedAt: -1, fetchedAt: -1 })
      .lean()) as { username?: string } | null
    if (!profile?.username) {
      console.warn(
        `[backoffice] Skipping cohort ${String(row._id)} — no Instagram profile to attach`,
      )
      continue
    }
    const username = String(profile.username).toLowerCase()
    const clash = await CustomerCohort.findOne({
      user: row.user,
      instagramUsername: username,
      _id: { $ne: row._id },
    }).lean()
    if (clash) {
      await CustomerCohort.deleteOne({ _id: row._id })
      console.log(
        `[backoffice] Removed duplicate legacy cohort for user ${String(row.user)} (@${username})`,
      )
      continue
    }
    await CustomerCohort.updateOne(
      { _id: row._id },
      { $set: { instagramUsername: username } },
    )
  }

  await CustomerCohort.syncIndexes()
}
