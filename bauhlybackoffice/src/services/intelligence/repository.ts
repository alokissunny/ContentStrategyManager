import { thresholds } from '../../config/thresholds'
import type { Finding, PatternMovement } from '../../types'
import type { EvidenceThresholdKey, FilterState } from './filters'
import {
  mockCustomerOverview,
  extraFindings,
  findingBands,
  mockFindings,
  mockHashtags,
  mockHooks,
  mockMovements,
  mockSummarySeries,
  mockTopics,
  mockTrendTopics,
  mockWeekly,
  type CustomerOverviewMock,
  type HashtagRow,
  type HookPerformanceRow,
  type TopicRow,
  type TrendTopicRow,
  type WeeklyDayObservation,
} from './mockData'

/*
 * Intelligence repository — the only module the dashboard UI talks to.
 * Phase 4 serves filtered mock data with a small artificial delay so
 * loading states are real; later phases swap the internals for real
 * analysis output without touching the UI.
 */

export interface DashboardSummary {
  accountsAnalyzed: number
  accountTarget: { min: number; max: number }
  postsAnalyzed: number
  recommendationReady: number
  emergingPatterns: number
  /** Median posts per week across the analysed competitor group. */
  medianPostsPerWeek: number
  /** Median public engagement rate across the group, in percent. */
  medianEngagementRate: number
  series: number[][]
}

export interface DashboardData {
  summary: DashboardSummary
  findings: Finding[]
  movements: PatternMovement[]
  hooks: HookPerformanceRow[]
  topics: TopicRow[]
  trendTopics: TrendTopicRow[]
  hashtags: HashtagRow[]
  /** Denominators for hashtag account counts. */
  hashtagBasis: { highPerformers: number; comparison: number }
  /** Basis for the weekly pattern when a pillar filter is active. */
  weeklyBasis: { pillar: string; accountsWithGap: number } | null
  weekly: WeeklyDayObservation[]
  customerOverview: CustomerOverviewMock
  /** Human-readable description of the active sample. */
  sampleLabel: string
}

/* How much narrower each non-default filter makes the mock sample. The point
 * is workflow honesty (filters visibly change every widget and can starve the
 * sample below thresholds), not real analysis — that arrives in Phase 8. */
function sampleScale(filters: FilterState): number {
  let scale = 1
  if (filters.location === 'Global') scale *= 1.6
  else if (filters.location !== 'Spain') scale *= 0.35
  if (filters.comparisonGroup === 'high-performing-comparable') scale *= 0.45
  else if (filters.comparisonGroup === 'average-performing-comparable') scale *= 0.55
  else if (filters.comparisonGroup === 'local') scale *= 0.3
  else if (filters.comparisonGroup === 'emerging') scale *= 0.25
  else if (filters.comparisonGroup === 'content-style') scale *= 0.35
  else if (filters.comparisonGroup === 'smaller' || filters.comparisonGroup === 'larger') scale *= 0.6
  else if (filters.comparisonGroup === 'all-approved') scale *= 2.2
  if (!['5K – 20K', '5K – 10K', '10K – 15K', '15K – 20K'].includes(filters.followerRangeLabel)) scale *= 0.4
  if (filters.period === 'last-90') scale *= 2.6
  else if (filters.period === 'last-180') scale *= 4.8
  else if (filters.period === 'last-365') scale *= 8.5
  return scale
}

/*
 * Deterministic per-filter variation. Real analysis over a different group,
 * location or window returns different numbers; uniform scaling would make
 * the dashboard look static and hide filter mistakes. Same filters always
 * produce the same values.
 */
function filterSeed(filters: FilterState): number {
  const key = [
    filters.location,
    filters.comparisonGroup,
    filters.followerRangeLabel,
    filters.pillar,
    filters.period,
  ].join('|')
  let hash = 2166136261
  for (const ch of key) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

/** Vary `base` by up to ±spread, deterministically per (seed, key). */
function vary(base: number, seed: number, key: string, spread: number): number {
  let hash = seed
  for (const ch of key) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const unit = ((hash % 2000) / 1000) - 1
  return Math.round((base + unit * spread) * 10) / 10
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * Keep the state label consistent with the change it is shown next to.
 * "Saturated" and "disappearing" are qualitative calls the original record
 * makes, so they survive; the rest follow the number.
 */
function deriveState(original: PatternMovement['state'], changePp: number | null): PatternMovement['state'] {
  if (original === 'saturated' || original === 'disappearing') return original
  if (changePp == null) return 'inconclusive'
  if (changePp >= thresholds.minChangePp) return original === 'emerging' ? 'emerging' : 'strengthening'
  if (changePp <= -thresholds.minChangePp) return 'weakening'
  return 'stable'
}

/**
 * 0 (smallest bracket) → 1 (largest). Larger accounts genuinely behave
 * differently: they publish more often, lean harder on Reels, and carry a
 * lower engagement rate. Those shifts are directional, not random.
 */
/** Which size band a follower range belongs to. */
function sizeBand(tier: number): 'small' | 'mid' | 'large' {
  if (tier <= 0.3) return 'small'
  if (tier >= 0.7) return 'large'
  return 'mid'
}

function followerTier(label: string): number {
  const order = [
    'Under 1K',
    '1K – 3K',
    '3K – 5K',
    '5K – 10K',
    '5K – 20K',
    '10K – 15K',
    '15K – 20K',
    '20K – 50K',
    'Over 50K',
  ]
  const i = order.indexOf(label)
  return i < 0 ? 0.5 : i / (order.length - 1)
}

function passesEvidenceThreshold(f: Finding, threshold: EvidenceThresholdKey): boolean {
  switch (threshold) {
    case 'all':
      return true
    case 'recommendation-ready':
      return f.recommendationReady
    case 'strong':
      return f.evidenceStrength === 'strong'
    case 'moderate':
      return f.evidenceStrength === 'strong' || f.evidenceStrength === 'moderate'
    case 'exploratory':
      return f.evidenceStrength === 'exploratory'
    case 'human-reviewed':
      return f.humanReviewed
  }
}

/* Content competitors publish for each pillar, used when the dashboard is
 * filtered to one pillar. */
const PILLAR_CONTENT: Record<'discovery' | 'credibility' | 'trust', { contentType: string; format: WeeklyDayObservation['format'] }[]> = {
  discovery: [
    { contentType: 'Transformation', format: 'reel' },
    { contentType: 'Before & after', format: 'carousel' },
    { contentType: 'Strong-hook opener', format: 'reel' },
  ],
  credibility: [
    { contentType: 'Design decision', format: 'carousel' },
    { contentType: 'Educational', format: 'carousel' },
    { contentType: 'Process walkthrough', format: 'reel' },
  ],
  trust: [
    { contentType: 'Client story', format: 'image' },
    { contentType: 'Project context', format: 'carousel' },
    { contentType: 'Founder / team', format: 'reel' },
  ],
}

const PILLAR_TITLES = { discovery: 'Discovery', credibility: 'Credibility', trust: 'Trust' } as const

/**
 * Observed weekly behavior.
 *
 * With no pillar filter this is the dominant pillar per day across the group.
 * Filtered to a pillar, it answers a sharper question: what did the week look
 * like for comparable accounts that *had that same gap* and went on to
 * outperform? Those accounts never posted one pillar all week — they leaned
 * into the gap on their strongest days and kept the rest varied, which is what
 * this returns.
 */
function buildWeekly(
  filters: FilterState,
  seed: number,
  scale: number,
  accounts: number,
): WeeklyDayObservation[] {
  const base = mockWeekly.map((d) => ({
    ...d,
    accounts: Math.max(1, Math.min(accounts, Math.round(vary(d.accounts, seed, `wk-${d.day}`, 3)))),
    posts: Math.max(1, Math.round(vary(d.posts, seed, `wkPosts-${d.day}`, 40) * scale)),
  }))

  if (filters.pillar === 'all') return base

  const pillar = filters.pillar as 'discovery' | 'credibility' | 'trust'
  const content = PILLAR_CONTENT[pillar]

  // Busiest days first — that is where these accounts placed the gap content.
  const ranked = [...base].sort((a, b) => b.posts - a.posts)
  const focusDays = new Set(ranked.slice(0, 3).map((d) => d.day))

  let focusIndex = 0
  return ranked.map((d) => {
    if (!focusDays.has(d.day)) return d
    const pick = content[focusIndex % content.length]
    focusIndex += 1
    return { ...d, pillar, pillarLabel: PILLAR_TITLES[pillar], ...pick }
  })
}

export function computeDashboard(filters: FilterState): DashboardData {
  const scale = sampleScale(filters)
  const seed = filterSeed(filters)
  const tier = followerTier(filters.followerRangeLabel)
  /** −1 for the smallest bracket, +1 for the largest. */
  const tierShift = (tier - 0.5) * 2
  const accounts = Math.max(0, Math.round(27 * scale))
  const posts = Math.max(0, Math.round(1842 * scale))
  const sampleTooSmall =
    accounts < thresholds.minAccountsForPattern || posts < thresholds.minPostsForPattern

  const scaledSample = (base: Finding['sample']): Finding['sample'] => ({
    ...base,
    accountsAnalyzed: accounts,
    postsAnalyzed: posts,
    locations:
      filters.location === 'Global'
        ? [{ country: null, region: null, city: null }]
        : [{ country: filters.location, region: null, city: null }],
  })

  const band = sizeBand(tier)
  let findings = sampleTooSmall
    ? []
    : [...mockFindings, ...extraFindings]
        .filter((f) => (findingBands[f.id] ?? ['small', 'mid', 'large']).includes(band))
        .filter((f) => passesEvidenceThreshold(f, filters.evidenceThreshold))
        .filter((f) => filters.pillar === 'all' || f.authorityPillar === filters.pillar)
        .map((f) => {
          const focus =
            f.focusValue != null
              ? clamp(vary(f.focusValue, seed, `focus-${f.id}`, f.valueUnit === 'per-week' ? 0.9 : 5), 0, 100)
              : null
          const comparison =
            f.comparisonValue != null
              ? clamp(
                  vary(f.comparisonValue, seed, `cmp-${f.id}`, f.valueUnit === 'per-week' ? 0.5 : 3),
                  0,
                  focus ?? 100,
                )
              : null
          const perWeek = f.valueUnit === 'per-week'
          return {
            ...f,
            focusValue:
              focus != null && perWeek ? Math.round((focus + tierShift * 1.4) * 10) / 10 : focus,
            comparisonValue:
              comparison != null && perWeek
                ? Math.round((comparison + tierShift * 0.9) * 10) / 10
                : comparison,
            sample: scaledSample(f.sample),
          }
        })

  // A thin sample downgrades what can honestly be called recommendation-ready.
  if (accounts < thresholds.comparisonGroupTarget.min) {
    findings = findings.map((f) =>
      f.recommendationReady
        ? {
            ...f,
            recommendationReady: false,
            recommendationReadyReasons: [
              `Sample of ${accounts} accounts is below the ${thresholds.comparisonGroupTarget.min}-account target`,
            ],
          }
        : f,
    )
    if (filters.evidenceThreshold === 'recommendation-ready') findings = []
  }

  // One topic dataset. Every surface that reports a topic share reads this.
  const topicRows = sampleTooSmall
    ? []
    : mockTopics
        .map((t) => ({
          ...t,
          sharePct: clamp(vary(t.sharePct, seed, `topic-${t.topic}`, 9), 1, 100),
          changePp: vary(t.changePp, seed, `topicCh-${t.topic}`, 3),
          accounts: Math.max(1, Math.min(accounts, Math.round(vary(t.accounts, seed, `topicAcc-${t.topic}`, 3)))),
          posts: Math.max(1, Math.round(vary(t.posts, seed, `topicPosts-${t.topic}`, 40) * scale)),
        }))
        .sort((a, b) => b.sharePct - a.sharePct)

  const topicByLabel = new Map(topicRows.map((t) => [t.topic, t]))

  const movements = sampleTooSmall
    ? []
    : mockMovements.map((m) => {
        // A movement whose pattern is a topic must report that topic's number.
        const asTopic = topicByLabel.get(m.pattern)
        if (asTopic) {
          const current = Math.round(asTopic.sharePct * 10) / 10
          const changePp = Math.round(asTopic.changePp * 10) / 10
          const previous = Math.round((current - changePp) * 10) / 10
          return {
            ...m,
            previousValue: previous,
            currentValue: current,
            changePp,
            state: deriveState(m.state, changePp),
            sample: scaledSample(m.sample),
          }
        }
        const previous =
          m.previousValue != null ? clamp(vary(m.previousValue, seed, `prev-${m.id}`, 4), 0, 100) : null
        const directional =
          m.pattern.includes('Reels') || m.pattern.includes('Carousels')
            ? tierShift * 5
            : m.pattern.includes('Single Image') || m.pattern.includes('Lifestyle')
              ? -tierShift * 4
              : 0
        const current =
          m.currentValue != null
            ? clamp(vary(m.currentValue, seed, `curr-${m.id}`, 4) + directional, 0, 100)
            : null
        const changePp =
          previous != null && current != null ? Math.round((current - previous) * 10) / 10 : null
        return {
          ...m,
          previousValue: previous,
          currentValue: current,
          changePp,
          state: deriveState(m.state, changePp),
          sample: scaledSample(m.sample),
        }
      })

  const hooks = sampleTooSmall
    ? []
    : mockHooks
        .filter((h) => filters.pillar === 'all' || h.pillar === filters.pillar)
        .map((h) => ({
          ...h,
          useRate: Math.round(clamp(vary(h.useRate, seed, `hook-${h.hookType}`, 4), 1, 100) * 10) / 10,
          medianEngagement:
            Math.round(
              clamp(
                vary(h.medianEngagement, seed, `hookEr-${h.hookType}`, 0.6) - tierShift * 0.8,
                0.2,
                20,
              ) * 10,
            ) / 10,
        }))
        .sort((a, b) => b.useRate - a.useRate)

  const emerging = movements.filter((m) => m.state === 'emerging').length

  return {
    summary: {
      accountsAnalyzed: accounts,
      accountTarget: thresholds.comparisonGroupTarget,
      postsAnalyzed: posts,
      recommendationReady: findings.filter((f) => f.recommendationReady).length,
      emergingPatterns: emerging,
      // Group benchmarks: how often comparable accounts publish, and the
      // engagement rate that output earns.
      medianPostsPerWeek:
        Math.round(clamp(vary(3.2 + tierShift * 1.1, seed, 'ppw', 0.5), 0.5, 14) * 10) / 10,
      medianEngagementRate:
        Math.round(clamp(vary(2.4 - tierShift * 0.7, seed, 'er', 0.4), 0.2, 12) * 10) / 10,
      series: mockSummarySeries,
    },
    findings,
    movements,
    hooks,
    hashtags: sampleTooSmall
      ? []
      : mockHashtags
          .map((h) => ({
            ...h,
            highPerformerAccounts: Math.max(
              1,
              Math.round(vary(h.highPerformerAccounts, seed, `tagHp-${h.tag}`, 1.5)),
            ),
            comparisonAccounts: Math.max(
              0,
              Math.round(vary(h.comparisonAccounts, seed, `tagCmp-${h.tag}`, 1.5)),
            ),
          }))
          // Ranked by distinctiveness: how much more high performers use it.
          .sort(
            (a, b) =>
              b.highPerformerAccounts - b.comparisonAccounts -
              (a.highPerformerAccounts - a.comparisonAccounts),
          ),
    trendTopics: sampleTooSmall
      ? []
      : mockTrendTopics
          .map((t) => ({
            ...t,
            sharePct: clamp(vary(t.sharePct, seed, `trend-${t.topic}`, 6), 1, 100),
            changePp: vary(t.changePp, seed, `trendCh-${t.topic}`, 3),
          }))
          .sort((a, b) => b.sharePct - a.sharePct),
    topics: topicRows,
    weekly: sampleTooSmall ? [] : buildWeekly(filters, seed, scale, accounts),
    hashtagBasis: {
      highPerformers: Math.max(1, Math.round(accounts * 0.25)),
      comparison: Math.max(1, accounts - Math.round(accounts * 0.25)),
    },
    weeklyBasis:
      filters.pillar === 'all' || sampleTooSmall
        ? null
        : {
            pillar: PILLAR_TITLES[filters.pillar as 'discovery' | 'credibility' | 'trust'],
            accountsWithGap: Math.max(3, Math.round(accounts * 0.45)),
          },
    customerOverview: {
      medianChanges: mockCustomerOverview.medianChanges.map((m) => ({
        ...m,
        value: clamp(vary(m.value, seed, `cust-${m.label}`, 2.5), -25, 60),
      })),
      adoption: mockCustomerOverview.adoption.map((a) => ({
        ...a,
        value: Math.round(clamp(vary(a.value, seed, `adopt-${a.label}`, 5), 0, 100)),
      })),
    },
    sampleLabel: `${filters.location} · ${filters.followerRangeLabel} · ${
      filters.comparisonGroup === 'all-approved' ? 'All approved' : 'Comparable'
    } · ${accounts} accounts · ${posts.toLocaleString('en-US')} posts`,
  }
}

export function computeDashboardForMock(filters: FilterState): DashboardData {
  return computeDashboard(filters)
}

export async function getDashboard(filters: FilterState): Promise<DashboardData> {
  const { USE_MOCKS } = await import('../api')
  if (!USE_MOCKS) {
    const { getLatestAnalysis } = await import('../competitors/repository')
    // Load the report saved for this exact filter scope (location / followers / period).
    const analysis = await getLatestAnalysis({
      location: filters.location,
      followerRangeLabel: filters.followerRangeLabel,
      period: filters.period,
    })
    if (analysis?.status === 'completed' && analysis.dashboard && typeof analysis.dashboard === 'object') {
      return sanitizeLiveDashboard(filterLiveDashboard(analysis.dashboard as DashboardData, filters))
    }
    return emptyDashboard(filters)
  }
  // Mock mode: prefer a previously "run" analysis for this scope, else seeded compute.
  const { getLatestAnalysis } = await import('../competitors/repository')
  const saved = await getLatestAnalysis({
    location: filters.location,
    followerRangeLabel: filters.followerRangeLabel,
    period: filters.period,
  })
  if (saved?.status === 'completed' && saved.dashboard && typeof saved.dashboard === 'object') {
    return sanitizeLiveDashboard(filterLiveDashboard(saved.dashboard as DashboardData, filters))
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
  return computeDashboard(filters)
}

/**
 * Strip fields we do not yet compute from real observations so the Overview
 * never paints placeholder sparklines / search-demand / customer mocks.
 */
function sanitizeLiveDashboard(data: DashboardData): DashboardData {
  return {
    ...data,
    summary: {
      ...data.summary,
      series: [[], [], [], []],
    },
    trendTopics: [],
    customerOverview: { medianChanges: [], adoption: [] },
    findings: data.findings ?? [],
    movements: data.movements ?? [],
    hooks: data.hooks ?? [],
    topics: data.topics ?? [],
    hashtags: data.hashtags ?? [],
    weekly: data.weekly ?? [],
  }
}

function emptyDashboard(filters: FilterState): DashboardData {
  const scopeLabel = `${filters.location} · ${filters.followerRangeLabel} · ${filters.period}`
  return {
    summary: {
      accountsAnalyzed: 0,
      accountTarget: { min: 20, max: 30 },
      postsAnalyzed: 0,
      recommendationReady: 0,
      emergingPatterns: 0,
      medianPostsPerWeek: 0,
      medianEngagementRate: 0,
      series: [[], [], [], []],
    },
    findings: [],
    movements: [],
    hooks: [],
    topics: [],
    trendTopics: [],
    hashtags: [],
    hashtagBasis: { highPerformers: 0, comparison: 0 },
    weeklyBasis: null,
    weekly: [],
    customerOverview: { medianChanges: [], adoption: [] },
    sampleLabel: `No saved analysis for ${scopeLabel}. Run analysis to create one.`,
  }
}

/** Client-side filter of a stored Claude dashboard (pillar + evidence). */
function filterLiveDashboard(data: DashboardData, filters: FilterState): DashboardData {
  const pillar = filters.pillar
  const findings = (data.findings ?? []).filter((f) => {
    if (!passesEvidenceThreshold(f, filters.evidenceThreshold)) return false
    if (pillar === 'all') return true
    return f.authorityPillar === pillar
  })
  const hooks =
    pillar === 'all' ? (data.hooks ?? []) : (data.hooks ?? []).filter((h) => h.pillar === pillar)
  const topics =
    pillar === 'all' ? (data.topics ?? []) : (data.topics ?? []).filter((t) => t.pillar === pillar)
  const weekly =
    pillar === 'all' ? (data.weekly ?? []) : (data.weekly ?? []).filter((w) => w.pillar === pillar)

  const PILLAR_TITLES = { discovery: 'Discovery', credibility: 'Credibility', trust: 'Trust' } as const

  return {
    ...data,
    findings,
    movements: data.movements ?? [],
    hooks,
    topics,
    trendTopics: data.trendTopics ?? [],
    hashtags: data.hashtags ?? [],
    weekly,
    weeklyBasis:
      pillar === 'all' || weekly.length === 0
        ? null
        : {
            pillar: PILLAR_TITLES[pillar as 'discovery' | 'credibility' | 'trust'] ?? String(pillar),
            accountsWithGap: Math.max(1, Math.round((data.summary?.accountsAnalyzed ?? 0) * 0.45)),
          },
    sampleLabel: `${filters.location} · ${filters.followerRangeLabel} · ${filters.period} · ${
      data.summary?.accountsAnalyzed ?? 0
    } accounts`,
  }
}

