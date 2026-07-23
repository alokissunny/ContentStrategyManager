/**
 * Local condensation of the competitor register for Claude analysis.
 *
 * Full post dumps do not scale; this module builds:
 *  - per-account packs (window rollups + a few exemplar posts)
 *  - corpus-level aggregates over every matching account with in-window posts
 *  - stratified batches for the map step
 */

import type { Types } from 'mongoose'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { Post, PostMetricSnapshot } from '../models/snapshots.ts'
import {
  accountCountryOf,
  followerInRange,
  locationMatches,
  parseFollowerRange,
} from './filterScope.ts'
import { median, since } from './metrics.ts'

/** Accounts per Claude map call — small enough for context, large enough to amortize. */
export const ANALYSIS_BATCH_SIZE = 25
/** Exemplar posts kept per account after local rollup. */
export const EXEMPLAR_POSTS_PER_ACCOUNT = 4
/** Cap in-window posts retained per account for rollups (newest first). */
export const MAX_POSTS_PER_ACCOUNT_CORPUS = 40
const CAPTION_LIMIT = 120
const HASHTAG_LIMIT = 6
const TOP_HASHTAGS_CORPUS = 40

export interface CondensedPost {
  platformPostId: string
  publishedAt: string | null
  format: string
  caption: string
  hashtags: string[]
  likes: number | null
  comments: number | null
  views: number | null
  engagement: number
}

export interface CondensedAccount {
  username: string
  displayName: string | null
  role: string
  followers: number | null
  location: { country: string | null; region: string | null; city: string | null }
  specialization: string | null
  enrichment: {
    accountType: string | null
    postingFrequency: string | null
    estimatedPerformance: string | null
    primaryContentType: string | null
    dominantPostFormat: string | null
    engagementRate: number | null
  } | null
  window: {
    days: number
    postsCollected: number
    postsPerWeek: number
    formatMix: { format: string; sharePct: number }[]
    medianLikes: number
    medianComments: number
    topHashtags: { tag: string; count: number }[]
    postingDays: { day: string; count: number }[]
  }
  exemplars: CondensedPost[]
}

export interface CorpusStats {
  matchedAccountCount: number
  accountsWithPosts: number
  totalPosts: number
  windowDays: number
  filters: { location: string; followerRangeLabel: string }
  medianPostsPerWeek: number
  medianEngagementRate: number
  formatMix: { format: string; sharePct: number; posts: number }[]
  followerTiers: { label: string; accounts: number }[]
  topHashtags: { tag: string; posts: number; accounts: number }[]
  postingDays: { day: string; sharePct: number; posts: number }[]
  method: 'local-condense+map-reduce'
}

export interface AnalysisCorpus {
  generatedAt: string
  corpus: CorpusStats
  accounts: CondensedAccount[]
  batches: CondensedAccount[][]
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function followerTier(followers: number | null): string {
  if (followers == null) return 'Unknown'
  if (followers < 1_000) return 'Under 1K'
  if (followers < 5_000) return '1K–5K'
  if (followers < 10_000) return '5K–10K'
  if (followers < 25_000) return '10K–25K'
  if (followers < 50_000) return '25K–50K'
  return 'Over 50K'
}

function engagementOf(likes: number | null, comments: number | null): number {
  return (likes ?? 0) + (comments ?? 0)
}

/**
 * Round-robin accounts across follower tiers so each map batch sees a mix of
 * sizes instead of only the largest (or only the smallest).
 */
export function stratifyIntoBatches(
  accounts: CondensedAccount[],
  batchSize = ANALYSIS_BATCH_SIZE,
): CondensedAccount[][] {
  const buckets = new Map<string, CondensedAccount[]>()
  for (const a of accounts) {
    const key = followerTier(a.followers)
    const list = buckets.get(key) ?? []
    list.push(a)
    buckets.set(key, list)
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
  }

  const interleaved: CondensedAccount[] = []
  const queues = [...buckets.values()]
  let remaining = accounts.length
  while (remaining > 0) {
    for (const q of queues) {
      const next = q.shift()
      if (next) {
        interleaved.push(next)
        remaining--
      }
    }
  }

  const batches: CondensedAccount[][] = []
  for (let i = 0; i < interleaved.length; i += batchSize) {
    batches.push(interleaved.slice(i, i + batchSize))
  }
  return batches
}

function shareEntries(
  counts: Map<string, number>,
  total: number,
): { key: string; sharePct: number; count: number }[] {
  if (total <= 0) return []
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      count,
      sharePct: Math.round((count / total) * 1000) / 10,
    }))
}

/**
 * Load every matching account with in-window posts, condense locally, and
 * partition into stratified batches for Claude map calls.
 */
export async function buildAnalysisCorpus(
  windowDays: number,
  scope: { location: string; followerRangeLabel: string },
): Promise<AnalysisCorpus> {
  const accounts = await CompetitorAccount.find({ approvalStatus: { $ne: 'deleted' } }).sort({
    latestFollowerCount: -1,
  })
  const followerRange = parseFollowerRange(scope.followerRangeLabel)
  const filtered = accounts.filter(
    (a) =>
      locationMatches(accountCountryOf(a), scope.location) &&
      followerInRange(a.latestFollowerCount, followerRange),
  )

  const windowStart = since(windowDays)
  const accountIds = filtered.map((a) => a._id)
  const byId = new Map(filtered.map((a) => [String(a._id), a]))

  if (accountIds.length === 0) {
    return emptyCorpus(windowDays, scope, 0)
  }

  // One query for the whole filtered set — avoids N+1 until we have posts.
  const posts = await Post.find({
    accountId: { $in: accountIds },
    publishedAt: { $gte: windowStart },
    deleted: { $ne: true },
  })
    .select('accountId platformPostId publishedAt format caption hashtags metricsHidden')
    .sort({ publishedAt: -1 })
    .lean()

  if (posts.length === 0) {
    return emptyCorpus(windowDays, scope, filtered.length)
  }

  type PostRow = (typeof posts)[number]
  const postsByAccount = new Map<string, PostRow[]>()
  for (const p of posts) {
    const key = String(p.accountId)
    const list = postsByAccount.get(key) ?? []
    // Posts are newest-first; keep a bounded window per account for memory/metrics.
    if (list.length >= MAX_POSTS_PER_ACCOUNT_CORPUS) continue
    list.push(p)
    postsByAccount.set(key, list)
  }

  const retainedPosts = [...postsByAccount.values()].flat()
  const postIds = retainedPosts.map((p) => p._id)
  const metrics = await PostMetricSnapshot.aggregate<{
    _id: Types.ObjectId
    likes: number | null
    comments: number | null
    views: number | null
  }>([
    { $match: { postId: { $in: postIds } } },
    { $sort: { collectedAt: -1 } },
    {
      $group: {
        _id: '$postId',
        likes: { $first: '$likes' },
        comments: { $first: '$comments' },
        views: { $first: '$views' },
      },
    },
  ])
  const metricsByPost = new Map(metrics.map((m) => [String(m._id), m]))

  const condensed: CondensedAccount[] = []
  const corpusFormat = new Map<string, number>()
  const corpusDay = new Map<string, number>()
  const corpusHashtagPosts = new Map<string, number>()
  const corpusHashtagAccounts = new Map<string, Set<string>>()
  const tierCounts = new Map<string, number>()
  const postsPerWeekValues: number[] = []
  const engagementRates: number[] = []

  for (const [accountId, accountPosts] of postsByAccount) {
    const account = byId.get(accountId)
    if (!account) continue

    const formatCounts = new Map<string, number>()
    const dayCounts = new Map<string, number>()
    const hashtagCounts = new Map<string, number>()
    const likes: number[] = []
    const comments: number[] = []
    const enrichedPosts: CondensedPost[] = []

    for (const p of accountPosts) {
      const m = metricsByPost.get(String(p._id))
      const likeN = m?.likes ?? null
      const commentN = m?.comments ?? null
      if (typeof likeN === 'number') likes.push(likeN)
      if (typeof commentN === 'number') comments.push(commentN)

      const format = p.format ?? 'image'
      formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1)
      corpusFormat.set(format, (corpusFormat.get(format) ?? 0) + 1)

      const day =
        p.publishedAt instanceof Date ? DAY_NAMES[p.publishedAt.getUTCDay()]! : 'Unknown'
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
      corpusDay.set(day, (corpusDay.get(day) ?? 0) + 1)

      for (const raw of p.hashtags ?? []) {
        const tag = String(raw).startsWith('#') ? String(raw) : `#${raw}`
        if (!tag || tag === '#') continue
        hashtagCounts.set(tag, (hashtagCounts.get(tag) ?? 0) + 1)
        corpusHashtagPosts.set(tag, (corpusHashtagPosts.get(tag) ?? 0) + 1)
        const accSet = corpusHashtagAccounts.get(tag) ?? new Set()
        accSet.add(account.username)
        corpusHashtagAccounts.set(tag, accSet)
      }

      enrichedPosts.push({
        platformPostId: p.platformPostId,
        publishedAt: p.publishedAt?.toISOString() ?? null,
        format,
        caption: (p.caption ?? '').slice(0, CAPTION_LIMIT),
        hashtags: (p.hashtags ?? []).slice(0, HASHTAG_LIMIT).map((h) =>
          String(h).startsWith('#') ? String(h) : `#${h}`,
        ),
        likes: likeN,
        comments: commentN,
        views: m?.views ?? null,
        engagement: engagementOf(likeN, commentN),
      })
    }

    const postsCollected = accountPosts.length
    const postsPerWeek = Math.round((postsCollected / windowDays) * 7 * 10) / 10
    postsPerWeekValues.push(postsPerWeek)

    const followers = account.latestFollowerCount ?? null
    const eng = account.enrichment?.engagementRate
    if (typeof eng === 'number' && Number.isFinite(eng)) {
      engagementRates.push(eng)
    } else if (followers && followers > 0 && likes.length) {
      const medianEng = (median(likes) + median(comments)) / followers
      engagementRates.push(Math.round(medianEng * 10000) / 100)
    }

    const tier = followerTier(followers)
    tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1)

    // Highest-engagement exemplars; ensure the newest post is represented.
    const byEngagement = [...enrichedPosts].sort((a, b) => b.engagement - a.engagement)
    const exemplars: CondensedPost[] = []
    const seen = new Set<string>()
    for (const post of byEngagement) {
      if (exemplars.length >= EXEMPLAR_POSTS_PER_ACCOUNT) break
      exemplars.push(post)
      seen.add(post.platformPostId)
    }
    const newest = enrichedPosts[0]
    if (newest && !seen.has(newest.platformPostId) && exemplars.length > 0) {
      exemplars[exemplars.length - 1] = newest
    }

    const totalAccountPosts = Math.max(1, postsCollected)
    const enr = account.enrichment
    condensed.push({
      username: account.username,
      displayName: account.displayName ?? null,
      role: account.role,
      followers,
      location: {
        country: accountCountryOf(account),
        region: account.location?.region ?? null,
        city: account.location?.city ?? null,
      },
      specialization: account.specialization ?? null,
      enrichment: enr
        ? {
            accountType: enr.accountType ?? null,
            postingFrequency: enr.postingFrequency ?? null,
            estimatedPerformance: enr.estimatedPerformance ?? null,
            primaryContentType: enr.primaryContentType ?? null,
            dominantPostFormat: enr.dominantPostFormat ?? null,
            engagementRate: enr.engagementRate ?? null,
          }
        : null,
      window: {
        days: windowDays,
        postsCollected,
        postsPerWeek,
        formatMix: shareEntries(formatCounts, totalAccountPosts).map(({ key, sharePct }) => ({
          format: key,
          sharePct,
        })),
        medianLikes: Math.round(median(likes)),
        medianComments: Math.round(median(comments)),
        topHashtags: [...hashtagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([tag, count]) => ({ tag, count })),
        postingDays: shareEntries(dayCounts, totalAccountPosts).map(({ key, count }) => ({
          day: key,
          count,
        })),
      },
      exemplars,
    })
  }

  const totalPosts = retainedPosts.length
  const formatMix = shareEntries(corpusFormat, totalPosts).map(({ key, sharePct, count }) => ({
    format: key,
    sharePct,
    posts: count,
  }))
  const postingDays = shareEntries(corpusDay, totalPosts).map(({ key, sharePct, count }) => ({
    day: key,
    sharePct,
    posts: count,
  }))
  const topHashtags = [...corpusHashtagPosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_HASHTAGS_CORPUS)
    .map(([tag, postCount]) => ({
      tag,
      posts: postCount,
      accounts: corpusHashtagAccounts.get(tag)?.size ?? 0,
    }))

  const corpus: CorpusStats = {
    matchedAccountCount: filtered.length,
    accountsWithPosts: condensed.length,
    totalPosts,
    windowDays,
    filters: scope,
    medianPostsPerWeek: Math.round(median(postsPerWeekValues) * 10) / 10,
    medianEngagementRate: Math.round(median(engagementRates) * 100) / 100,
    formatMix,
    followerTiers: [...tierCounts.entries()].map(([label, n]) => ({ label, accounts: n })),
    topHashtags,
    postingDays,
    method: 'local-condense+map-reduce',
  }

  return {
    generatedAt: new Date().toISOString(),
    corpus,
    accounts: condensed,
    batches: stratifyIntoBatches(condensed),
  }
}

function emptyCorpus(
  windowDays: number,
  scope: { location: string; followerRangeLabel: string },
  matchedAccountCount: number,
): AnalysisCorpus {
  return {
    generatedAt: new Date().toISOString(),
    corpus: {
      matchedAccountCount,
      accountsWithPosts: 0,
      totalPosts: 0,
      windowDays,
      filters: scope,
      medianPostsPerWeek: 0,
      medianEngagementRate: 0,
      formatMix: [],
      followerTiers: [],
      topHashtags: [],
      postingDays: [],
      method: 'local-condense+map-reduce',
    },
    accounts: [],
    batches: [],
  }
}
