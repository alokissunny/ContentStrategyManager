import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CompetitorAnalysis } from '../models/CompetitorAnalysis.ts'
import { env } from '../config/env.ts'
import { getAnthropicClient } from './anthropicClient.ts'
import {
  buildAnalysisCorpus,
  type CondensedAccount,
  type CorpusStats,
} from './analysisCorpus.ts'
import { periodToDays, type AnalysisFilterScope } from './filterScope.ts'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../prompts')
const DASHBOARD_PROMPT_PATH = join(PROMPT_DIR, 'register-analysis-prompt.md')
const BATCH_MEMO_PROMPT_PATH = join(PROMPT_DIR, 'register-batch-memo-prompt.md')

/** Parallel Claude map calls — keep modest to avoid rate limits. */
const MAP_CONCURRENCY = 3
const MAP_MAX_TOKENS = 4096
const REDUCE_MAX_TOKENS = 12288

function loadPrompt(path: string): string {
  return readFileSync(path, 'utf8')
}

export interface AnalysisResult {
  id: string
  status: 'running' | 'completed' | 'failed'
  windowDays: number
  model: string | null
  markdown: string | null
  dashboard: unknown | null
  error: string | null
  accountsAnalyzed: number
  postsAnalyzed: number
  filterScope: AnalysisFilterScope | null
  startedAt: string
  finishedAt: string | null
}

function serialize(doc: InstanceType<typeof CompetitorAnalysis>): AnalysisResult {
  const scope = doc.filterScope
  return {
    id: String(doc._id),
    status: doc.status as AnalysisResult['status'],
    windowDays: doc.windowDays,
    model: doc.llmModel ?? null,
    markdown: doc.markdown ?? null,
    dashboard: doc.dashboard ?? null,
    error: doc.error ?? null,
    accountsAnalyzed: doc.accountsAnalyzed,
    postsAnalyzed: doc.postsAnalyzed,
    filterScope: scope
      ? {
          location: scope.location ?? 'Global',
          followerRangeLabel: scope.followerRangeLabel ?? 'All sizes',
          period: scope.period ?? 'last-30',
          windowDays: scope.windowDays ?? doc.windowDays,
        }
      : null,
    startedAt: (doc.startedAt ?? doc.createdAt ?? new Date()).toISOString(),
    finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
  }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim())
  }
  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart) && arrEnd > arrStart) {
    return JSON.parse(trimmed.slice(arrStart, arrEnd + 1))
  }
  if (objStart >= 0 && objEnd > objStart) {
    return JSON.parse(trimmed.slice(objStart, objEnd + 1))
  }
  throw new Error('Claude response was not valid JSON')
}

/**
 * Call Claude with thinking disabled. Sonnet 5 defaults to adaptive thinking and
 * can burn the entire max_tokens budget on a thinking block, returning no text.
 */
async function callClaude(label: string, prompt: string, maxTokens: number): Promise<string> {
  const model = env.anthropic.model
  console.log(
    `[analysis:${label}] calling ${model} promptChars=${prompt.length} max_tokens=${maxTokens} thinking=disabled`,
  )
  const startedMs = Date.now()
  let response
  try {
    response = await getAnthropicClient().messages.create({
      model,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    })
  } catch (apiErr) {
    console.error(`[analysis:${label}] API error after ${Date.now() - startedMs}ms:`, apiErr)
    throw apiErr
  }

  const blocks = response.content ?? []
  const blockSummary = blocks.map((b, i) => {
    if (b.type === 'text') {
      return {
        i,
        type: b.type,
        chars: b.text?.length ?? 0,
        preview: (b.text ?? '').slice(0, 120).replace(/\s+/g, ' '),
      }
    }
    return { i, type: b.type, keys: Object.keys(b) }
  })
  console.log(
    `[analysis:${label}] ${Date.now() - startedMs}ms id=${response.id} stop=${response.stop_reason} ` +
      `in=${response.usage?.input_tokens} out=${response.usage?.output_tokens} blocks=${JSON.stringify(blockSummary)}`,
  )

  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim()

  if (!text) {
    throw new Error(
      `Claude returned no text for ${label} (stop_reason=${response.stop_reason}, ` +
        `output_tokens=${response.usage?.output_tokens ?? 0}, blockTypes=${blocks.map((b) => b.type).join(',') || 'none'})`,
    )
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn(`[analysis:${label}] truncated at max_tokens — JSON may be incomplete`)
  }
  return text
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  }
  const workers = Math.min(Math.max(1, concurrency), Math.max(1, items.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

const PILLARS = new Set(['discovery', 'credibility', 'trust'])

function asNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}

function pillarOf(v: unknown): 'discovery' | 'credibility' | 'trust' | null {
  const s = asStr(v).toLowerCase()
  return PILLARS.has(s) ? (s as 'discovery' | 'credibility' | 'trust') : null
}

/**
 * Hydrate Claude's compact JSON into the Overview dashboard shape the UI expects.
 */
function normalizeDashboard(
  raw: Record<string, unknown>,
  meta: { accountsAnalyzed: number; postsAnalyzed: number; windowDays: number; finishedAt: Date },
) {
  const from = isoDay(new Date(meta.finishedAt.getTime() - meta.windowDays * 864e5))
  const to = isoDay(meta.finishedAt)
  const sample = {
    accountsAnalyzed: meta.accountsAnalyzed,
    postsAnalyzed: meta.postsAnalyzed,
    dateRange: { from, to },
    locations: [{ country: null, region: null, city: null }],
    followerRange: null,
    comparisonGroupLabel: 'Full register',
    lastCollectionDate: meta.finishedAt.toISOString(),
  }

  const summaryRaw = (raw.summary ?? {}) as Record<string, unknown>
  const target = (summaryRaw.accountTarget ?? {}) as Record<string, unknown>

  const findings = (Array.isArray(raw.findings) ? raw.findings : []).map((f, i) => {
    const row = (f ?? {}) as Record<string, unknown>
    const unit = asStr(row.valueUnit, 'percent-of-posts')
    return {
      id: asStr(row.id, `find-${i + 1}`),
      title: asStr(row.title, 'Untitled finding'),
      explanation: asStr(row.explanation),
      kind: 'stronger-account-difference',
      dimension: asStr(row.dimension) || null,
      authorityPillar: pillarOf(row.authorityPillar),
      focusValue: row.focusValue == null ? null : asNum(row.focusValue),
      comparisonValue: row.comparisonValue == null ? null : asNum(row.comparisonValue),
      valueUnit: ['percent-of-posts', 'percent-of-accounts', 'per-week', 'ratio', 'absolute'].includes(unit)
        ? unit
        : 'percent-of-posts',
      metricDefinition: asStr(
        row.metricDefinition,
        'Percentage of relevant posts showing this behavior within the selected account group.',
      ),
      sample,
      evidenceStrength: ['strong', 'moderate', 'exploratory', 'inconclusive'].includes(asStr(row.evidenceStrength))
        ? asStr(row.evidenceStrength)
        : 'moderate',
      evidenceKinds: ['observed-public-fact', 'ai-classification', 'calculated-metric'],
      limitations: ['Private reach, saves, shares and advertising influence are unknown.'],
      paidDistributionUncertainty: true,
      exampleAccountIds: [],
      examplePostIds: [],
      recommendationReady: false,
      recommendationReadyReasons: [],
      reproducibilityNote: null,
      suggestedExperiment: null,
      relevantCustomerIds: [],
      humanReviewed: false,
      detectedAt: meta.finishedAt.toISOString(),
    }
  })

  const movements = (Array.isArray(raw.movements) ? raw.movements : []).map((m, i) => {
    const row = (m ?? {}) as Record<string, unknown>
    const dim = asStr(row.dimension, 'format')
    return {
      id: asStr(row.id, `move-${i + 1}`),
      dimension: [
        'format',
        'topic',
        'hook',
        'caption-structure',
        'hashtag',
        'authority-pillar',
        'visual-attribute',
        'posting-day',
        'posting-time',
        'content-type',
      ].includes(dim)
        ? dim
        : 'format',
      pattern: asStr(row.pattern, 'Pattern'),
      previousValue: row.previousValue == null ? null : asNum(row.previousValue),
      currentValue: row.currentValue == null ? null : asNum(row.currentValue),
      changePp: row.changePp == null ? null : asNum(row.changePp),
      state: asStr(row.state, 'stable'),
      metricDefinition: asStr(row.metricDefinition, 'Share of posts in the analysis window.'),
      relativePerformance: null,
      sample,
      evidenceStrength: asStr(row.evidenceStrength, 'moderate'),
    }
  })

  const hooks = (Array.isArray(raw.hooks) ? raw.hooks : []).map((h) => {
    const row = (h ?? {}) as Record<string, unknown>
    const trend = asStr(row.trend, 'flat')
    return {
      hookType: asStr(row.hookType, 'Hook'),
      structure: asStr(row.structure),
      useRate: asNum(row.useRate),
      medianEngagement: asNum(row.medianEngagement),
      trend: trend === 'up' || trend === 'down' || trend === 'flat' ? trend : 'flat',
      pillar: pillarOf(row.pillar) ?? 'discovery',
    }
  })

  const topics = (Array.isArray(raw.topics) ? raw.topics : []).map((t) => {
    const row = (t ?? {}) as Record<string, unknown>
    return {
      topic: asStr(row.topic, 'Topic'),
      sharePct: asNum(row.sharePct),
      accounts: asNum(row.accounts),
      posts: asNum(row.posts),
      changePp: asNum(row.changePp),
      pillar: pillarOf(row.pillar) ?? 'credibility',
    }
  })

  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : []).map((h) => {
    const row = (h ?? {}) as Record<string, unknown>
    const type = asStr(row.type, 'Category')
    return {
      tag: asStr(row.tag).startsWith('#') ? asStr(row.tag) : `#${asStr(row.tag, 'tag')}`,
      type: ['Category', 'Local', 'Niche', 'Branded'].includes(type) ? type : 'Category',
      highPerformerAccounts: asNum(row.highPerformerAccounts),
      comparisonAccounts: asNum(row.comparisonAccounts),
    }
  })

  const basisRaw = (raw.hashtagBasis ?? {}) as Record<string, unknown>
  const weekly = (Array.isArray(raw.weekly) ? raw.weekly : []).map((w) => {
    const row = (w ?? {}) as Record<string, unknown>
    const format = asStr(row.format, 'image')
    const p = pillarOf(row.pillar) ?? 'discovery'
    return {
      day: asStr(row.day, 'Monday'),
      pillar: p,
      pillarLabel: asStr(row.pillarLabel, p[0]!.toUpperCase() + p.slice(1)),
      contentType: asStr(row.contentType, 'Content'),
      format: format === 'carousel' || format === 'reel' || format === 'image' ? format : 'image',
      accounts: asNum(row.accounts),
      posts: asNum(row.posts),
      medianTime: asStr(row.medianTime, '10:00'),
    }
  })

  return {
    summary: {
      accountsAnalyzed: asNum(summaryRaw.accountsAnalyzed, meta.accountsAnalyzed),
      accountTarget: {
        min: asNum(target.min, 20),
        max: asNum(target.max, 30),
      },
      postsAnalyzed: asNum(summaryRaw.postsAnalyzed, meta.postsAnalyzed),
      recommendationReady: findings.filter((f) => f.evidenceStrength === 'strong').length,
      emergingPatterns: movements.filter((m) => m.state === 'emerging' || m.state === 'strengthening').length,
      medianPostsPerWeek: asNum(summaryRaw.medianPostsPerWeek),
      medianEngagementRate: asNum(summaryRaw.medianEngagementRate),
      series: [[], [], [], []],
    },
    findings,
    movements,
    hooks,
    topics,
    trendTopics: [],
    hashtags,
    hashtagBasis: {
      highPerformers: asNum(basisRaw.highPerformers, Math.max(1, Math.round(meta.accountsAnalyzed * 0.3))),
      comparison: asNum(basisRaw.comparison, Math.max(1, meta.accountsAnalyzed)),
    },
    weeklyBasis: null,
    weekly,
    customerOverview: {
      medianChanges: [],
      adoption: [],
    },
    sampleLabel: `Last ${meta.windowDays} days · full register`,
  }
}

function batchPayload(batchIndex: number, accounts: CondensedAccount[]) {
  return {
    batchIndex,
    accountCount: accounts.length,
    accounts,
  }
}

function reducePayload(corpus: CorpusStats, batchMemos: unknown[], batchCount: number) {
  return {
    generatedAt: new Date().toISOString(),
    coverage: {
      method: corpus.method,
      matchedAccountCount: corpus.matchedAccountCount,
      accountsWithPosts: corpus.accountsWithPosts,
      totalPosts: corpus.totalPosts,
      mapBatches: batchCount,
      memoCount: batchMemos.length,
    },
    corpus,
    batchMemos,
  }
}

async function runMapBatches(batches: CondensedAccount[][]): Promise<unknown[]> {
  const template = loadPrompt(BATCH_MEMO_PROMPT_PATH)
  return mapPool(batches, MAP_CONCURRENCY, async (accounts, index) => {
    const prompt = template.replaceAll(
      '{{BATCH_JSON}}',
      JSON.stringify(batchPayload(index, accounts), null, 2),
    )
    const text = await callClaude(`map-batch-${index + 1}/${batches.length}`, prompt, MAP_MAX_TOKENS)
    const memo = extractJson(text)
    if (memo && typeof memo === 'object' && !Array.isArray(memo)) {
      return { ...(memo as Record<string, unknown>), batchIndex: index, accountCount: accounts.length }
    }
    return { batchIndex: index, accountCount: accounts.length, raw: memo }
  })
}

/** Preconditions the operator can fix (filters / scrape) — not server faults. */
export class AnalysisPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnalysisPreconditionError'
  }
}

export interface RunAnalysisInput {
  location?: string
  followerRangeLabel?: string
  period?: string
  windowDays?: number
}

export async function runRegisterAnalysis(input: RunAnalysisInput = {}): Promise<AnalysisResult> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const period = input.period ?? 'last-30'
  const windowDays = input.windowDays ?? periodToDays(period)
  const filterScope: AnalysisFilterScope = { location, followerRangeLabel, period, windowDays }

  // Local condense + stratify before opening a run row.
  const built = await buildAnalysisCorpus(windowDays, { location, followerRangeLabel })
  if (built.corpus.matchedAccountCount === 0) {
    throw new AnalysisPreconditionError(
      `No competitor accounts match ${location} · ${followerRangeLabel}. Adjust filters or add accounts.`,
    )
  }
  if (built.corpus.accountsWithPosts === 0 || built.corpus.totalPosts === 0) {
    throw new AnalysisPreconditionError(
      `${built.corpus.matchedAccountCount} account${built.corpus.matchedAccountCount === 1 ? '' : 's'} match ${location} · ${followerRangeLabel}, but none have posts in the last ${windowDays} days. Select those accounts on Accounts and run Scrape posts, then try again.`,
    )
  }

  const running = await CompetitorAnalysis.create({
    status: 'running',
    windowDays,
    filterScope,
    startedAt: new Date(),
  })

  try {
    const model = env.anthropic.model
    console.log(
      `[analysis] start run=${String(running._id)} model=${model} ` +
        `scope=${location}/${followerRangeLabel}/${period}(${windowDays}d) ` +
        `matched=${built.corpus.matchedAccountCount} withPosts=${built.corpus.accountsWithPosts} ` +
        `posts=${built.corpus.totalPosts} batches=${built.batches.length}`,
    )

    const batchMemos = await runMapBatches(built.batches)
    console.log(`[analysis] map complete memos=${batchMemos.length}`)

    const reduceBody = reducePayload(built.corpus, batchMemos, built.batches.length)
    const dashboardPrompt = loadPrompt(DASHBOARD_PROMPT_PATH)
      .replaceAll('{{WINDOW_DAYS}}', String(windowDays))
      .replace('{{PAYLOAD_JSON}}', JSON.stringify(reduceBody, null, 2))

    const dashboardText = await callClaude('reduce-dashboard', dashboardPrompt, REDUCE_MAX_TOKENS)
    const parsed = extractJson(dashboardText) as Record<string, unknown>
    console.log(
      `[analysis] dashboard keys=[${Object.keys(parsed).join(', ')}] ` +
        `findings=${Array.isArray(parsed.findings) ? parsed.findings.length : 0} ` +
        `movements=${Array.isArray(parsed.movements) ? parsed.movements.length : 0}`,
    )

    const finishedAt = new Date()
    const dashboard = normalizeDashboard(parsed, {
      accountsAnalyzed: built.corpus.accountsWithPosts,
      postsAnalyzed: built.corpus.totalPosts,
      windowDays,
      finishedAt,
    })
    // Prefer corpus medians when Claude omits or invents them.
    dashboard.summary.medianPostsPerWeek =
      asNum(dashboard.summary.medianPostsPerWeek, 0) || built.corpus.medianPostsPerWeek
    dashboard.summary.medianEngagementRate =
      asNum(dashboard.summary.medianEngagementRate, 0) || built.corpus.medianEngagementRate
    dashboard.summary.accountsAnalyzed = built.corpus.accountsWithPosts
    dashboard.summary.postsAnalyzed = built.corpus.totalPosts
    dashboard.sampleLabel =
      `${location} · ${followerRangeLabel} · last ${windowDays} days · ` +
      `${built.corpus.accountsWithPosts} accounts / ${built.corpus.totalPosts} posts · ` +
      `${built.batches.length} map batch${built.batches.length === 1 ? '' : 'es'}`

    running.status = 'completed'
    running.llmModel = model
    running.markdown = null
    running.dashboard = dashboard
    running.filterScope = filterScope
    running.accountsAnalyzed = built.corpus.accountsWithPosts
    running.postsAnalyzed = built.corpus.totalPosts
    running.finishedAt = finishedAt
    await running.save()

    console.log(
      `[analysis] completed ${String(running._id)} ` +
        `findings=${dashboard.findings.length} movements=${dashboard.movements.length}`,
    )
    return serialize(running)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    running.status = 'failed'
    running.error = message
    running.finishedAt = new Date()
    await running.save()
    console.error(`[analysis] failed ${String(running._id)}:`, message)
    if (err instanceof Error && err.stack) console.error(`[analysis] stack:`, err.stack)
    throw err
  }
}

export async function getLatestAnalysis(): Promise<AnalysisResult | null> {
  const [doc] = await CompetitorAnalysis.find({ status: { $in: ['completed', 'failed', 'running'] } })
    .sort({ startedAt: -1 })
    .limit(1)
  return doc ? serialize(doc) : null
}

/**
 * Return the newest completed analysis for this Overview filter scope, so
 * switching filters reloads a previously saved report instead of requiring a
 * re-run.
 */
export async function getAnalysisForScope(input: {
  location?: string
  followerRangeLabel?: string
  period?: string
}): Promise<AnalysisResult | null> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const period = input.period ?? 'last-30'
  const windowDays = periodToDays(period)

  const [scoped] = await CompetitorAnalysis.find({
    status: 'completed',
    'filterScope.location': location,
    'filterScope.followerRangeLabel': followerRangeLabel,
    'filterScope.period': period,
    dashboard: { $ne: null },
  })
    .sort({ finishedAt: -1, startedAt: -1 })
    .limit(1)

  if (scoped) return serialize(scoped)

  if (location === 'Global' && followerRangeLabel === 'All sizes') {
    const [legacy] = await CompetitorAnalysis.find({
      status: 'completed',
      dashboard: { $ne: null },
      $or: [{ filterScope: null }, { filterScope: { $exists: false } }],
      windowDays,
    })
      .sort({ finishedAt: -1, startedAt: -1 })
      .limit(1)
    if (legacy) return serialize(legacy)
  }

  return null
}

/** Newest failed run for a filter scope (used when POST /analysis/run errors). */
export async function getFailedAnalysisForScope(input: {
  location?: string
  followerRangeLabel?: string
  period?: string
}): Promise<AnalysisResult | null> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const period = input.period ?? 'last-30'

  const [failed] = await CompetitorAnalysis.find({
    status: 'failed',
    'filterScope.location': location,
    'filterScope.followerRangeLabel': followerRangeLabel,
    'filterScope.period': period,
  })
    .sort({ finishedAt: -1, startedAt: -1 })
    .limit(1)

  return failed ? serialize(failed) : null
}
