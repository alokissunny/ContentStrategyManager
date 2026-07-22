import type { Types } from 'mongoose'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { AccountSnapshot, CollectionRun, Post, PostMetricSnapshot, RawPostPayload } from '../models/snapshots.ts'
import { env } from '../config/env.ts'
import { scrapePosts, scrapeProfile, type ScrapedProfile } from './instagram.ts'

/*
 * Collection turns a scrape into append-only history:
 *   profile  -> a new AccountSnapshot (never an update)
 *   posts    -> Post upserted (immutable facts) + a new PostMetricSnapshot
 *
 * The account row only gets denormalized copies of the latest values so the
 * list view can render without an aggregation per row.
 */

/** Fields whose absence materially weakens the record (drives dataQuality). */
const CORE_FIELDS = ['followerCount', 'displayName', 'biography'] as const

export function deriveDataQuality(profile: ScrapedProfile | null): 'complete' | 'partial' | 'low' | 'failed' {
  if (!profile) return 'failed'
  if (profile.followerCount == null) return 'low'
  const missingCore = CORE_FIELDS.filter((f) => profile.missingFields.includes(f)).length
  if (missingCore > 0) return 'partial'
  return profile.missingFields.length > 0 ? 'partial' : 'complete'
}

export interface CollectAccountResult {
  accountId: string
  username: string
  ok: boolean
  postsCollected: number
  /**
   * The pull filled up before reaching the far edge of the requested window, so
   * the account's history is shorter than asked for. Not an error — the data
   * collected is sound — but the period is incomplete, which matters when the
   * numbers are read as covering the full backfill window.
   */
  windowTruncated: boolean
  error: string | null
}

/**
 * Collect one account. Never throws for data reasons — an unreachable or
 * non-existent handle is recorded as a failed result so a batch run can carry
 * on and the failure stays visible in the UI.
 */
export interface CollectOptions {
  /** Keep only posts published within this many days. Omit for no date filter. */
  sinceDays?: number
  /** How many posts to ask Apify for (a wider window needs a bigger pull). */
  postLimit?: number
  /**
   * Snapshot the profile and stop — no post scrape, no post writes, and
   * `lastPostsCollectedAt` stays untouched so the account still counts as
   * "posts never scraped". Used when an account first enters the register:
   * posts are collected later, explicitly, from the UI.
   */
  profileOnly?: boolean
}

export async function collectAccount(
  accountId: string | Types.ObjectId,
  collectionRunId: Types.ObjectId | null = null,
  options: CollectOptions = {},
): Promise<CollectAccountResult> {
  const account = await CompetitorAccount.findById(accountId)
  if (!account) throw new Error(`Competitor account ${String(accountId)} not found`)

  const base = { accountId: String(account._id), username: account.username }

  let profile: ScrapedProfile | null = null
  let profileError: string | null = null
  try {
    profile = await scrapeProfile(account.username)
  } catch (err) {
    profileError = err instanceof Error ? err.message : String(err)
  }

  const quality = deriveDataQuality(profile)

  // Record the observation either way — a failed run is data about the account.
  await AccountSnapshot.create({
    accountId: account._id,
    collectionRunId,
    collectionSource: 'apify',
    username: account.username,
    displayName: profile?.displayName ?? null,
    biography: profile?.biography ?? null,
    website: profile?.website ?? null,
    category: profile?.category ?? null,
    followerCount: profile?.followerCount ?? null,
    followingCount: profile?.followingCount ?? null,
    visiblePostCount: profile?.visiblePostCount ?? null,
    verified: profile?.verified ?? null,
    missingFields: profile?.missingFields ?? ['*'],
    warnings: profileError ? [profileError] : (profile?.warnings ?? []),
  })

  if (!profile) {
    account.dataQuality = 'failed'
    await account.save()
    return {
      ...base,
      ok: false,
      postsCollected: 0,
      windowTruncated: false,
      error: profileError ?? 'Profile did not resolve',
    }
  }

  let postsCollected = 0
  let postError: string | null = null
  let windowTruncated = false
  if (!options.profileOnly) try {
    const scraped = await scrapePosts(account.username, options.postLimit)

    // A date window is applied here rather than at the scraper: Apify returns
    // the N most recent posts with no date filter, so we pull a generous N and
    // keep what falls inside the window. Posts with no timestamp are kept —
    // dropping them would silently lose data over a missing field.
    const cutoff = options.sinceDays ? Date.now() - options.sinceDays * 864e5 : null
    const posts = cutoff
      ? scraped.filter((p) => !p.publishedAt || p.publishedAt.getTime() >= cutoff)
      : scraped

    /*
     * If the scrape came back full AND its oldest post is still inside the
     * window, the account posts faster than postLimit covers — there is older
     * history in the period we never asked for. Flag it, because "60 days" that
     * quietly means 25 would skew every benchmark computed from it.
     */
    if (cutoff && options.postLimit && scraped.length >= options.postLimit) {
      const timestamps = scraped.filter((p) => p.publishedAt).map((p) => p.publishedAt!.getTime())
      windowTruncated = timestamps.length > 0 && Math.min(...timestamps) > cutoff
    }

    for (const p of posts) {
      // Immutable facts: upsert so re-collection doesn't duplicate the post.
      const doc = await Post.findOneAndUpdate(
        { accountId: account._id, platformPostId: p.platformPostId },
        {
          $set: {
            url: p.url,
            publishedAt: p.publishedAt,
            caption: p.caption,
            hashtags: p.hashtags,
            mentions: p.mentions,
            format: p.format,
            carouselCount: p.carouselCount,
            videoDurationSeconds: p.videoDurationSeconds,
            metricsHidden: p.metricsHidden,
          },
          $setOnInsert: { accountId: account._id, platformPostId: p.platformPostId, firstCollectedAt: new Date() },
        },
        { new: true, upsert: true },
      )

      /*
       * Keep the source item as-is for the raw-JSON inspector. Replaced rather
       * than appended (see the model), and skipped when absent so a mocked or
       * manually built post doesn't write an empty payload over a real one.
       */
      if (p.raw) {
        await RawPostPayload.updateOne(
          { accountId: account._id, platformPostId: p.platformPostId },
          { $set: { payload: p.raw, collectedAt: new Date(), source: 'apify' } },
          { upsert: true },
        )
      }

      // Changing values are appended, never overwritten.
      await PostMetricSnapshot.create({
        postId: doc._id,
        accountId: account._id,
        collectionRunId,
        likes: p.likes,
        comments: p.comments,
        views: p.views,
      })
      postsCollected += 1
    }
  } catch (err) {
    postError = err instanceof Error ? err.message : String(err)
  }

  account.displayName = profile.displayName ?? account.displayName
  account.profileImageUrl = profile.profileImageUrl ?? account.profileImageUrl
  account.website = profile.website ?? account.website
  account.latestFollowerCount = profile.followerCount ?? account.latestFollowerCount
  account.lastSuccessfulCollectionAt = new Date()
  // Only a run that actually scraped posts moves the post clock — a profile
  // snapshot must not make an account look "recently scraped" to the skip check.
  if (!options.profileOnly && !postError) account.lastPostsCollectedAt = new Date()
  account.dataQuality = postError ? 'partial' : quality
  await account.save()

  return { ...base, ok: true, postsCollected, windowTruncated, error: postError }
}

/**
 * Snapshot the profile of an account that has just entered the register, so it
 * isn't an empty row (no name, no follower count) until someone looks at it.
 *
 * Deliberately profile-only: post scraping costs real Apify credits per
 * account, so it is an explicit operator action — select rows, press
 * "Scrape posts" — not a side effect of adding. `lastPostsCollectedAt` stays
 * null, which is what marks the account as never-scraped to that flow.
 *
 * Fire-and-forget: even a profile scrape takes ~10s, too long to hold the POST
 * open. Every path that admits an account should call this — a manually added
 * competitor and an approved discovery suggestion both need identity filled in.
 */
export function snapshotNewAccount(accountId: Types.ObjectId | string, username: string): void {
  void collectAccount(accountId, null, { profileOnly: true })
    .then((r) =>
      console.log(
        `[backoffice] profile snapshot for @${username}${r.ok ? '' : ` failed (${r.error})`}`,
      ),
    )
    .catch((err) =>
      console.error(`[backoffice] profile snapshot failed for @${username}:`, err instanceof Error ? err.message : err),
    )
}

export interface PostScrapePlan {
  /** Accounts the run will actually scrape. */
  started: { id: string; username: string }[]
  /** Fresh accounts left alone, with when they were last scraped. */
  skipped: { id: string; username: string; lastPostsCollectedAt: string }[]
}

/**
 * Post scrape for operator-selected accounts, last `backfillDays` days.
 *
 * An account whose posts were already scraped within that window is skipped:
 * re-scraping it would pull the same posts again and spend Apify credits to
 * learn nothing new. The skip is reported, not silent — the operator selected
 * that row and needs to see why nothing happened to it.
 *
 * Returns after the selected scrapes finish so the UI can hold a loader for
 * the real duration. Skipped accounts are reported without being scraped.
 */
export async function scrapePostsForAccounts(ids: string[]): Promise<PostScrapePlan> {
  const { backfillDays, backfillPosts, concurrency } = env.collection
  const freshCutoff = Date.now() - backfillDays * 864e5

  const accounts = await CompetitorAccount.find({
    _id: { $in: ids },
    approvalStatus: { $ne: 'deleted' },
  }).select('username lastPostsCollectedAt')

  const started: PostScrapePlan['started'] = []
  const skipped: PostScrapePlan['skipped'] = []
  for (const a of accounts) {
    if (a.lastPostsCollectedAt && a.lastPostsCollectedAt.getTime() >= freshCutoff) {
      skipped.push({
        id: String(a._id),
        username: a.username,
        lastPostsCollectedAt: a.lastPostsCollectedAt.toISOString(),
      })
    } else {
      started.push({ id: String(a._id), username: a.username })
    }
  }

  await mapWithConcurrency(started, concurrency, async ({ id, username }) => {
    try {
      const r = await collectAccount(id, null, { sinceDays: backfillDays, postLimit: backfillPosts })
      console.log(
        `[backoffice] scraped posts for @${username}: ${r.postsCollected} from the last ${backfillDays} days` +
          `${r.error ? ` (${r.error})` : ''}` +
          (r.windowTruncated
            ? ` — WINDOW TRUNCATED: hit the ${backfillPosts}-post limit before reaching` +
              ` ${backfillDays} days. Raise COLLECTION_BACKFILL_POSTS to cover this account.`
            : ''),
      )
    } catch (err) {
      console.error(`[backoffice] post scrape failed for @${username}:`, err instanceof Error ? err.message : err)
    }
  })

  return { started, skipped }
}

/** Run `limit` promises at a time — Apify rate-limits and gets flaky above that. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Collect every account in the register. A per-account failure is recorded and
 * the run continues — one private or renamed handle must not abort the batch.
 */
export async function runCollection(trigger: 'manual' | 'scheduled' = 'manual') {
  const accounts = await CompetitorAccount.find({ approvalStatus: { $ne: 'deleted' } }).select('_id username')
  const run = await CollectionRun.create({ trigger, startedAt: new Date() })

  const results = await mapWithConcurrency(accounts, env.collection.concurrency, async (a) => {
    try {
      return await collectAccount(a._id, run._id)
    } catch (err) {
      return {
        accountId: String(a._id),
        username: a.username,
        ok: false,
        postsCollected: 0,
        windowTruncated: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies CollectAccountResult
    }
  })

  run.set({
    finishedAt: new Date(),
    accountsProcessed: results.length,
    postsCollected: results.reduce((sum, r) => sum + r.postsCollected, 0),
    failures: results.filter((r) => !r.ok).length,
    results,
  })
  await run.save()

  console.log(
    `[collection] run ${String(run._id)}: ${run.accountsProcessed} accounts, ${run.postsCollected} posts, ${run.failures} failures`,
  )
  return run
}
