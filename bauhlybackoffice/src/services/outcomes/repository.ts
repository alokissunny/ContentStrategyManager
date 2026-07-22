import type {
  Adherence,
  OutcomeVerdict,
  PlayTrackRecord,
  RecommendationOutcome,
} from '../../types'
import { mockCustomers } from '../customers/mockData'

/*
 * Outcome history, generated deterministically per customer so the same
 * customer always has the same record.
 *
 * The honest part of this file is what it refuses to do. A recommendation
 * that was never followed produces no metric — not a zero — because a zero
 * would be read as "we tried it and nothing happened". And a play is only
 * given a success rate once enough customers have actually followed it;
 * below that it reports the raw counts and says the rate is not reportable.
 */

/** Every play the product can recommend, per pillar. Mirrors playbook.ts. */
const PLAYS = {
  discovery: ['Transformation reveal', 'Problem-first hook opener', 'Before & after', 'Space walkthrough'],
  credibility: ['Design decision story', 'Educational explainer', 'Process walkthrough', 'Material comparison'],
  trust: ['Client story', 'Project context', 'Founder / team', 'Budget reality'],
} as const

type Pillar = keyof typeof PLAYS

/*
 * How well each play actually lands, independent of who ran it. This is the
 * variable the whole feature exists to expose: a play can be common among
 * high performers and still not work for our customers, and the product
 * should be able to say so. A few are deliberately weak.
 */
const EFFICACY: Record<string, number> = {
  'Transformation reveal': 0.68,
  'Problem-first hook opener': 0.71,
  'Before & after': 0.62,
  'Space walkthrough': 0.38,
  'Design decision story': 0.74,
  'Educational explainer': 0.77,
  'Process walkthrough': 0.66,
  'Material comparison': 0.35,
  'Client story': 0.7,
  'Project context': 0.6,
  'Founder / team': 0.64,
  'Budget reality': 0.41,
}

/** What each pillar's plays are trying to move. */
const METRIC: Record<Pillar, string> = {
  discovery: 'Reach',
  credibility: 'Saves',
  trust: 'Profile visits',
}

/**
 * Things that could explain a movement other than the recommendation. Shown
 * on every followed outcome, because none of them were controlled for.
 */
const CONFOUNDERS = [
  'Posting frequency also changed during the window',
  'Seasonal demand shifts across the whole market',
  'Platform distribution changes affect all accounts',
  'The customer may have run paid promotion — not observable',
  'Other content published in the same window',
]

/** Same seeded PRNG the rest of the mock layer uses. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function isoDaysAgo(days: number): string {
  const NOW = Date.parse('2026-07-19T00:00:00Z')
  return new Date(NOW - days * 86400000).toISOString().slice(0, 10)
}

/**
 * A customer's recommendation history: one record per week going back,
 * most recent first.
 */
export function getOutcomes(customerId: string): RecommendationOutcome[] {
  const customer = mockCustomers.find((c) => c.id === customerId)
  if (!customer) return []

  const rand = mulberry32(hash(customerId))
  const out: RecommendationOutcome[] = []

  // Twelve weeks of history is enough to show a pattern without inventing a year.
  for (let week = 0; week < 12; week++) {
    const pillars = Object.keys(PLAYS) as Pillar[]
    const pillar = pillars[Math.floor(rand() * pillars.length)]
    const plays = PLAYS[pillar]
    const contentType = plays[Math.floor(rand() * plays.length)]
    const recommendedOn = isoDaysAgo(week * 7 + 7)
    const windowDays = 28

    // Adherence tracks how engaged the customer actually is. A customer who
    // barely publishes did not quietly follow eleven recommendations.
    const engagement = customer.publishingRate / 100
    const roll = rand()
    let adherence: Adherence
    if (week === 0) adherence = 'pending'
    else if (roll < engagement * 0.72) adherence = 'followed'
    else if (roll < engagement * 0.72 + 0.18) adherence = 'partially-followed'
    else adherence = 'not-followed'

    let verdict: OutcomeVerdict
    let metricChangePct: number | null
    let matchedPostCount: number

    if (adherence === 'pending') {
      verdict = 'too-early'
      metricChangePct = null
      matchedPostCount = 0
    } else if (adherence === 'not-followed') {
      // Never followed, so there is nothing to evaluate. Not a zero.
      verdict = 'not-evaluable'
      metricChangePct = null
      matchedPostCount = 0
    } else {
      matchedPostCount = adherence === 'followed' ? 1 + Math.floor(rand() * 3) : 1
      // Movement leans with the customer's own trajectory, but not perfectly:
      // recommendations sometimes fail on improving accounts and land on
      // declining ones. A feedback loop that always agrees with the existing
      // status would be measuring nothing.
      // The play's own efficacy, adjusted by how the account was already
      // doing. Both matter: a weak play on a thriving account can still land,
      // and a strong play cannot rescue an account in freefall.
      const customerFactor =
        customer.status === 'improving' ? 1.18 : customer.status === 'declining' ? 0.82 : 1
      const lean = Math.min(0.92, (EFFICACY[contentType] ?? 0.6) * customerFactor)
      const positive = rand() < lean
      const magnitude = Math.round((2 + rand() * 22) * 10) / 10
      metricChangePct = positive ? magnitude : -Math.round((1 + rand() * 12) * 10) / 10
      verdict =
        Math.abs(metricChangePct) < 3
          ? 'no-measurable-change'
          : metricChangePct > 0
            ? 'improved-after'
            : 'declined-after'
    }

    out.push({
      id: `outcome-${customerId}-${week}`,
      customerId,
      contentType,
      pillar,
      recommendedOn,
      windowDays,
      adherence,
      verdict,
      matchedPostCount,
      metricLabel: METRIC[pillar],
      metricChangePct,
      confounders: metricChangePct == null ? [] : CONFOUNDERS.slice(0, 3),
    })
  }

  return out
}

export interface OutcomeSummary {
  recommended: number
  followed: number
  improvedAfter: number
  /** Share of recommendations the customer acted on. */
  adherencePct: number
  /**
   * Share of *followed* recommendations that were followed by improvement.
   * Null when too few were followed to state a rate honestly.
   */
  successPct: number | null
  reportable: boolean
}

/** Below this, a percentage is noise dressed as a finding. */
const MIN_FOLLOWED_FOR_RATE = 4

export function summariseOutcomes(outcomes: RecommendationOutcome[]): OutcomeSummary {
  const closed = outcomes.filter((o) => o.adherence !== 'pending')
  const followed = closed.filter(
    (o) => o.adherence === 'followed' || o.adherence === 'partially-followed',
  )
  const improved = followed.filter((o) => o.verdict === 'improved-after')
  const reportable = followed.length >= MIN_FOLLOWED_FOR_RATE

  return {
    recommended: closed.length,
    followed: followed.length,
    improvedAfter: improved.length,
    adherencePct: closed.length ? Math.round((followed.length / closed.length) * 100) : 0,
    successPct: reportable ? Math.round((improved.length / followed.length) * 100) : null,
    reportable,
  }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(m * 10) / 10
}

/**
 * How a single play has performed across every customer it was recommended
 * to. This is what turns the playbook from a set of observations about
 * competitors into a set of claims the product can be held to.
 */
export function getTrackRecord(contentType: string): PlayTrackRecord | null {
  const all = mockCustomers.flatMap((c) => getOutcomes(c.id))
  const forPlay = all.filter((o) => o.contentType === contentType && o.adherence !== 'pending')
  if (!forPlay.length) return null

  const followed = forPlay.filter(
    (o) => o.adherence === 'followed' || o.adherence === 'partially-followed',
  )
  const changes = followed.map((o) => o.metricChangePct).filter((v): v is number => v != null)

  return {
    contentType,
    pillar: forPlay[0].pillar,
    recommended: forPlay.length,
    followed: followed.length,
    improvedAfter: followed.filter((o) => o.verdict === 'improved-after').length,
    declinedAfter: followed.filter((o) => o.verdict === 'declined-after').length,
    medianChangePct: followed.length >= MIN_FOLLOWED_FOR_RATE ? median(changes) : null,
    reportable: followed.length >= MIN_FOLLOWED_FOR_RATE,
  }
}

/** Track records for every play, best-evidenced first. */
export function getAllTrackRecords(): PlayTrackRecord[] {
  const plays = Object.values(PLAYS).flat() as string[]
  return plays
    .map((p) => getTrackRecord(p))
    .filter((r): r is PlayTrackRecord => r != null)
    .sort((a, b) => b.followed - a.followed)
}

export { MIN_FOLLOWED_FOR_RATE }
