import type { Types } from 'mongoose'
import { AccountSnapshot, Post, PostMetricSnapshot } from '../models/snapshots.ts'

/*
 * Derived metrics. Everything here is computed from append-only snapshots —
 * nothing is read from a stored "growth" field, because a stored figure can't
 * be re-derived or audited later.
 */

export const PERIOD_DAYS: Record<string, number> = {
  week: 7,
  month: 30,
  'last-30': 30,
  'last-90': 90,
  'last-180': 180,
  'last-365': 365,
  'previous-30': 30,
  'month-over-month': 30,
}

export function periodDays(period: string | undefined): number {
  return PERIOD_DAYS[period ?? 'last-30'] ?? 30
}

export function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * Observed follower change across the window, as a **percentage** (the unit the
 * UI renders — hence the name; returning an absolute delta here silently shows
 * up as "+2658%").
 *
 * It is the latest snapshot against the earliest snapshot at/after the window
 * start. Null unless we have two real readings — change is never inferred from
 * a single data point.
 */
export async function followerChangePct(accountId: Types.ObjectId, days: number): Promise<number | null> {
  const [latest] = await AccountSnapshot.find({ accountId, followerCount: { $ne: null } })
    .sort({ collectedAt: -1 })
    .limit(1)
  if (!latest?.followerCount) return null

  const [baseline] = await AccountSnapshot.find({
    accountId,
    followerCount: { $ne: null },
    collectedAt: { $gte: since(days) },
  })
    .sort({ collectedAt: 1 })
    .limit(1)

  if (!baseline?.followerCount || String(baseline._id) === String(latest._id)) return null
  const pct = ((latest.followerCount - baseline.followerCount) / baseline.followerCount) * 100
  return Math.round(pct * 10) / 10
}

/** Follower readings oldest→newest for the sparkline. */
export async function followerSeries(accountId: Types.ObjectId, points = 6): Promise<number[]> {
  const snaps = await AccountSnapshot.find({ accountId, followerCount: { $ne: null } })
    .sort({ collectedAt: -1 })
    .limit(points)
    .select('followerCount')
  return snaps.reverse().map((s) => s.followerCount!)
}

export interface AccountActivity {
  postsCollected: number
  postsPerWeek: number
  medianEngagementRate: number
  topFormats: { label: string; sharePct: number }[]
}

const FORMAT_LABELS: Record<string, string> = {
  reel: 'Reels',
  carousel: 'Carousels',
  image: 'Images',
  video: 'Video',
  unknown: 'Other',
}

/**
 * Posting activity and public engagement over the window.
 *
 * Engagement rate uses the latest metric reading per post over the account's
 * follower count. Posts with hidden metrics are excluded from the rate (they'd
 * drag it to zero) but still count toward volume.
 */
export async function accountActivity(
  accountId: Types.ObjectId,
  days: number,
  followerCount: number | null,
): Promise<AccountActivity> {
  const posts = await Post.find({ accountId, publishedAt: { $gte: since(days) } }).select(
    '_id format metricsHidden',
  )

  const rates: number[] = []
  const formatCounts = new Map<string, number>()

  for (const post of posts) {
    formatCounts.set(post.format, (formatCounts.get(post.format) ?? 0) + 1)
    if (post.metricsHidden || !followerCount) continue

    const [metric] = await PostMetricSnapshot.find({ postId: post._id }).sort({ collectedAt: -1 }).limit(1)
    if (!metric || (metric.likes == null && metric.comments == null)) continue
    rates.push((((metric.likes ?? 0) + (metric.comments ?? 0)) / followerCount) * 100)
  }

  const topFormats = [...formatCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([format, count]) => ({
      label: FORMAT_LABELS[format] ?? format,
      sharePct: Math.round((count / Math.max(1, posts.length)) * 1000) / 10,
    }))

  return {
    postsCollected: posts.length,
    postsPerWeek: Math.round((posts.length / (days / 7)) * 10) / 10,
    medianEngagementRate: Math.round(median(rates) * 100) / 100,
    topFormats,
  }
}
