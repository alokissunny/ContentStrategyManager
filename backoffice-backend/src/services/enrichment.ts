import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { AccountSnapshot, Post, PostMetricSnapshot } from '../models/snapshots.ts'
import { env } from '../config/env.ts'
import { getAnthropicClient } from './anthropicClient.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../prompts/account-enrichment-prompt.md',
)

const POSTING_FREQUENCIES = new Set([
  'Daily',
  'Frequent',
  'Weekly',
  'Occasional',
  'Inactive',
  'Unknown',
])
const PERFORMANCE_LEVELS = new Set([
  'Excellent',
  'Good',
  'Average',
  'Below Average',
  'Unknown',
])
const CONFIDENCE_LEVELS = new Set(['High', 'Medium', 'Low'])

export interface AccountEnrichment {
  country: string | null
  countryConfidence: string | null
  accountType: string | null
  followersCount: number | null
  postsAnalyzed: number | null
  averagePostsPerWeek: number | null
  postingFrequency: string
  averageLikes: number | null
  averageComments: number | null
  engagementRate: number | null
  estimatedPerformance: string
  primaryContentType: string | null
  dominantPostFormat: string | null
  latestPostDate: string | null
  model: string | null
}

export interface EnrichmentPlan {
  started: { id: string; username: string }[]
  skipped: { id: string; username: string; lastEnrichmentAt: string }[]
  failed: { id: string; username: string; error: string }[]
  enriched: { id: string; username: string; enrichment: AccountEnrichment }[]
  windowDays: number
}

function loadPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8')
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return JSON.parse(fenced[1].trim())
  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    return JSON.parse(trimmed.slice(objStart, objEnd + 1))
  }
  throw new Error('Claude response was not valid JSON')
}

async function callClaude(prompt: string, maxTokens: number): Promise<string> {
  const model = env.anthropic.model
  console.log(
    `[enrichment] calling ${model} promptChars=${prompt.length} max_tokens=${maxTokens}`,
  )
  const startedMs = Date.now()
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt }],
  })
  const text = (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim()
  console.log(
    `[enrichment] ${Date.now() - startedMs}ms stop=${response.stop_reason} ` +
      `in=${response.usage?.input_tokens} out=${response.usage?.output_tokens}`,
  )
  if (!text) {
    throw new Error(
      `Claude returned no text for enrichment (stop_reason=${response.stop_reason})`,
    )
  }
  return text
}

function asNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function asStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || /^unknown$/i.test(t) || /^n\/?a$/i.test(t)) return null
  return t
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Build profile + last-N-days posts payload from stored snapshots (Apify-shaped). */
async function buildAccountPayload(accountId: string, windowDays: number) {
  const account = await CompetitorAccount.findById(accountId)
  if (!account) throw new Error(`Account ${accountId} not found`)

  const [snapshot] = await AccountSnapshot.find({ accountId: account._id })
    .sort({ collectedAt: -1 })
    .limit(1)

  const windowStart = new Date(Date.now() - windowDays * 864e5)
  const posts = await Post.find({
    accountId: account._id,
    publishedAt: { $gte: windowStart },
    deleted: { $ne: true },
  }).sort({ publishedAt: -1 })

  const postIds = posts.map((p) => p._id)
  const metrics = postIds.length
    ? await PostMetricSnapshot.aggregate([
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
    : []
  const metricsByPost = new Map(metrics.map((m) => [String(m._id), m]))

  const formatCounts = new Map<string, number>()
  let likesSum = 0
  let likesN = 0
  let commentsSum = 0
  let commentsN = 0

  const postPayloads = posts.map((p) => {
    formatCounts.set(p.format, (formatCounts.get(p.format) ?? 0) + 1)
    const m = metricsByPost.get(String(p._id))
    if (m?.likes != null) {
      likesSum += m.likes
      likesN += 1
    }
    if (m?.comments != null) {
      commentsSum += m.comments
      commentsN += 1
    }
    return {
      id: p.platformPostId,
      url: p.url,
      timestamp: p.publishedAt?.toISOString() ?? null,
      type: p.format,
      caption: (p.caption ?? '').slice(0, 280),
      hashtags: (p.hashtags ?? []).slice(0, 12),
      mentions: (p.mentions ?? []).slice(0, 8),
      likesCount: m?.likes ?? null,
      commentsCount: m?.comments ?? null,
      // Views are provided for context only — never treat as reach.
      videoViewCount: m?.views ?? null,
      locationName: null as string | null,
    }
  })

  const followers =
    snapshot?.followerCount ?? account.latestFollowerCount ?? null
  const averageLikes = likesN > 0 ? round1(likesSum / likesN) : null
  const averageComments = commentsN > 0 ? round1(commentsSum / commentsN) : null
  const averagePostsPerWeek =
    posts.length > 0 ? round2(posts.length / (windowDays / 7)) : 0
  const engagementRate =
    followers != null &&
    followers > 0 &&
    averageLikes != null &&
    averageComments != null
      ? round2(((averageLikes + averageComments) / followers) * 100)
      : null

  let dominantPostFormat: string | null = null
  let maxFmt = 0
  for (const [fmt, n] of formatCounts) {
    if (n > maxFmt) {
      maxFmt = n
      dominantPostFormat = fmt
    }
  }

  const latestPostDate = posts[0]?.publishedAt?.toISOString() ?? null

  const computed = {
    followersCount: followers,
    postsAnalyzed: posts.length,
    averagePostsPerWeek,
    averageLikes,
    averageComments,
    engagementRate,
    dominantPostFormat,
    latestPostDate,
  }

  const profile = {
    username: account.username,
    fullName: snapshot?.displayName ?? account.displayName,
    biography: snapshot?.biography ?? null,
    externalUrl: snapshot?.website ?? account.website ?? null,
    followersCount: followers,
    followsCount: snapshot?.followingCount ?? null,
    postsCount: snapshot?.visiblePostCount ?? null,
    verified: snapshot?.verified ?? null,
    businessCategoryName: snapshot?.category ?? null,
    location: account.location ?? null,
  }

  return {
    account,
    payload: {
      windowDays,
      profile,
      posts: postPayloads,
      computed,
    },
    computed,
  }
}

function normalizeEnrichment(
  raw: Record<string, unknown>,
  computed: {
    followersCount: number | null
    postsAnalyzed: number
    averagePostsPerWeek: number
    averageLikes: number | null
    averageComments: number | null
    engagementRate: number | null
    dominantPostFormat: string | null
    latestPostDate: string | null
  },
  model: string,
): AccountEnrichment {
  const freq = asStr(raw.postingFrequency)
  const perf = asStr(raw.estimatedPerformance)
  const conf = asStr(raw.countryConfidence)

  return {
    country: asStr(raw.country),
    countryConfidence:
      conf && CONFIDENCE_LEVELS.has(conf)
        ? conf
        : conf
          ? conf
          : null,
    accountType: asStr(raw.accountType),
    // Prefer measured values — never invent metrics Claude might guess.
    followersCount: computed.followersCount ?? asNum(raw.followersCount),
    postsAnalyzed: computed.postsAnalyzed,
    averagePostsPerWeek: computed.averagePostsPerWeek,
    postingFrequency: freq && POSTING_FREQUENCIES.has(freq) ? freq : 'Unknown',
    averageLikes: computed.averageLikes ?? asNum(raw.averageLikes),
    averageComments: computed.averageComments ?? asNum(raw.averageComments),
    engagementRate: computed.engagementRate ?? asNum(raw.engagementRate),
    estimatedPerformance:
      perf && PERFORMANCE_LEVELS.has(perf) ? perf : 'Unknown',
    primaryContentType: asStr(raw.primaryContentType),
    dominantPostFormat:
      computed.dominantPostFormat ?? asStr(raw.dominantPostFormat),
    latestPostDate: computed.latestPostDate ?? asStr(raw.latestPostDate),
    model,
  }
}

async function enrichOneAccount(
  accountId: string,
  windowDays: number,
): Promise<AccountEnrichment> {
  const { account, payload, computed } = await buildAccountPayload(
    accountId,
    windowDays,
  )

  if (computed.postsAnalyzed === 0 && !payload.profile.biography) {
    throw new Error(
      'No profile biography or posts in window. Scrape posts first, then run enrichment.',
    )
  }

  const prompt = loadPrompt()
    .replaceAll('{{WINDOW_DAYS}}', String(windowDays))
    .replace('{{PAYLOAD_JSON}}', JSON.stringify(payload, null, 2))

  const text = await callClaude(prompt, 4096)
  const parsed = extractJson(text) as Record<string, unknown>
  const enrichment = normalizeEnrichment(parsed, computed, env.anthropic.model)

  account.enrichment = enrichment
  account.lastEnrichmentAt = new Date()
  // Feed country into location when Claude is reasonably confident — helps filters.
  if (
    enrichment.country &&
    enrichment.countryConfidence &&
    enrichment.countryConfidence !== 'Low'
  ) {
    if (!account.location) account.location = { country: null, region: null, city: null }
    account.location.country = enrichment.country
  }
  if (enrichment.primaryContentType && !account.specialization) {
    account.specialization = enrichment.primaryContentType
  }
  if (enrichment.accountType && !account.niche) {
    account.niche = enrichment.accountType
  }
  await account.save()

  console.log(
    `[enrichment] @${account.username}: ${enrichment.accountType ?? 'n/a'} · ` +
      `${enrichment.country ?? 'n/a'} · ${enrichment.postingFrequency} · ` +
      `${enrichment.estimatedPerformance}`,
  )

  return enrichment
}

/**
 * Enrich operator-selected accounts with Claude-derived metadata.
 * Accounts enriched inside the last `windowDays` are skipped.
 */
export async function enrichAccounts(ids: string[]): Promise<EnrichmentPlan> {
  const windowDays = env.collection.backfillDays
  const freshCutoff = Date.now() - windowDays * 864e5

  const accounts = await CompetitorAccount.find({
    _id: { $in: ids },
    approvalStatus: { $ne: 'deleted' },
  }).select('username lastEnrichmentAt')

  const started: EnrichmentPlan['started'] = []
  const skipped: EnrichmentPlan['skipped'] = []
  for (const a of accounts) {
    if (a.lastEnrichmentAt && a.lastEnrichmentAt.getTime() >= freshCutoff) {
      skipped.push({
        id: String(a._id),
        username: a.username,
        lastEnrichmentAt: a.lastEnrichmentAt.toISOString(),
      })
    } else {
      started.push({ id: String(a._id), username: a.username })
    }
  }

  const enriched: EnrichmentPlan['enriched'] = []
  const failed: EnrichmentPlan['failed'] = []
  const concurrency = Math.min(2, env.collection.concurrency)

  let cursor = 0
  const workers = Array.from(
    { length: Math.min(concurrency, started.length) },
    async () => {
      while (cursor < started.length) {
        const index = cursor++
        const item = started[index]!
        try {
          const enrichment = await enrichOneAccount(item.id, windowDays)
          enriched.push({ id: item.id, username: item.username, enrichment })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[enrichment] failed @${item.username}:`, message)
          failed.push({ id: item.id, username: item.username, error: message })
        }
      }
    },
  )
  await Promise.all(workers)

  return { started, skipped, failed, enriched, windowDays }
}
