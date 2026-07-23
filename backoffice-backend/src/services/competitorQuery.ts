import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { CollectionRun, Post, PostMetricSnapshot } from '../models/snapshots.ts'
import { followerChangePct, periodDays } from './metrics.ts'
import {
  accountCountryOf,
  followerInRange,
  locationMatches,
  parseFollowerRange as parseOverviewFollowerRange,
} from './filterScope.ts'

/*
 * Server-side list query. Ports the filter/sort/paginate/stats behaviour the UI
 * already shows (was `listCompetitorsSync` in the mock repository), with two
 * deliberate differences:
 *
 *  1. Follower ranges are parsed generically. The mock had a fixed 5-entry
 *     lookup while the dropdown offers 9 options, so "3K – 5K", "5K – 10K",
 *     "10K – 15K" and "15K – 20K" silently matched nothing. Parsing the label
 *     makes every option work.
 *  2. Stats come from real collection history instead of hardcoded constants.
 *     Series we cannot derive (approval status has no history) return empty
 *     rather than an invented trend.
 */

export interface CompetitorQuery {
  search: string
  country: string
  followerRange: string
  status: string
  period: string
  sort: 'name' | 'followers' | 'change' | 'lastCollection'
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const defaultQuery: CompetitorQuery = {
  search: '',
  country: 'all',
  followerRange: 'all',
  status: 'tracked',
  period: 'last-30',
  sort: 'followers',
  sortDir: 'desc',
  page: 1,
  pageSize: 8,
}

/** "Under 1K" | "5K – 20K" | "Over 50K" -> [min, max|null]. */
export function parseFollowerRange(label: string): [number, number | null] | null {
  if (!label || label === 'all') return null
  const num = (s: string): number => {
    const m = s.trim().match(/^([\d.]+)\s*([KM]?)$/i)
    if (!m) return NaN
    const scale = m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1
    return Number(m[1]) * scale
  }
  const under = label.match(/^Under\s+(.+)$/i)
  if (under) return [0, num(under[1]!)]
  const over = label.match(/^Over\s+(.+)$/i)
  if (over) return [num(over[1]!), null]
  // en-dash or hyphen separated
  const range = label.split(/[–-]/)
  if (range.length === 2) {
    const min = num(range[0]!)
    const max = num(range[1]!)
    if (!Number.isNaN(min) && !Number.isNaN(max)) return [min, max]
  }
  return null
}

function buildFilter(q: CompetitorQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = {}

  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ username: rx }, { displayName: rx }, { website: rx }]
  }
  if (q.country && q.country !== 'all') filter['location.country'] = q.country

  /*
   * There is no approval workflow: an account is either in the register or
   * deleted. Deleted accounts are hidden everywhere, so the list and the
   * headline count always agree. `status=deleted` stays available to the API
   * so a removal can still be found and undone.
   */
  filter.approvalStatus = q.status === 'deleted' ? 'deleted' : { $ne: 'deleted' }

  const bucket = parseFollowerRange(q.followerRange)
  if (bucket) {
    const [min, max] = bucket
    filter.latestFollowerCount = max == null ? { $gte: min } : { $gte: min, $lt: max }
  }
  return filter
}

const SORT_FIELDS: Record<string, string> = {
  name: 'displayName',
  followers: 'latestFollowerCount',
  lastCollection: 'lastSuccessfulCollectionAt',
}

export async function listCompetitors(input: Partial<CompetitorQuery>) {
  const q: CompetitorQuery = { ...defaultQuery, ...input }
  const filter = buildFilter(q)
  const dir = q.sortDir === 'asc' ? 1 : -1
  const days = periodDays(q.period)

  const total = await CompetitorAccount.countDocuments(filter)
  const pageCount = Math.max(1, Math.ceil(total / q.pageSize))
  const page = Math.min(Math.max(1, q.page), pageCount)

  // "change" isn't a stored field — it's derived per account, so that sort has
  // to happen after we compute it. Other sorts stay in the database.
  const sortInDb = q.sort !== 'change'
  const query = CompetitorAccount.find(filter)
  if (sortInDb) query.sort({ [SORT_FIELDS[q.sort] ?? 'latestFollowerCount']: dir })

  const docs = sortInDb ? await query.skip((page - 1) * q.pageSize).limit(q.pageSize) : await query

  let rows = await Promise.all(
    docs.map(async (doc) => ({
      ...serializeAccount(doc),
      followerChange30d: await followerChangePct(doc._id, days),
    })),
  )

  if (!sortInDb) {
    rows.sort((a, b) => dir * ((a.followerChange30d ?? 0) - (b.followerChange30d ?? 0)))
    rows = rows.slice((page - 1) * q.pageSize, page * q.pageSize)
  }

  return { rows, total, page, pageCount, stats: await buildStats(days) }
}

/**
 * Distinct country labels from live account metadata (location.country and
 * enrichment.country). When `requirePosts` is set, only countries that have at
 * least one in-window post are returned — so Overview cannot offer a filter
 * that analysis will immediately reject.
 */
export async function listCompetitorLocations(options?: {
  requirePosts?: boolean
  windowDays?: number
}): Promise<string[]> {
  const docs = await CompetitorAccount.find({ approvalStatus: { $ne: 'deleted' } })
    .select('_id location.country enrichment.country')
    .lean()

  let eligibleIds: Set<string> | null = null
  if (options?.requirePosts) {
    const windowDays = options.windowDays ?? 30
    const since = new Date(Date.now() - windowDays * 864e5)
    const withPosts = await Post.aggregate<{ _id: unknown }>([
      {
        $match: {
          publishedAt: { $gte: since },
          deleted: { $ne: true },
        },
      },
      { $group: { _id: '$accountId' } },
    ])
    eligibleIds = new Set(withPosts.map((r) => String(r._id)))
  }

  const byKey = new Map<string, string>()
  for (const doc of docs) {
    if (eligibleIds && !eligibleIds.has(String(doc._id))) continue
    for (const raw of [doc.location?.country, doc.enrichment?.country]) {
      const label = normalizeCountryLabel(raw)
      if (!label) continue
      const key = label.toLowerCase()
      if (!byKey.has(key)) byKey.set(key, label)
    }
  }

  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * How many live accounts match Overview filters (location · follower range).
 * Same scope used when running analysis — period affects the post window, not
 * which accounts are in the register.
 */
export async function countMatchingCompetitors(input: {
  location?: string
  followerRangeLabel?: string
}): Promise<{ matching: number; total: number }> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const range = parseOverviewFollowerRange(followerRangeLabel)

  const accounts = await CompetitorAccount.find({ approvalStatus: { $ne: 'deleted' } })
    .select('location enrichment latestFollowerCount')
    .lean()

  const total = accounts.length
  const matching = accounts.filter(
    (a) =>
      locationMatches(accountCountryOf(a), location) &&
      followerInRange(a.latestFollowerCount, range),
  ).length

  return { matching, total }
}

function normalizeCountryLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || /^unknown$/i.test(t) || /^n\/?a$/i.test(t) || /^global$/i.test(t)) return null
  return t
}

export function serializeAccount(doc: InstanceType<typeof CompetitorAccount>) {
  return {
    id: String(doc._id),
    platform: doc.platform,
    username: doc.username,
    displayName: doc.displayName,
    profileImageUrl: doc.profileImageUrl,
    website: doc.website,
    location: {
      country: doc.location?.country ?? null,
      region: doc.location?.region ?? null,
      city: doc.location?.city ?? null,
    },
    language: doc.language,
    niche: doc.niche,
    services: doc.services ?? [],
    specialization: doc.specialization,
    targetAudience: doc.targetAudience,
    positioningNote: doc.positioningNote,
    role: doc.role,
    approvalStatus: doc.approvalStatus,
    groupIds: (doc.groupIds ?? []).map(String),
    relevantCustomerIds: (doc.relevantCustomerIds ?? []).map(String),
    internalNotes: doc.internalNotes,
    latestFollowerCount: doc.latestFollowerCount,
    lastSuccessfulCollectionAt: doc.lastSuccessfulCollectionAt?.toISOString() ?? null,
    lastPostsCollectedAt: doc.lastPostsCollectedAt?.toISOString() ?? null,
    lastEnrichmentAt: doc.lastEnrichmentAt?.toISOString() ?? null,
    enrichment: doc.enrichment
      ? {
          country: doc.enrichment.country ?? null,
          countryConfidence: doc.enrichment.countryConfidence ?? null,
          accountType: doc.enrichment.accountType ?? null,
          followersCount: doc.enrichment.followersCount ?? null,
          postsAnalyzed: doc.enrichment.postsAnalyzed ?? null,
          averagePostsPerWeek: doc.enrichment.averagePostsPerWeek ?? null,
          postingFrequency: doc.enrichment.postingFrequency ?? null,
          averageLikes: doc.enrichment.averageLikes ?? null,
          averageComments: doc.enrichment.averageComments ?? null,
          engagementRate: doc.enrichment.engagementRate ?? null,
          estimatedPerformance: doc.enrichment.estimatedPerformance ?? null,
          primaryContentType: doc.enrichment.primaryContentType ?? null,
          dominantPostFormat: doc.enrichment.dominantPostFormat ?? null,
          latestPostDate: doc.enrichment.latestPostDate ?? null,
          model: doc.enrichment.model ?? null,
        }
      : null,
    dataQuality: doc.dataQuality ?? null,
    addedAt: (doc.addedAt ?? new Date()).toISOString(),
    addedBy: doc.addedBy,
  }
}

/** Bucket boundaries oldest→newest, `points` evenly spaced across the window. */
function buckets(days: number, points = 6): Date[] {
  const step = (days * 24 * 60 * 60 * 1000) / points
  const end = Date.now()
  return Array.from({ length: points }, (_, i) => new Date(end - step * (points - 1 - i)))
}

async function buildStats(days: number) {
  const windowStart = new Date(Date.now() - days * 864e5)

  // Deleted accounts have left the register: they must not inflate any headline
  // count, and neither must the posts collected for them while they were here.
  const live = await CompetitorAccount.find({ approvalStatus: { $ne: 'deleted' } }).select(
    'approvalStatus dataQuality lastSuccessfulCollectionAt addedAt',
  )
  const liveIds = live.map((a) => a._id)

  const [runs, collectedMetrics] = await Promise.all([
    CollectionRun.find({ startedAt: { $gte: windowStart } }).sort({ startedAt: 1 }),
    // Count what was actually collected, not just what a batch run logged —
    // single-account collections don't create a run row.
    PostMetricSnapshot.find({ collectedAt: { $gte: windowStart }, accountId: { $in: liveIds } }).select(
      'collectedAt',
    ),
  ])

  const collected = live.filter((a) => a.lastSuccessfulCollectionAt != null)
  const partial = collected.filter((a) => a.dataQuality === 'partial' || a.dataQuality === 'low').length
  const failed = live.filter((a) => a.dataQuality === 'failed').length
  const notRun = live.length - collected.length - failed
  const collectedPosts = collectedMetrics.length
  const collectionErrors = runs.reduce((sum, r) => sum + (r.failures ?? 0), 0) + failed

  const points = buckets(days)
  const accountsSeries = points.map((at) => live.filter((a) => (a.addedAt ?? new Date(0)) <= at).length)
  const postsSeries = points.map((at) => collectedMetrics.filter((m) => m.collectedAt <= at).length)
  const errorsSeries = points.map((at) =>
    runs.filter((r) => r.startedAt <= at).reduce((sum, r) => sum + (r.failures ?? 0), 0),
  )

  return {
    total: live.length,
    approved: live.filter((a) => ['approved', 'included-in-benchmarks'].includes(a.approvalStatus)).length,
    watchlist: live.filter((a) => a.approvalStatus === 'watchlist-only').length,
    inBenchmarks: live.filter((a) => a.approvalStatus === 'included-in-benchmarks').length,
    collectionSuccessRate: live.length ? Math.round((collected.length / live.length) * 1000) / 10 : 0,
    collectedPosts,
    collectionErrors,
    // Index-matched to card order. Empty = not derivable from stored history
    // (approval status changes aren't versioned), so no trend is invented.
    series: [accountsSeries, [], [], postsSeries, errorsSeries],
    statusBreakdown: [
      { label: 'Successful', value: collected.length - partial, color: 'var(--positive)' },
      { label: 'Failed', value: failed, color: 'var(--negative)' },
      { label: 'Partial', value: partial, color: 'var(--warning)' },
      { label: 'Not run', value: Math.max(0, notRun), color: 'var(--ink-300)' },
    ],
  }
}
