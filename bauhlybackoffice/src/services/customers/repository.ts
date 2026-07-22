import { mockAdoption, mockCustomers, mockFunnel, type CustomerRow } from './mockData'
import { periodMeta, type ComparisonPeriod, type CustomRange } from '../period'

/* Customer repository — list with query + aggregate stats (mock phase). */

export interface CustomerQuery {
  search: string
  country: string
  status: string
  onboarding: 'all' | 'completed' | 'in-progress'
  followerRange: string
  /** Drives which pillar the weekly plan targets; 'all' picks the biggest gap. */
  pillar: 'all' | 'discovery' | 'credibility' | 'trust'
  lifecycle: 'all' | 'active' | 'onboarding' | 'at-risk' | 'paused' | 'churned'
  period: ComparisonPeriod
  customRange?: CustomRange
  sort: 'name' | 'followers' | 'publishingRate' | 'editRate'
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const defaultCustomerQuery: CustomerQuery = {
  search: '',
  country: 'all',
  status: 'all',
  onboarding: 'all',
  followerRange: 'all',
  pillar: 'all',
  lifecycle: 'all',
  period: 'month',
  sort: 'followers',
  sortDir: 'desc',
  page: 1,
  pageSize: 8,
}

export interface CustomerListResult {
  rows: CustomerRow[]
  total: number
  page: number
  pageCount: number
  stats: {
    total: number
    activeThisMonth: number
    avgPublishingRate: number
    avgEditRate: number
    onboardingCompletion: number
    contentAccepted: number
    series: number[][]
  }
  /** Aggregate movement across the customer base for the selected window. */
  overallTrend: {
    periodLabel: string
    previousLabel: string
    metrics: { label: string; value: string; deltaPp: number; series: number[] }[]
    statusMix: { label: string; count: number; tone: 'positive' | 'neutral' | 'negative' }[]
  }
  funnel: typeof mockFunnel
  adoption: typeof mockAdoption
}

/** Median across comparable competitors, per pillar. */
const PILLAR_BENCHMARK = { discovery: 62, credibility: 66, trust: 60 } as const

const followerBuckets: Record<string, [number, number | null]> = {
  'Under 1K': [0, 1000],
  '1K – 5K': [1000, 5000],
  '5K – 20K': [5000, 20000],
  '20K – 50K': [20000, 50000],
  'Over 50K': [50000, null],
}

/** Ordered product stages; a customer's stage implies every earlier one. */
const STAGE_ORDER = [
  'account-created',
  'instagram-connection-started',
  'instagram-connection-completed',
  'analysis-started',
  'analysis-completed',
  'analysis-viewed',
  'brand-info-viewed',
  'answers-confirmed',
  'review-mode-started',
  'review-mode-completed',
  'brand-profile-completed',
  'first-recommendation-viewed',
  'first-recommendation-accepted',
  'first-content-published',
] as const

/** The six milestones the journey reports, and the stage each requires. */
const MILESTONES: { stage: string; requires: string }[] = [
  { stage: 'Account Created', requires: 'account-created' },
  { stage: 'Instagram Connected', requires: 'instagram-connection-completed' },
  { stage: 'Analysis Completed', requires: 'analysis-completed' },
  { stage: 'Review Mode Started', requires: 'review-mode-started' },
  { stage: 'Review Mode Completed', requires: 'review-mode-completed' },
  { stage: 'First Content Published', requires: 'first-content-published' },
]

function buildFunnel(matched: CustomerRow[]) {
  const reached = (requires: string) => {
    const need = STAGE_ORDER.indexOf(requires as (typeof STAGE_ORDER)[number])
    return matched.filter(
      (c) => STAGE_ORDER.indexOf(c.onboardingStage as (typeof STAGE_ORDER)[number]) >= need,
    ).length
  }
  return MILESTONES.map((m, i) => {
    const template = mockFunnel[i]
    return { ...template, stage: m.stage, count: reached(m.requires) }
  })
}

const COMPLETED_STAGES = ['first-recommendation-viewed', 'first-recommendation-accepted', 'first-content-published']

export function listCustomersSync(q: CustomerQuery): CustomerListResult {
  let rows = mockCustomers.filter((c) => {
    if (q.search) {
      const s = q.search.toLowerCase()
      if (!c.name.toLowerCase().includes(s) && !(c.instagramUsername ?? '').toLowerCase().includes(s)) return false
    }
    if (q.country !== 'all' && c.location.country !== q.country) return false
    if (q.status !== 'all' && c.status !== q.status) return false
    if (q.onboarding === 'completed' && !COMPLETED_STAGES.includes(c.onboardingStage)) return false
    if (q.onboarding === 'in-progress' && COMPLETED_STAGES.includes(c.onboardingStage)) return false
    if (q.lifecycle !== 'all' && c.lifecycle !== q.lifecycle) return false
    if (q.pillar !== 'all') {
      // "Has this gap" = scores below the comparable-competitor benchmark.
      const value = c.authorityGap?.[q.pillar] ?? null
      if (value == null || value >= PILLAR_BENCHMARK[q.pillar]) return false
    }
    if (q.followerRange !== 'all') {
      const bucket = followerBuckets[q.followerRange]
      const f = c.latestFollowerCount
      if (!bucket || f == null) return false
      if (f < bucket[0] || (bucket[1] != null && f >= bucket[1])) return false
    }
    return true
  })

  const dir = q.sortDir === 'asc' ? 1 : -1
  rows = [...rows].sort((a, b) => {
    switch (q.sort) {
      case 'name':
        return dir * a.name.localeCompare(b.name)
      case 'publishingRate':
        return dir * (a.publishingRate - b.publishingRate)
      case 'editRate':
        return dir * (a.editRate - b.editRate)
      default:
        return dir * ((a.latestFollowerCount ?? 0) - (b.latestFollowerCount ?? 0))
    }
  })

  const pageCount = Math.max(1, Math.ceil(rows.length / q.pageSize))
  const page = Math.min(q.page, pageCount)

  const avg = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) / Math.max(1, values.length))

  // Everything below the filter bar describes the filtered set, not the
  // whole customer base — otherwise the summary contradicts the table.
  const matched = rows
  const share = matched.length / Math.max(1, mockCustomers.length)
  const scaleCount = (n: number) => Math.round(n * share)

  return {
    rows: rows.slice((page - 1) * q.pageSize, page * q.pageSize),
    total: rows.length,
    page,
    pageCount,
    stats: {
      total: matched.length,
      activeThisMonth: matched.filter((c) => c.lifecycle === 'active').length,
      avgPublishingRate: avg(matched.map((c) => c.publishingRate)),
      avgEditRate: avg(matched.map((c) => c.editRate)),
      onboardingCompletion: Math.round((mockFunnel.at(-1)!.count / mockFunnel[0].count) * 100),
      contentAccepted: matched.length
        ? Math.round((mockAdoption.accepted / mockAdoption.delivered) * 100)
        : 0,
      series: [
        [44, 46, 48, 50, 52, mockCustomers.length],
        [28, 30, 31, 34, 35, 36],
        [48, 51, 54, 57, 60, 62],
        [58, 60, 63, 65, 66, 68],
        [42, 40, 38, 36, 35, 34],
        [55, 59, 62, 66, 70, 72],
      ],
    },
    funnel: buildFunnel(matched),
    adoption: {
      delivered: scaleCount(mockAdoption.delivered),
      accepted: scaleCount(mockAdoption.accepted),
      edited: scaleCount(mockAdoption.edited),
      rejected: scaleCount(mockAdoption.rejected),
      published: scaleCount(mockAdoption.published),
    },
    overallTrend: buildOverallTrend(q.period, q.customRange, matched),
  }
}

/*
 * Aggregate trend across all customers. Shorter windows show smaller
 * movements — the same shape real week-vs-week data would have.
 */
/** True median, so one unusual account cannot move the reported figure. */
function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function buildOverallTrend(
  period: CustomerQuery['period'],
  range: CustomRange | undefined,
  matched: CustomerRow[],
): CustomerListResult['overallTrend'] {
  const meta = periodMeta(period, range)
  const scale = meta.days / 30
  const round = (n: number) => Math.round(n * 10) / 10
  const ramp = (end: number) => {
    const start = end * 0.55
    return Array.from({ length: 6 }, (_, i) => round(start + ((end - start) * i) / 5))
  }

  // Each figure is the median of the cohort's own movement, scaled to the
  // selected window. A cohort of declining customers reports declines.
  const metrics = (
    [
      ['Median follower change', 'followers', '%'],
      ['Median reach change', 'reach', '%'],
      ['Median saves change', 'saves', '%'],
      ['Publishing rate', 'publishing', 'pp'],
      ['Content acceptance', 'acceptance', 'pp'],
    ] as const
  ).map(([label, key, unit]) => {
    const delta = round(median(matched.map((c) => c.periodDeltas[key])) * scale)
    return {
      label,
      value: `${delta > 0 ? '+' : ''}${delta}${unit}`,
      deltaPp: delta,
      series: ramp(delta),
    }
  })

  const counts = { improving: 0, stable: 0, declining: 0, new: 0 }
  for (const c of matched) {
    if (c.status === 'improving') counts.improving++
    else if (c.status === 'declining') counts.declining++
    else if (c.status === 'new-or-insufficient-data') counts.new++
    else counts.stable++
  }

  return {
    periodLabel: meta.current,
    previousLabel: meta.previous,
    metrics,
    statusMix: [
      { label: 'Improving', count: counts.improving, tone: 'positive' },
      { label: 'Stable', count: counts.stable, tone: 'neutral' },
      { label: 'At risk', count: counts.declining, tone: 'negative' },
      { label: 'New / insufficient data', count: counts.new, tone: 'neutral' },
    ],
  }
}

export async function listCustomers(q: CustomerQuery): Promise<CustomerListResult> {
  await new Promise((r) => setTimeout(r, 200))
  return listCustomersSync(q)
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  await new Promise((r) => setTimeout(r, 120))
  return mockCustomers.find((c) => c.id === id) ?? null
}


export interface WeeklyPlanDay {
  day: string
  /** When this customer's own audience is most active, from their insights. */
  bestTime: string
  audienceActivityPct: number
  pillar: 'discovery' | 'credibility' | 'trust'
  contentType: string
  format: 'Carousel' | 'Reel' | 'Image'
}

export interface WeeklyPlan {
  customerName: string
  days: WeeklyPlanDay[]
  /** Where the timing data comes from — never a generic chart. */
  basis: string
  /** The pillar this plan prioritises, and whether it is behind or merely
   * the narrowest lead over comparable competitors. */
  primaryGap: {
    pillar: 'discovery' | 'credibility' | 'trust'
    value: number
    benchmark: number
    gap: number
    mode: 'close-gap' | 'extend-lead'
  }
  secondaryGap: { pillar: 'discovery' | 'credibility' | 'trust'; gap: number }
  strongest: { pillar: 'discovery' | 'credibility' | 'trust'; gap: number }
  /** Evidence behind the pillar comparison. */
  evidence: { competitorCount: number; windowDays: number }
}


/*
 * What high-performing comparable competitors publish for each pillar. These
 * are the formats that already produce results on that pillar, so a plan that
 * needs to close a pillar gap borrows from the matching list.
 */
const PILLAR_PLAYBOOK: Record<
  'discovery' | 'credibility' | 'trust',
  { contentType: string; format: WeeklyPlanDay['format']; why: string }[]
> = {
  discovery: [
    { contentType: 'Transformation reveal', format: 'Reel', why: 'Highest-reach format among comparable competitors' },
    { contentType: 'Strong-hook opener', format: 'Reel', why: 'Problem-first hooks travel furthest to non-followers' },
    { contentType: 'Before & after', format: 'Carousel', why: 'Most-saved discovery format in this size band' },
  ],
  credibility: [
    { contentType: 'Design decision story', format: 'Carousel', why: 'Top credibility driver among stronger accounts' },
    { contentType: 'Educational carousel', format: 'Carousel', why: 'Consistently used by high-performing competitors' },
    { contentType: 'Process walkthrough', format: 'Reel', why: 'Shows expertise without needing a finished project' },
  ],
  trust: [
    { contentType: 'Client story', format: 'Image', why: 'Strongest trust signal in the comparable group' },
    { contentType: 'Project context', format: 'Carousel', why: 'Builds familiarity before proof content' },
    { contentType: 'Founder / team', format: 'Reel', why: 'Founder-led posts outperform on trust in this segment' },
  ],
}

/**
 * Recommended weekly plan for one customer.
 *
 * Two inputs decide it: which authority pillar the customer is furthest
 * behind comparable competitors on (what to post), and that account's own
 * audience-activity curve (when to post). The biggest gap gets the
 * highest-activity slots.
 */
export function getWeeklyPlan(
  customerId: string,
  pillarFocus?: 'discovery' | 'credibility' | 'trust' | 'all',
): WeeklyPlan | null {
  const customer = mockCustomers.find((c) => c.id === customerId)
  if (!customer) return null

  let hash = 0
  for (const ch of customer.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0

  const gaps = (['discovery', 'credibility', 'trust'] as const)
    .map((pillar) => {
      const value = customer.authorityGap?.[pillar] ?? 0
      const benchmark = PILLAR_BENCHMARK[pillar]
      return { pillar, value, benchmark, gap: Math.round((value - benchmark) * 10) / 10 }
    })
    .sort((a, b) => a.gap - b.gap)

  // An explicit pillar filter overrides the computed priority.
  const focused =
    pillarFocus && pillarFocus !== 'all' ? gaps.find((g) => g.pillar === pillarFocus) : undefined
  const primaryBase = focused ?? gaps[0]
  const primary = {
    ...primaryBase,
    mode: (primaryBase.gap < 0 ? 'close-gap' : 'extend-lead') as 'close-gap' | 'extend-lead',
  }
  const rest = gaps.filter((g) => g.pillar !== primary.pillar)
  const secondary = rest[0]
  const strongest = rest[rest.length - 1]

  // Days ordered by this account's own audience activity.
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const activity = dayNames.map((day, i) => ({
    day,
    index: i,
    activityPct: 48 + ((hash >>> (i * 3)) % 40),
    bestTime: ['09:30', '11:00', '12:30', '18:30', '19:30'][(i + (hash % 5)) % 5],
  }))
  const byActivity = [...activity].sort((a, b) => b.activityPct - a.activityPct)

  // Three slots to the gap pillar, one to the next, one to maintain strength.
  const assignment = new Map<number, 'primary' | 'secondary' | 'strongest'>()
  byActivity.forEach((d, rank) => {
    assignment.set(d.index, rank < 3 ? 'primary' : rank === 3 ? 'secondary' : 'strongest')
  })

  const counters = { primary: 0, secondary: 0, strongest: 0 }
  const days: WeeklyPlanDay[] = activity.map((d) => {
    const role = assignment.get(d.index)!
    const target = role === 'primary' ? primary : role === 'secondary' ? secondary : strongest
    const playbook = PILLAR_PLAYBOOK[target.pillar]
    const pick = playbook[counters[role] % playbook.length]
    counters[role] += 1
    return {
      day: d.day,
      bestTime: d.bestTime,
      audienceActivityPct: d.activityPct,
      pillar: target.pillar,
      contentType: pick.contentType,
      format: pick.format,
    }
  })

  return {
    customerName: customer.name,
    days,
    basis: `@${customer.instagramUsername}'s own audience-activity data, last 30 days.`,
    primaryGap: primary,
    secondaryGap: { pillar: secondary.pillar, gap: secondary.gap },
    strongest: { pillar: strongest.pillar, gap: strongest.gap },
    evidence: { competitorCount: 24, windowDays: 30 },
  }
}
