import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { CompetitorGroup, CompetitorSuggestion } from '../models/CompetitorGroup.ts'
import {
  AccountSnapshot,
  CollectionRun,
  Post,
  PostMetricSnapshot,
  RawPostPayload,
} from '../models/snapshots.ts'
import { listCompetitorLocations, listCompetitors, serializeAccount } from '../services/competitorQuery.ts'
import { accountActivity, followerChangePct, followerSeries, periodDays } from '../services/metrics.ts'
import {
  collectAccount,
  runCollection,
  scrapePostsForAccounts,
  snapshotNewAccount,
} from '../services/collection.ts'
import {
  AnalysisPreconditionError,
  getAnalysisForScope,
  getFailedAnalysisForScope,
  getLatestAnalysis,
  runRegisterAnalysis,
} from '../services/analysis.ts'
import { enrichAccounts } from '../services/enrichment.ts'
import { parseInstagramInput, scrapeProfile } from '../services/instagram.ts'
import { asyncHandler } from '../utils/asyncHandler.ts'
import { env } from '../config/env.ts'

export const competitorRoutes = Router()

/* ── list ─────────────────────────────────────────────────────────────── */

competitorRoutes.get(
  '/competitors',
  asyncHandler(async (req, res) => {
    const q = req.query
    const result = await listCompetitors({
      search: String(q.search ?? ''),
      country: String(q.country ?? 'all'),
      followerRange: String(q.followerRange ?? 'all'),
      status: String(q.status ?? 'tracked'),
      period: String(q.period ?? 'last-30'),
      sort: (q.sort as 'name' | 'followers' | 'change' | 'lastCollection') ?? 'followers',
      sortDir: q.sortDir === 'asc' ? 'asc' : 'desc',
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 8,
    })
    res.json(result)
  }),
)

/** Distinct countries from account location / enrichment metadata. */
competitorRoutes.get(
  '/competitors/locations',
  asyncHandler(async (req, res) => {
    // Overview passes requirePosts=1 so the dropdown only lists countries
    // analysis can actually run on (accounts with in-window posts).
    const requirePosts =
      req.query.requirePosts === '1' ||
      req.query.requirePosts === 'true' ||
      req.query.requirePosts === undefined // default: analysis-ready list
    const windowDays = Number(req.query.windowDays) || env.collection.backfillDays
    res.json({
      locations: await listCompetitorLocations({
        requirePosts,
        windowDays,
      }),
    })
  }),
)

/* ── detail ───────────────────────────────────────────────────────────── */

competitorRoutes.get(
  '/competitors/:id',
  asyncHandler(async (req, res) => {
    const account = await CompetitorAccount.findById(req.params.id)
    if (!account) return res.status(404).json({ message: 'Competitor not found' })

    const days = periodDays(String(req.query.period ?? 'last-30'))
    const [change, activity, series] = await Promise.all([
      followerChangePct(account._id, days),
      accountActivity(account._id, days, account.latestFollowerCount ?? null),
      followerSeries(account._id),
    ])

    res.json({
      account: serializeAccount(account),
      followerChange: change,
      postsCollected: activity.postsCollected,
      postsPerWeek: activity.postsPerWeek,
      medianEngagementRate: activity.medianEngagementRate,
      // Authority mix needs post classification (phase 2) — return empty
      // rather than a placeholder the strategist might read as real.
      authorityMix: [],
      topFormats: activity.topFormats,
      topTopics: [],
      lastCollectionAt: account.lastSuccessfulCollectionAt?.toISOString() ?? null,
      followerSeries: series,
    })
  }),
)

/* ── add flow: lookup → confirm ───────────────────────────────────────── */

competitorRoutes.post(
  '/competitors/lookup',
  asyncHandler(async (req, res) => {
    const input = String(req.body?.input ?? '')
    const username = parseInstagramInput(input)
    if (!username) {
      return res.status(400).json({ message: 'Enter an Instagram URL (instagram.com/…) or a username.' })
    }

    const existing = await CompetitorAccount.findOne({ username })
    if (existing) return res.status(409).json({ message: `@${username} is already in the competitor list.` })

    const profile = await scrapeProfile(username)
    if (!profile) return res.status(404).json({ message: `@${username} could not be read on Instagram.` })

    res.json({
      username: profile.username,
      displayName: profile.displayName ?? profile.username,
      biography: profile.biography ?? '',
      website: profile.website,
      followerCount: profile.followerCount ?? 0,
      followingCount: profile.followingCount ?? 0,
      postCount: profile.visiblePostCount ?? 0,
      verified: profile.verified ?? false,
      // Location isn't exposed by the profile scrape — the operator sets it on
      // confirm rather than us guessing from the bio.
      locationGuess: { country: '', city: null },
      suggestedRole: 'peer-benchmark',
      plannedCollection:
        'On add: profile snapshot only. Posts are scraped later when you select the account and run Scrape posts.',
    })
  }),
)

const newCompetitor = z.object({
  username: z.string().min(1),
  displayName: z.string().optional().default(''),
  website: z.string().nullable().optional().default(null),
  country: z.string().optional().default(''),
  city: z.string().nullable().optional().default(null),
  language: z.string().nullable().optional().default(null),
  specialization: z.string().nullable().optional().default(null),
  internalNotes: z.string().nullable().optional().default(null),
  role: z.string().optional().default('peer-benchmark'),
  followerCount: z.number().nullable().optional().default(null),
})

competitorRoutes.post(
  '/competitors',
  asyncHandler(async (req, res) => {
    const parsed = newCompetitor.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Invalid competitor payload' })
    const input = parsed.data

    const username = parseInstagramInput(input.username)
    if (!username) return res.status(400).json({ message: 'Invalid Instagram username.' })
    if (await CompetitorAccount.findOne({ username })) {
      return res.status(409).json({ message: `@${username} is already in the competitor list.` })
    }

    const account = await CompetitorAccount.create({
      username,
      displayName: input.displayName || username,
      website: input.website,
      location: { country: input.country || null, region: null, city: input.city },
      language: input.language,
      specialization: input.specialization,
      internalNotes: input.internalNotes,
      role: input.role,
      // No approval workflow: an added account is in the register immediately.
      approvalStatus: 'approved',
      latestFollowerCount: input.followerCount,
      addedBy: 'manual',
    })

    snapshotNewAccount(account._id, account.username)

    res.status(201).json(serializeAccount(account))
  }),
)

/*
 * The raw Apify items behind an account's posts, newest first.
 *
 * Normalisation is lossy — it reads a handful of aliases per field and drops
 * everything else — so this is what you check when a figure looks wrong and you
 * need to tell "the scraper returned nothing" from "we mapped it badly".
 *
 * Only posts collected since raw capture was added have a payload; older ones
 * report as missing rather than being silently omitted, so the gap is visible
 * as a gap and not mistaken for the account having no posts.
 */
competitorRoutes.get(
  '/competitors/:id/raw-posts',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid competitor id' })
    }
    const account = await CompetitorAccount.findById(req.params.id).select(
      'username displayName lastSuccessfulCollectionAt',
    )
    if (!account) return res.status(404).json({ message: 'Competitor not found' })

    const limit = Math.min(Number(req.query.limit) || 50, 200)

    const posts = await Post.find({ accountId: account._id })
      .select('platformPostId publishedAt url')
      .sort({ publishedAt: -1 })
      .limit(limit)

    const payloads = await RawPostPayload.find({
      accountId: account._id,
      platformPostId: { $in: posts.map((p) => p.platformPostId) },
    }).select('platformPostId collectedAt source payload')

    const byPostId = new Map(payloads.map((r) => [r.platformPostId, r]))

    res.json({
      username: account.username,
      /*
       * Both are needed to explain an empty list honestly: "never collected" and
       * "collected fine, but this account has not posted inside the window" look
       * identical from the item list alone, and telling an operator to run
       * collection on a dormant account sends them chasing a non-problem.
       */
      lastCollectedAt: account.lastSuccessfulCollectionAt
        ? account.lastSuccessfulCollectionAt.toISOString()
        : null,
      windowDays: env.collection.backfillDays,
      totalPosts: await Post.countDocuments({ accountId: account._id }),
      capturedCount: await RawPostPayload.countDocuments({ accountId: account._id }),
      items: posts.map((p) => {
        const raw = byPostId.get(p.platformPostId)
        return {
          platformPostId: p.platformPostId,
          publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
          url: p.url ?? null,
          collectedAt: raw?.collectedAt ? raw.collectedAt.toISOString() : null,
          source: raw?.source ?? null,
          payload: raw?.payload ?? null,
        }
      }),
    })
  }),
)

/* ── status workflow ──────────────────────────────────────────────────── */

competitorRoutes.patch(
  '/competitors/status',
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string()).min(1), status: z.string() }).safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'ids and status are required' })

    await CompetitorAccount.updateMany(
      { _id: { $in: body.data.ids } },
      { $set: { approvalStatus: body.data.status } },
    )
    res.json({ updated: body.data.ids.length })
  }),
)

/* ── deletion ─────────────────────────────────────────────────────────── */

/*
 * Two levels, because collected history is the expensive part of this system:
 *
 *   remove (default) — mark the account `deleted`. It leaves the register and
 *     stops being collected, but its snapshots/posts/metrics survive, so the
 *     decision is reversible and past benchmarks stay reproducible.
 *
 *   purge            — irreversibly destroy the account AND everything observed
 *     about it. For accounts added by mistake (wrong handle, typo), where
 *     keeping the history would be misleading rather than useful.
 */
competitorRoutes.delete(
  '/competitors',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ ids: z.array(z.string()).min(1), purge: z.boolean().optional().default(false) })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'ids are required' })
    const { ids, purge } = body.data

    if (!purge) {
      const result = await CompetitorAccount.updateMany(
        { _id: { $in: ids } },
        { $set: { approvalStatus: 'deleted' } },
      )
      return res.json({ removed: result.modifiedCount, purged: 0 })
    }

    // Cascade by hand: the observation collections reference the account, and
    // leaving them behind would keep it in aggregate counts as an orphan.
    const posts = await Post.find({ accountId: { $in: ids } }).select('_id')
    const postIds = posts.map((p) => p._id)

    const [metrics, snapshots, rawPayloads, accounts] = await Promise.all([
      PostMetricSnapshot.deleteMany({ $or: [{ accountId: { $in: ids } }, { postId: { $in: postIds } }] }),
      AccountSnapshot.deleteMany({ accountId: { $in: ids } }),
      RawPostPayload.deleteMany({ accountId: { $in: ids } }),
      CompetitorAccount.deleteMany({ _id: { $in: ids } }),
    ])
    await Post.deleteMany({ accountId: { $in: ids } })

    console.warn(
      `[backoffice] purged ${accounts.deletedCount} competitor(s): ` +
        `${posts.length} posts, ${metrics.deletedCount} metric rows, ${snapshots.deletedCount} snapshots, ` +
        `${rawPayloads.deletedCount} raw payloads`,
    )

    res.json({
      removed: 0,
      purged: accounts.deletedCount,
      deletedPosts: posts.length,
      deletedSnapshots: snapshots.deletedCount,
      deletedMetrics: metrics.deletedCount,
    })
  }),
)

/* ── groups & suggestions ─────────────────────────────────────────────── */

competitorRoutes.get(
  '/competitor-groups',
  asyncHandler(async (_req, res) => {
    const groups = await CompetitorGroup.find().sort({ createdAt: -1 })
    res.json(
      groups.map((g) => ({
        id: String(g._id),
        name: g.name,
        type: g.type,
        origin: g.origin,
        reviewed: g.reviewed,
        customerId: g.customerId,
        memberAccountIds: (g.memberAccountIds ?? []).map(String),
        criteriaNote: g.criteriaNote,
        createdAt: (g.createdAt ?? new Date()).toISOString(),
        memberCount: (g.memberAccountIds ?? []).length,
      })),
    )
  }),
)

competitorRoutes.get(
  '/competitor-suggestions',
  asyncHandler(async (_req, res) => {
    const items = await CompetitorSuggestion.find({ status: { $in: ['pending', 'saved-for-later'] } })
    res.json(
      items.map((s) => ({
        id: String(s._id),
        username: s.username,
        reason: s.reason,
        similarity: s.similarity,
        suggestedRole: s.suggestedRole,
        confidence: s.confidence,
        status: s.status,
        rejectionReason: s.rejectionReason,
        suggestedAt: (s.suggestedAt ?? new Date()).toISOString(),
      })),
    )
  }),
)

competitorRoutes.patch(
  '/competitor-suggestions/:id',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        resolution: z.enum(['approved', 'rejected', 'saved-for-later']),
        rejectionReason: z.string().nullable().optional(),
      })
      .safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'Invalid resolution' })

    const suggestion = await CompetitorSuggestion.findById(req.params.id)
    if (!suggestion) return res.status(404).json({ message: 'Suggestion not found' })

    suggestion.status = body.data.resolution
    suggestion.rejectionReason = body.data.rejectionReason ?? null

    // Approving a suggestion promotes it into the register for review.
    if (body.data.resolution === 'approved' && !(await CompetitorAccount.findOne({ username: suggestion.username }))) {
      const account = await CompetitorAccount.create({
        username: suggestion.username,
        displayName: suggestion.username,
        role: suggestion.suggestedRole,
        approvalStatus: 'approved',
        addedBy: 'discovery',
      })
      // Same profile snapshot as a manually added competitor — posts are
      // scraped later via the explicit Scrape posts action.
      snapshotNewAccount(account._id, account.username)
    }
    await suggestion.save()
    res.json({ ok: true })
  }),
)

/* ── collection ───────────────────────────────────────────────────────── */

competitorRoutes.get(
  '/collection/status',
  asyncHandler(async (_req, res) => {
    const [last] = await CollectionRun.find({ finishedAt: { $ne: null } }).sort({ startedAt: -1 }).limit(1)
    if (last) {
      return res.json({
        lastRunAt: last.startedAt.toISOString(),
        accountsProcessed: last.accountsProcessed,
        postsCollected: last.postsCollected,
        failures: last.failures,
        source: 'Apify',
      })
    }

    // No batch run yet — single-account collections still count as collection,
    // so report from the accounts themselves rather than claiming "never".
    const [latest] = await CompetitorAccount.find({ lastSuccessfulCollectionAt: { $ne: null } })
      .sort({ lastSuccessfulCollectionAt: -1 })
      .limit(1)
    res.json({
      lastRunAt: latest?.lastSuccessfulCollectionAt?.toISOString() ?? null,
      accountsProcessed: await CompetitorAccount.countDocuments({ lastSuccessfulCollectionAt: { $ne: null } }),
      postsCollected: await Post.countDocuments(),
      failures: await CompetitorAccount.countDocuments({ dataQuality: 'failed' }),
      source: 'Apify',
    })
  }),
)

competitorRoutes.post(
  '/collection/run',
  asyncHandler(async (req, res) => {
    // A single-account run is fast enough to await; a full run is not, so it is
    // started in the background and progress is read from /collection/status.
    const accountId = req.body?.accountId as string | undefined
    if (accountId) {
      const result = await collectAccount(accountId)
      return res.json(result)
    }

    void runCollection('manual').catch((err) => console.error('[collection] run failed:', err))
    res.status(202).json({ started: true })
  }),
)

/*
 * Operator-selected post scrape for the last COLLECTION_BACKFILL_DAYS (default 30).
 * Accounts scraped inside that window are skipped and reported in the response.
 * Waits for the scrapes to finish so the UI can show a loader for the duration.
 */
competitorRoutes.post(
  '/collection/scrape-posts',
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'ids are required' })

    const plan = await scrapePostsForAccounts(body.data.ids)
    res.json({
      ...plan,
      windowDays: env.collection.backfillDays,
    })
  }),
)

/*
 * Claude enrichment for operator-selected accounts. Writes structured metadata
 * (country, account type, posting cadence, engagement, performance, …).
 * Accounts enriched inside COLLECTION_BACKFILL_DAYS are skipped.
 */
competitorRoutes.post(
  '/collection/enrich-accounts',
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'ids are required' })

    const plan = await enrichAccounts(body.data.ids)
    res.json(plan)
  }),
)

/* ── register analysis (Claude) ───────────────────────────────────────── */

competitorRoutes.get(
  '/analysis/latest',
  asyncHandler(async (req, res) => {
    // With filter query params, return the saved report for that scope.
    // Without them, return the newest run overall (status / debugging).
    const location = typeof req.query.location === 'string' ? req.query.location : undefined
    const followerRangeLabel =
      typeof req.query.followerRangeLabel === 'string' ? req.query.followerRangeLabel : undefined
    const period = typeof req.query.period === 'string' ? req.query.period : undefined

    if (location || followerRangeLabel || period) {
      const scoped = await getAnalysisForScope({ location, followerRangeLabel, period })
      return res.json(scoped)
    }

    const latest = await getLatestAnalysis()
    res.json(latest)
  }),
)

competitorRoutes.post(
  '/analysis/run',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        location: z.string().optional(),
        followerRangeLabel: z.string().optional(),
        period: z.string().optional(),
        windowDays: z.number().optional(),
      })
      .safeParse(req.body ?? {})
    const input = body.success ? body.data : {}
    try {
      const result = await runRegisterAnalysis(input)
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Operator-fixable (filters / scrape) — not a server fault.
      if (err instanceof AnalysisPreconditionError) {
        return res.status(400).json({ message })
      }
      const failed = await getFailedAnalysisForScope({
        location: input.location,
        followerRangeLabel: input.followerRangeLabel,
        period: input.period,
      })
      if (failed) return res.status(500).json({ ...failed, message: failed.error ?? message })
      res.status(500).json({ message })
    }
  }),
)
