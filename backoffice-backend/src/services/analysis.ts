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
import {
  aggregateHookMetrics,
  applyComputedHookMetrics,
  buildEngagementRateLookup,
  countExemplars,
  type ComputedHookMetric,
} from './hookMetrics.ts'
import { periodToDays, type AnalysisFilterScope } from './filterScope.ts'

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../prompts')
const DASHBOARD_PROMPT_PATH = join(PROMPT_DIR, 'register-analysis-prompt.md')
const BATCH_MEMO_PROMPT_PATH = join(PROMPT_DIR, 'register-batch-memo-prompt.md')

/** Parallel Claude map calls — keep modest to avoid rate limits. */
const MAP_CONCURRENCY = 3
// The map memo now also carries caption patterns; give it headroom so the JSON
// isn't cut off mid-array at max_tokens (a truncated memo is unparseable).
const MAP_MAX_TOKENS = 8192
const REDUCE_MAX_TOKENS = 16384

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
          businessCategory: scope.businessCategory ?? 'interior-designer',
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

/** Open `}`/`]` closers still pending at the end of `s`, respecting strings. */
function openClosers(s: string): string[] {
  let inStr = false
  let esc = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') stack.pop()
  }
  return stack
}

/**
 * Best-effort recovery of JSON truncated mid-output (Claude hit max_tokens):
 * cut back to the last completed element and close any still-open strings,
 * arrays and objects. Returns null when it cannot be salvaged.
 */
function repairTruncatedJson(text: string): unknown | null {
  let inStr = false
  let esc = false
  let lastSafe = -1
  // A safe cut point is only right after a closed container (`}`/`]`) or just
  // before a separator (`,`) — both guarantee the preceding value is complete.
  // A closing quote is NOT safe: it may be an object key with no value yet.
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '}' || c === ']') lastSafe = i + 1
    else if (c === ',') lastSafe = i
  }
  if (lastSafe <= 0) return null
  const prefix = text.slice(0, lastSafe).replace(/[\s,]+$/, '')
  const closers = openClosers(prefix)
  try {
    return JSON.parse(closers.length ? prefix + closers.reverse().join('') : prefix)
  } catch {
    return null
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* fall through */
    }
  }
  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart >= 0 && (objStart < 0 || arrStart < objStart) && arrEnd > arrStart) {
    try {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1))
    } catch {
      /* fall through */
    }
  }
  if (objStart >= 0 && objEnd > objStart) {
    try {
      return JSON.parse(trimmed.slice(objStart, objEnd + 1))
    } catch {
      /* fall through */
    }
  }
  // Likely truncated at max_tokens — salvage the largest valid prefix.
  const start =
    objStart >= 0 && (arrStart < 0 || objStart < arrStart) ? objStart : arrStart
  if (start >= 0) {
    const repaired = repairTruncatedJson(trimmed.slice(start))
    if (repaired !== null) return repaired
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

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/* ── Caption Pattern Analysis (the new Overview headline) ───────────────────
 *
 * Claude supplies only the qualitative caption *patterns*. Everything countable
 * — formats, days, peak times, the KPI row — is computed here from the corpus
 * and condensed accounts, so the numbers stay grounded in observed public data.
 * All language is frequency-only: prevalence and change, never performance.
 */

const FORMAT_LABELS: Record<string, string> = {
  reel: 'Reel',
  carousel: 'Carousel',
  image: 'Single image',
  video: 'Video',
  sidecar: 'Multi-image post',
  'multi-image': 'Multi-image post',
}

function formatLabel(f: string): string {
  return FORMAT_LABELS[f] ?? (f ? f[0]!.toUpperCase() + f.slice(1) : 'Other')
}

/** Comparison windows shown with every trend, mirroring the frontend model. */
const CAPTION_WINDOWS: Record<string, { previous: string; current: string }> = {
  'last-30': { previous: '31–60 days ago', current: 'Last 30 days' },
  'previous-30': { previous: '61–90 days ago', current: '31–60 days ago' },
  'last-90': { previous: 'Prior 90 days', current: 'Last 90 days' },
  'last-180': { previous: 'Prior 6 months', current: 'Last 6 months' },
  'last-365': { previous: 'Prior 12 months', current: 'Last 12 months' },
  'month-over-month': { previous: 'Previous month', current: 'This month' },
}

function captionWindows(period: string | undefined, windowDays: number) {
  if (period && CAPTION_WINDOWS[period]) return CAPTION_WINDOWS[period]!
  return { previous: `Prior ${windowDays} days`, current: `Last ${windowDays} days` }
}

/** A trend needs a real prior window and enough captions, else it's inconclusive. */
const MIN_CAPTIONS_FOR_TREND = 40

type CaptionTrendState = 'increasing' | 'decreasing' | 'stable' | 'inconclusive'

function captionTrendState(changePp: number | null, captions: number): CaptionTrendState {
  if (changePp == null || captions < MIN_CAPTIONS_FOR_TREND) return 'inconclusive'
  if (Math.abs(changePp) < 1) return 'stable'
  return changePp > 0 ? 'increasing' : 'decreasing'
}

function captionTrend(
  sharePct: number,
  changePp: number | null,
  captions: number,
  windows: { previous: string; current: string },
) {
  const state = captionTrendState(changePp, captions)
  if (state === 'inconclusive') {
    return {
      previousPct: null,
      currentPct: null,
      changePp: null,
      state,
      previousWindow: windows.previous,
      currentWindow: windows.current,
    }
  }
  const current = Math.round(sharePct * 10) / 10
  return {
    previousPct: Math.round((sharePct - (changePp as number)) * 10) / 10,
    currentPct: current,
    changePp,
    state,
    previousWindow: windows.previous,
    currentWindow: windows.current,
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'pattern'
  )
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Busiest 2-hour publishing window per weekday, from exemplar timestamps (UTC). */
function computePeakTimes(accounts: CondensedAccount[]): Map<string, string> {
  const byDay = new Map<string, Map<number, number>>()
  for (const a of accounts) {
    for (const e of a.exemplars) {
      if (!e.publishedAt) continue
      const d = new Date(e.publishedAt)
      if (Number.isNaN(d.getTime())) continue
      const day = WEEKDAY_NAMES[d.getUTCDay()]!
      const bucket = Math.floor(d.getUTCHours() / 2) * 2
      let m = byDay.get(day)
      if (!m) {
        m = new Map()
        byDay.set(day, m)
      }
      m.set(bucket, (m.get(bucket) ?? 0) + 1)
    }
  }
  const hh = (n: number) => `${String(n % 24).padStart(2, '0')}:00`
  const out = new Map<string, string>()
  for (const [day, m] of byDay) {
    let best = -1
    let bestCount = -1
    for (const [b, c] of m) {
      if (c > bestCount) {
        bestCount = c
        best = b
      }
    }
    if (best >= 0) out.set(day, `${hh(best)}–${hh(best + 2)}`)
  }
  return out
}

/** Rank rows (formats / days) sorted by share and numbered from 1. */
function rankBySharePct<T extends { sharePct: number }>(rows: T[]): (T & { rank: number })[] {
  return [...rows].sort((a, b) => b.sharePct - a.sharePct).map((r, i) => ({ ...r, rank: i + 1 }))
}

/** Up to this many real captions are surfaced per pattern (a sample, not all). */
const MAX_PATTERN_CAPTIONS = 12

function buildCaptionAnalysis(
  rawCaption: Record<string, unknown> | null,
  corpus: CorpusStats,
  accounts: CondensedAccount[],
  windowDays: number,
  period: string | undefined,
  batchMemos: unknown[],
) {
  const windows = captionWindows(period, windowDays)
  const totalPosts = corpus.totalPosts
  const accountsWithPosts = corpus.accountsWithPosts

  // Exemplar caption lookup + display names, so pattern examples resolve to a
  // real caption rather than an invented one.
  const captionByPostId = new Map<string, { competitor: string; caption: string }>()
  const displayName = new Map<string, string>()
  for (const a of accounts) {
    const name = a.displayName ?? a.username
    displayName.set(a.username, name)
    for (const e of a.exemplars) {
      if (e.platformPostId && e.caption) {
        captionByPostId.set(e.platformPostId, { competitor: name, caption: e.caption })
      }
    }
  }

  // Post ids the map step tagged for each caption pattern (by pattern name), so
  // the "view all matching captions" page shows real captions, never invented.
  const normName = (s: string) => s.trim().toLowerCase()
  const postIdsByPattern = new Map<string, string[]>()
  for (const memo of batchMemos) {
    const cps = (memo as Record<string, unknown> | null)?.captionPatterns
    if (!Array.isArray(cps)) continue
    for (const cp of cps) {
      const row = (cp ?? {}) as Record<string, unknown>
      const key = normName(asStr(row.name))
      if (!key) continue
      const ids = postIdsByPattern.get(key) ?? []
      if (asStr(row.examplePlatformPostId)) ids.push(asStr(row.examplePlatformPostId))
      if (Array.isArray(row.posts)) {
        for (const pid of row.posts) {
          const id = asStr(pid)
          if (id) ids.push(id)
        }
      }
      postIdsByPattern.set(key, ids)
    }
  }

  /** Real matching captions for a pattern, resolved from tagged post ids. */
  const captionsForPattern = (
    patternName: string,
    seed: { competitor: string; caption: string } | null,
  ): { competitor: string; caption: string }[] => {
    const out: { competitor: string; caption: string }[] = []
    const seenCaption = new Set<string>()
    const push = (c: { competitor: string; caption: string } | null | undefined) => {
      if (!c || !c.caption || seenCaption.has(c.caption)) return
      seenCaption.add(c.caption)
      out.push(c)
    }
    push(seed)
    for (const id of postIdsByPattern.get(normName(patternName)) ?? []) {
      if (out.length >= MAX_PATTERN_CAPTIONS) break
      push(captionByPostId.get(id))
    }
    return out.slice(0, MAX_PATTERN_CAPTIONS)
  }

  // Formats — competitor counts from per-account format mix; volume from corpus.
  const formatAccounts = new Map<string, number>()
  const dayAccounts = new Map<string, number>()
  for (const a of accounts) {
    for (const fm of a.window.formatMix) {
      if (fm.sharePct > 0) formatAccounts.set(fm.format, (formatAccounts.get(fm.format) ?? 0) + 1)
    }
    for (const d of a.window.postingDays) {
      if (d.count > 0) dayAccounts.set(d.day, (dayAccounts.get(d.day) ?? 0) + 1)
    }
  }

  const formats = rankBySharePct(
    corpus.formatMix.map((f, i) => {
      const t = captionTrend(f.sharePct, null, f.posts, windows)
      return {
        id: slug(f.format) || `format-${i + 1}`,
        label: formatLabel(f.format),
        competitors: formatAccounts.get(f.format) ?? 0,
        posts: f.posts,
        sharePct: Math.round(f.sharePct * 10) / 10,
        previousPct: t.previousPct,
        currentPct: t.currentPct,
        changePp: t.changePp,
        state: t.state,
      }
    }),
  )

  // Days — competitor counts from per-account posting days; peak time from a
  // Claude hint when present, else the busiest exemplar window.
  const peakHintByDay = new Map<string, string>()
  const hints = Array.isArray(rawCaption?.dayPeakTimes)
    ? (rawCaption!.dayPeakTimes as unknown[])
    : []
  for (const h of hints) {
    const row = (h ?? {}) as Record<string, unknown>
    const day = asStr(row.day)
    const pt = asStr(row.peakTime)
    if (day && pt) peakHintByDay.set(day, pt)
  }
  const computedPeak = computePeakTimes(accounts)
  const days = rankBySharePct(
    corpus.postingDays.map((d, i) => {
      const t = captionTrend(d.sharePct, null, d.posts, windows)
      return {
        id: slug(d.day) || `day-${i + 1}`,
        label: d.day,
        peakTime: peakHintByDay.get(d.day) ?? computedPeak.get(d.day),
        competitors: dayAccounts.get(d.day) ?? 0,
        posts: d.posts,
        sharePct: Math.round(d.sharePct * 10) / 10,
        previousPct: t.previousPct,
        currentPct: t.currentPct,
        changePp: t.changePp,
        state: t.state,
      }
    }),
  )

  // Patterns — validated from Claude; counts grounded in corpus totals.
  const rawPatterns = Array.isArray(rawCaption?.patterns) ? (rawCaption!.patterns as unknown[]) : []
  const patterns = rawPatterns
    .map((p) => {
      const row = (p ?? {}) as Record<string, unknown>
      const name = asStr(row.name, 'Caption pattern')
      const pillar = pillarOf(row.pillar) ?? 'discovery'
      const sharePct = Math.round(clampNum(asNum(row.sharePct), 0, 100) * 10) / 10
      const captions =
        row.captions != null
          ? Math.max(0, Math.round(asNum(row.captions)))
          : Math.max(0, Math.round((sharePct / 100) * totalPosts))
      const competitors =
        row.competitors != null
          ? Math.max(0, Math.round(asNum(row.competitors)))
          : Math.max(1, Math.min(accountsWithPosts, Math.round((sharePct / 100) * accountsWithPosts)))
      const changePp = row.changePp == null ? null : asNum(row.changePp)
      const structure = (Array.isArray(row.structure) ? row.structure : [])
        .map((s) => {
          const sr = (s ?? {}) as Record<string, unknown>
          return { step: asStr(sr.step, 'Step'), detail: asStr(sr.detail) }
        })
        .filter((s) => s.step)

      // Resolve a real example caption: by post id, then an inline example, then
      // any exemplar from the named account. Null when none is available.
      let example: { competitor: string; caption: string } | null = null
      const byId = asStr(row.examplePlatformPostId)
      if (byId && captionByPostId.has(byId)) {
        example = captionByPostId.get(byId)!
      } else if (row.example && typeof row.example === 'object') {
        const ex = row.example as Record<string, unknown>
        const cap = asStr(ex.caption)
        const comp = asStr(ex.competitor)
        if (cap && comp) example = { competitor: comp, caption: cap }
      }
      if (!example) {
        const user = asStr(row.exampleUsername)
        const acc = user ? accounts.find((a) => a.username === user) : undefined
        const e = acc?.exemplars.find((ex) => ex.caption)
        if (acc && e) example = { competitor: displayName.get(acc.username) ?? acc.username, caption: e.caption }
      }

      // Real matching captions surfaced by the map step (a sample, deduped).
      const exampleCaptions = captionsForPattern(name, example)
      // Lead the single example with a real caption when we have one.
      if (!example && exampleCaptions.length > 0) example = exampleCaptions[0]!

      return {
        id: asStr(row.id) || slug(name),
        name,
        summary: asStr(row.summary),
        pillar,
        competitors,
        captions,
        sharePct,
        trend: captionTrend(sharePct, changePp, captions, windows),
        whatWeDetected: asStr(row.whatWeDetected),
        whyItMatters: asStr(row.whyItMatters),
        structure,
        pillarReason: asStr(row.pillarReason),
        example,
        exampleCaptions,
      }
    })
    .filter((p) => p.name)
    .sort((a, b) => b.sharePct - a.sharePct || b.captions - a.captions)
    .map((p, i) => ({ ...p, rank: i + 1 }))

  return {
    kpis: {
      competitors: accountsWithPosts,
      captions: totalPosts,
      patternsDetected: patterns.length,
    },
    windows,
    patterns,
    formats,
    days,
    // Reserved: the UI's "Days & Times" tab reads `days`; `times` stays empty.
    times: [] as unknown[],
  }
}

/**
 * Hydrate Claude's compact JSON into the Overview dashboard shape the UI expects.
 */
function normalizeDashboard(
  raw: Record<string, unknown>,
  meta: {
    accountsAnalyzed: number
    postsAnalyzed: number
    windowDays: number
    finishedAt: Date
    period?: string
    corpus: CorpusStats
    accounts: CondensedAccount[]
    batchMemos: unknown[]
  },
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
      trend: (trend === 'up' || trend === 'down' || trend === 'flat' ? trend : 'flat') as
        | 'up'
        | 'down'
        | 'flat',
      pillar: (pillarOf(row.pillar) ?? 'discovery') as 'discovery' | 'credibility' | 'trust',
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
      // Pillar whose top performers lean on the tag hardest vs the comparison
      // group — a distinctiveness marker, not a causal claim.
      pillar: pillarOf(row.pillar) ?? 'discovery',
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
    captionAnalysis: buildCaptionAnalysis(
      (raw.captionAnalysis ?? null) as Record<string, unknown> | null,
      meta.corpus,
      meta.accounts,
      meta.windowDays,
      meta.period,
      meta.batchMemos,
    ),
    sampleLabel: `Last ${meta.windowDays} days · full register`,
  }
}

function batchPayload(batchIndex: number, accounts: CondensedAccount[]) {
  const exemplarIndex = accounts.flatMap((a) =>
    a.exemplars.map((e) => ({
      username: a.username,
      platformPostId: e.platformPostId,
      engagementRate: e.engagementRate,
      caption: e.caption,
      format: e.format,
    })),
  )
  return {
    batchIndex,
    accountCount: accounts.length,
    exemplarCount: exemplarIndex.length,
    /**
     * Flat list of exemplars with precomputed ER — classify hooks from these
     * and copy engagementRate into hook.posts.
     */
    exemplarIndex,
    accounts,
  }
}

function reducePayload(
  corpus: CorpusStats,
  batchMemos: unknown[],
  batchCount: number,
  hookMetrics: ComputedHookMetric[],
) {
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
    /**
     * Authoritative hook rates. Median ER is pooled across all classified
     * posts for the hook: (likes + comments) / followers × 100.
     */
    hookMetrics,
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
    let memo: unknown
    try {
      memo = extractJson(text)
    } catch (err) {
      // A single unparseable batch must not sink the whole run — degrade it and
      // let the reduce step work from the batches that did parse.
      console.warn(
        `[analysis:map-batch-${index + 1}/${batches.length}] unparseable memo ` +
          `(${err instanceof Error ? err.message : String(err)}); using a degraded memo`,
      )
      return { batchIndex: index, accountCount: accounts.length, degraded: true }
    }
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
  businessCategory?: string
  period?: string
  windowDays?: number
}

export async function runRegisterAnalysis(input: RunAnalysisInput = {}): Promise<AnalysisResult> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const businessCategory = input.businessCategory ?? 'interior-designer'
  const period = input.period ?? 'last-30'
  const windowDays = input.windowDays ?? periodToDays(period)
  const filterScope: AnalysisFilterScope = {
    location,
    followerRangeLabel,
    businessCategory,
    period,
    windowDays,
  }

  // Local condense + stratify before opening a run row.
  const built = await buildAnalysisCorpus(windowDays, {
    location,
    followerRangeLabel,
    businessCategory,
  })
  if (built.corpus.matchedAccountCount === 0) {
    throw new AnalysisPreconditionError(
      `No competitor accounts match ${location} · ${followerRangeLabel} · ${businessCategory}. Adjust filters or add accounts.`,
    )
  }
  if (built.corpus.accountsWithPosts === 0 || built.corpus.totalPosts === 0) {
    throw new AnalysisPreconditionError(
      `${built.corpus.matchedAccountCount} account${built.corpus.matchedAccountCount === 1 ? '' : 's'} match ${location} · ${followerRangeLabel} · ${businessCategory}, but none have posts in the last ${windowDays} days. Select those accounts on Accounts and run Scrape posts, then try again.`,
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
        `scope=${location}/${followerRangeLabel}/${businessCategory}/${period}(${windowDays}d) ` +
        `matched=${built.corpus.matchedAccountCount} withPosts=${built.corpus.accountsWithPosts} ` +
        `posts=${built.corpus.totalPosts} batches=${built.batches.length}`,
    )

    const batchMemos = await runMapBatches(built.batches)
    console.log(`[analysis] map complete memos=${batchMemos.length}`)

    const erLookup = buildEngagementRateLookup(built.accounts)
    const totalExemplars = countExemplars(built.accounts)
    const hookMetrics = aggregateHookMetrics(batchMemos, erLookup, totalExemplars)
    console.log(
      `[analysis] hookMetrics=${hookMetrics.length} exemplars=${totalExemplars} ` +
        `top=${hookMetrics
          .slice(0, 3)
          .map((h) => `${h.hookType}:${h.useRate}%/${h.medianEngagement}%`)
          .join(', ') || 'none'}`,
    )

    const reduceBody = reducePayload(built.corpus, batchMemos, built.batches.length, hookMetrics)
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
      period,
      corpus: built.corpus,
      accounts: built.accounts,
      batchMemos,
    })
    // Prefer corpus medians when Claude omits or invents them.
    dashboard.summary.medianPostsPerWeek =
      asNum(dashboard.summary.medianPostsPerWeek, 0) || built.corpus.medianPostsPerWeek
    dashboard.summary.medianEngagementRate =
      asNum(dashboard.summary.medianEngagementRate, 0) || built.corpus.medianEngagementRate
    dashboard.summary.accountsAnalyzed = built.corpus.accountsWithPosts
    dashboard.summary.postsAnalyzed = built.corpus.totalPosts
    // Claude often returns useRate/medianEngagement as 0 — overwrite with
    // pooled post-level metrics from map classifications.
    dashboard.hooks = applyComputedHookMetrics(dashboard.hooks, hookMetrics)
    dashboard.sampleLabel =
      `${location} · ${followerRangeLabel} · ${businessCategory} · last ${windowDays} days · ` +
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
  businessCategory?: string
  period?: string
}): Promise<AnalysisResult | null> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const businessCategory = input.businessCategory ?? 'interior-designer'
  const period = input.period ?? 'last-30'
  const windowDays = periodToDays(period)

  const [scoped] = await CompetitorAnalysis.find({
    status: 'completed',
    'filterScope.location': location,
    'filterScope.followerRangeLabel': followerRangeLabel,
    'filterScope.businessCategory': businessCategory,
    'filterScope.period': period,
    dashboard: { $ne: null },
  })
    .sort({ finishedAt: -1, startedAt: -1 })
    .limit(1)

  if (scoped) return serialize(scoped)

  // Legacy rows without businessCategory: treat as Interior Designer.
  if (businessCategory === 'interior-designer') {
    const [legacyCat] = await CompetitorAnalysis.find({
      status: 'completed',
      'filterScope.location': location,
      'filterScope.followerRangeLabel': followerRangeLabel,
      'filterScope.period': period,
      dashboard: { $ne: null },
      $or: [
        { 'filterScope.businessCategory': { $exists: false } },
        { 'filterScope.businessCategory': null },
        { 'filterScope.businessCategory': 'All categories' },
      ],
    })
      .sort({ finishedAt: -1, startedAt: -1 })
      .limit(1)
    if (legacyCat) return serialize(legacyCat)
  }

  if (
    location === 'Global' &&
    followerRangeLabel === 'All sizes' &&
    businessCategory === 'interior-designer'
  ) {
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
  businessCategory?: string
  period?: string
}): Promise<AnalysisResult | null> {
  const location = input.location ?? 'Global'
  const followerRangeLabel = input.followerRangeLabel ?? 'All sizes'
  const businessCategory = input.businessCategory ?? 'interior-designer'
  const period = input.period ?? 'last-30'

  const [failed] = await CompetitorAnalysis.find({
    status: 'failed',
    'filterScope.location': location,
    'filterScope.followerRangeLabel': followerRangeLabel,
    'filterScope.businessCategory': businessCategory,
    'filterScope.period': period,
  })
    .sort({ finishedAt: -1, startedAt: -1 })
    .limit(1)

  return failed ? serialize(failed) : null
}
