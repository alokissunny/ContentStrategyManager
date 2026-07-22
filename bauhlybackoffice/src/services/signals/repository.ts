import type { Signal, SignalKind } from '../../types'
import { defaultFilters, type FilterState } from '../intelligence/filters'
import { computeDashboard } from '../intelligence/repository'
import { mockCustomers } from '../customers/mockData'
import { postsFor } from './mockPosts'
import { getAllTrackRecords } from '../outcomes/repository'

/*
 * The Signals feed: what changed, ranked, with the evidence attached.
 *
 * Derivation rule — this file computes no new measurements. Every signal
 * reads a number that already exists in another repository and names where
 * it came from in `derivedFrom`. That is what makes the feed trustworthy:
 * it cannot drift from the panels it summarises, because it has no numbers
 * of its own to drift with.
 *
 * Ranking is deliberate rather than chronological. A strategist has five
 * minutes; the ordering is the product.
 */

export interface SignalsQuery {
  /** Window the feed reports on. */
  window: 'this-week' | 'this-month'
  /** Segment preset, expressed as the same filter state Intelligence uses. */
  segment: FilterState
  kinds: SignalKind[] | 'all'
}

export const segmentPresets = [
  { id: 'core', label: 'Core market · Spain · 5K–20K', filters: defaultFilters },
  {
    id: 'growth',
    label: 'Growth accounts · Spain · 20K–50K',
    filters: { ...defaultFilters, followerRangeLabel: '20K – 50K' },
  },
  {
    id: 'nl',
    label: 'Netherlands · 5K–20K',
    filters: { ...defaultFilters, location: 'Netherlands' },
  },
] as const

export const defaultSignalsQuery: SignalsQuery = {
  window: 'this-week',
  segment: defaultFilters,
  kinds: 'all',
}

/** A signal has to clear this to be worth a card. Everything else is noise. */
const THRESHOLD = {
  /** Percentage points a pattern must move in the window. */
  patternMovePp: 4,
  /** Days of customer silence before it is worth interrupting someone. */
  customerSilenceDays: 12,
  /** Search-demand share below which an unanswered topic is not yet a gap. */
  demandSharePct: 12,
  /** Competitor supply above which the demand is already being answered. */
  supplySharePct: 8,
}

/** Fixed clock: mock data is deterministic, so its "now" has to be too. */
const NOW = new Date('2026-07-19T09:00:00+02:00')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString()
}

function windowDays(w: SignalsQuery['window']): number {
  return w === 'this-week' ? 7 : 30
}

function patternSignals(q: SignalsQuery): Signal[] {
  const dash = computeDashboard(q.segment)
  const scale = windowDays(q.window) / 30

  return dash.movements
    // Scale to the window first, then threshold, so the number on the card is
    // the same number that qualified it for a card.
    .map((m) => ({
      movement: m,
      changePp: m.changePp == null ? null : Math.round(m.changePp * scale * 10) / 10,
    }))
    // The bar scales with the window as well. 4pp in a month and ~1pp in a
    // week describe the same rate of change; holding a fixed bar would hide
    // every pattern from the weekly view rather than reporting it smaller.
    .filter((x) => x.changePp != null && Math.abs(x.changePp) >= THRESHOLD.patternMovePp * scale)
    .map(({ movement: m, changePp: scaled }) => {
      const changePp = scaled as number
      const rising = changePp > 0
      const posts = postsFor(m.pattern)
      const accounts = m.sample.accountsAnalyzed
      const adopters = Math.max(1, Math.round((m.currentValue ?? 0) / 100 * accounts))

      return {
        id: `sig-pattern-${m.id}`,
        kind: 'pattern' as const,
        tone: rising ? ('opportunity' as const) : ('watch' as const),
        headline: rising
          ? `${m.pattern} rose ${changePp}pp — ${adopters} of ${accounts} accounts now use it`
          : `${m.pattern} fell ${Math.abs(changePp)}pp across the group`,
        detail: rising
          ? `Was ${m.previousValue}% of posts, now ${m.currentValue}%. ${m.metricDefinition}`
          : `Was ${m.previousValue}% of posts, now ${m.currentValue}%. Accounts are moving away from it.`,
        pillar: null,
        evidence: [
          { label: 'Change', value: `${changePp > 0 ? '+' : ''}${changePp}pp` },
          { label: 'Now', value: `${m.currentValue}% of posts` },
          { label: 'Accounts', value: `${accounts} analysed` },
          { label: 'Posts', value: `${m.sample.postsAnalyzed.toLocaleString('en-US')}` },
        ],
        derivedFrom:
          q.window === 'this-week'
            ? 'Competitors → Pattern movement (30-day measurement, shown at weekly rate)'
            : 'Competitors → Pattern movement',
        strength: m.evidenceStrength,
        posts: posts.slice(0, 3),
        actions: [
          { label: 'See evidence', to: '/competitors-overview' },
          ...(rising ? [{ label: 'Open playbook', to: '/intelligence' }] : []),
        ],
        // A big move seen across many accounts outranks a big move seen in few.
        priority: Math.abs(changePp) * 10 + accounts,
        detectedAt: daysAgo(1),
      }
    })
}

function customerSignals(q: SignalsQuery): Signal[] {
  const out: Signal[] = []
  const country = q.segment.location

  for (const c of mockCustomers) {
    if (country !== 'All' && c.location.country !== country) continue

    // Silence from an account that was doing well is the highest-value alert
    // in the product: the plan was working and then stopped.
    if (c.daysSinceActivity >= THRESHOLD.customerSilenceDays && c.lifecycle !== 'churned') {
      const wasWorking = c.status === 'improving'
      out.push({
        id: `sig-cust-silent-${c.id}`,
        kind: 'customer',
        tone: 'alert',
        headline: `${c.name} has published nothing for ${c.daysSinceActivity} days`,
        detail: wasWorking
          ? 'They were improving before they stopped. The plan was working when it was followed.'
          : `Currently ${c.lifecycle.replace('-', ' ')}. Publishing rate ${c.publishingRate}%.`,
        pillar: null,
        evidence: [
          { label: 'Silent for', value: `${c.daysSinceActivity} days` },
          { label: 'State', value: c.lifecycle.replace('-', ' ') },
          { label: 'Publishing rate', value: `${c.publishingRate}%` },
          {
            label: 'Followers',
            value: c.latestFollowerCount ? `${(c.latestFollowerCount / 1000).toFixed(1)}K` : '—',
          },
        ],
        derivedFrom: 'Customers → last activity',
        strength: 'strong',
        posts: [],
        actions: [
          { label: 'Open customer', to: '/customers' },
          { label: 'Mark handled', to: null },
        ],
        // Longer silence and a previously-improving account both raise urgency.
        priority: c.daysSinceActivity * 4 + (wasWorking ? 40 : 0),
        detectedAt: daysAgo(0),
      })
      continue
    }

    // An account that is declining while a plan is active means the plan is
    // not working — a different problem from silence, and worth its own card.
    // It only holds if they are actually still publishing: a high publishing
    // rate on a dormant account is a stale average, not current behaviour.
    if (
      c.status === 'declining' &&
      c.publishingRate >= 40 &&
      c.daysSinceActivity < THRESHOLD.customerSilenceDays
    ) {
      out.push({
        id: `sig-cust-declining-${c.id}`,
        kind: 'customer',
        tone: 'alert',
        headline: `${c.name} is publishing but still declining`,
        detail: `Publishing at ${c.publishingRate}% and performance is falling. The plan is being followed and is not working.`,
        pillar: null,
        evidence: [
          { label: 'Publishing rate', value: `${c.publishingRate}%` },
          { label: 'Performance', value: 'declining' },
          {
            label: 'Last active',
            value: c.daysSinceActivity === 0 ? 'today' : `${c.daysSinceActivity}d ago`,
          },
        ],
        derivedFrom: 'Customers → performance trend',
        strength: 'moderate',
        posts: [],
        actions: [
          { label: 'Open customer', to: '/customers' },
          { label: 'Mark handled', to: null },
        ],
        priority: 90 + c.publishingRate / 2,
        detectedAt: daysAgo(2),
      })
    }
  }

  return out
}

function demandGapSignals(q: SignalsQuery): Signal[] {
  const dash = computeDashboard(q.segment)
  const supply = new Map(dash.topics.map((t) => [t.topic, t.sharePct]))

  return dash.trendTopics
    .filter((t) => t.sharePct >= THRESHOLD.demandSharePct)
    .filter((t) => (supply.get(t.topic) ?? 0) < THRESHOLD.supplySharePct)
    .map((t) => {
      const supplyPct = supply.get(t.topic) ?? 0
      const answered = supplyPct > 0
      return {
        id: `sig-demand-${t.topic.toLowerCase().replace(/\s+/g, '-')}`,
        kind: 'demand-gap' as const,
        tone: 'opportunity' as const,
        headline: answered
          ? `“${t.topic}” is searched far more than it is posted about`
          : `Nobody in the group posts about “${t.topic}”`,
        detail: `${t.sharePct}% of search interest, ${answered ? `${supplyPct.toFixed(1)}% of competitor posts` : 'no competitor posts found'}. Top query: “${t.query}”.`,
        pillar: t.pillar ?? null,
        evidence: [
          { label: 'Search demand', value: `${t.sharePct}%` },
          { label: 'Competitor supply', value: answered ? `${supplyPct.toFixed(1)}%` : 'none' },
          { label: 'Intent', value: t.intent },
          { label: 'Trend', value: `${t.changePp > 0 ? '+' : ''}${t.changePp}pp` },
        ],
        derivedFrom: 'Competitors → What people are searching for (Google Trends)',
        // Two sources that cannot be joined on the same accounts. Saying this
        // out loud matters more than the number does.
        strength: 'exploratory' as const,
        posts: [],
        actions: [{ label: 'See searches', to: '/competitors-overview' }],
        priority: t.sharePct * 3 + t.changePp * 4 - supplyPct * 2,
        detectedAt: daysAgo(3),
      }
    })
}

/*
 * Ranking, in priority order:
 *
 *   1. Something needs a person today (alert) before something is merely
 *      available to act on (opportunity) before something to keep an eye on.
 *   2. Within that, how much we can stand behind the claim. A well-evidenced
 *      finding must never sit below an exploratory one — a feed that leads
 *      with its weakest evidence teaches the reader to distrust the top.
 *   3. Only then, magnitude within the signal's own kind.
 */
const TONE_RANK = { alert: 3, opportunity: 2, watch: 1 } as const
const STRENGTH_RANK = { strong: 3, moderate: 2, exploratory: 1 } as const

function rank(s: Signal): number {
  const tone = TONE_RANK[s.tone] * 10_000
  const strength = (STRENGTH_RANK[s.strength as keyof typeof STRENGTH_RANK] ?? 1) * 1_000
  // Magnitude only breaks ties inside a tone-and-strength band.
  return tone + strength + Math.min(s.priority, 999)
}

/*
 * The feedback loop closing. Competitor evidence says a play works; our own
 * customers are the test of whether it works for them. When those two
 * disagree, that is the most valuable thing the product can tell the team —
 * it means the advice needs changing, not the customer.
 */
function recommendationSignals(): Signal[] {
  return getAllTrackRecords()
    .filter((r) => r.reportable)
    .filter((r) => r.medianChangePct != null && r.medianChangePct < 0)
    .map((r) => {
      const improvedPct = Math.round((r.improvedAfter / r.followed) * 100)
      return {
        id: `sig-rec-${r.contentType.toLowerCase().replace(/[^a-z]+/g, '-')}`,
        kind: 'recommendation' as const,
        tone: 'alert' as const,
        headline: `“${r.contentType}” is not working for our customers`,
        detail: `${r.followed} customers published it. ${r.improvedAfter} improved afterwards (${improvedPct}%), and the median movement was ${r.medianChangePct}%. We are still recommending it.`,
        pillar: r.pillar,
        evidence: [
          { label: 'Customers ran it', value: `${r.followed}` },
          { label: 'Improved after', value: `${r.improvedAfter} (${improvedPct}%)` },
          { label: 'Declined after', value: `${r.declinedAfter}` },
          { label: 'Median change', value: `${r.medianChangePct}%` },
        ],
        derivedFrom: 'Customers → recommendation outcomes',
        // Observational: we did not withhold the play from a control group.
        strength: 'moderate' as const,
        posts: [],
        actions: [{ label: 'Open playbook', to: '/intelligence' }],
        priority: r.followed * 2 + Math.abs(r.medianChangePct ?? 0) * 5,
        detectedAt: daysAgo(4),
      }
    })
}

export function computeSignals(q: SignalsQuery): Signal[] {
  const all = [
    ...patternSignals(q),
    ...customerSignals(q),
    ...demandGapSignals(q),
    ...recommendationSignals(),
  ]
  const wanted = q.kinds === 'all' ? all : all.filter((s) => q.kinds.includes(s.kind))
  // Stable tiebreak on id so the order never depends on source array order.
  return wanted.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))
}

export async function getSignals(q: SignalsQuery): Promise<Signal[]> {
  await new Promise((r) => setTimeout(r, 180))
  return computeSignals(q)
}
