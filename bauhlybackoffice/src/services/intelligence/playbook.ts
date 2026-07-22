import { thresholds } from '../../config/thresholds'
import { mockCustomers } from '../customers/mockData'

/*
 * The playbook: how competitor evidence becomes a customer recommendation.
 *
 * A segment is (follower range × market × authority gap). For that segment we
 * show which high-performing competitors define the benchmark, what they do
 * differently, and the weekly shape a customer with that gap should follow.
 *
 * Deliberately absent: posting times. Timing is derived per customer from
 * their own audience-activity data, so a segment-level plan cannot state it
 * without inventing a number.
 */

export type PillarKey = 'discovery' | 'credibility' | 'trust'

export interface SegmentQuery {
  followerRange: string
  country: string
  gap: PillarKey
}

export const defaultSegment: SegmentQuery = {
  followerRange: '5K – 20K',
  country: 'Spain',
  gap: 'credibility',
}

export const segmentOptions = {
  followerRange: ['1K – 5K', '5K – 20K', '20K – 50K', 'Over 50K'],
  country: ['Spain', 'Netherlands', 'Germany', 'Denmark'],
  gap: [
    { value: 'discovery', label: 'Discovery' },
    { value: 'credibility', label: 'Credibility' },
    { value: 'trust', label: 'Trust' },
  ] satisfies { value: PillarKey; label: string }[],
}

export interface PlaybookPlay {
  day: string
  pillar: PillarKey
  contentType: string
  format: 'Carousel' | 'Reel' | 'Image'
  /**
   * Share of high performers in this segment publishing this play. It is a
   * property of the play itself, so the same play always reports the same
   * figure wherever it appears.
   */
  adoptionPct: number
  /** What the customer needs to be able to produce it. */
  requires: string
}

export interface EvidenceItem {
  label: string
  /** High-performer usage. */
  focusPct: number
  /** Rest of the comparable group. */
  comparisonPct: number
  detail?: string
}

export interface Playbook {
  segment: { followerRange: string; country: string; gap: PillarKey; gapLabel: string }
  evidence: {
    highPerformers: number
    comparisonAccounts: number
    /** Stated inline wherever the term appears. */
    highPerformerDefinition: string
    postsAnalyzed: number
    windowDays: number
    strength: 'strong' | 'moderate' | 'exploratory'
    /** True when the segment is too thin to recommend from. */
    belowThreshold: boolean
  }
  customers: { count: number; examples: string[] }
  benchmark: {
    postsPerWeek: number
    engagementRate: number
    /** Share of high performers' posts classified as the gap pillar. */
    gapPillarSharePct: number
    /** Same measure for the rest of the comparable group. */
    gapPillarComparisonPct: number
  }
  plan: PlaybookPlay[]
  topics: EvidenceItem[]
  hooks: EvidenceItem[]
  hashtags: EvidenceItem[]
  stopDoing: EvidenceItem[]
  experiment: { hypothesis: string; change: string; measure: string; horizon: string }
  limitations: string[]
}

const PILLAR_LABEL: Record<PillarKey, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

const PILLAR_BENCHMARK = { discovery: 62, credibility: 66, trust: 60 } as const

/* What high performers publish for each pillar, and what producing it needs. */
type PlayDef = {
  contentType: string
  format: PlaybookPlay['format']
  requires: string
  /** Base adoption among high performers; tier-adjusted at read time. */
  adoption: number
}

/*
 * Four plays per pillar so a seven-day plan never has to repeat one. Adoption
 * is carried here, so the same play reports the same figure on every day it
 * appears and on every screen that shows it.
 */
const PLAYS: Record<PillarKey, PlayDef[]> = {
  discovery: [
    { contentType: 'Transformation reveal', format: 'Reel', requires: 'Before and after footage of one finished space', adoption: 64 },
    { contentType: 'Problem-first hook opener', format: 'Reel', requires: 'A common client problem, no new shoot needed', adoption: 47 },
    { contentType: 'Before & after', format: 'Carousel', requires: 'Paired photos from any completed project', adoption: 58 },
    { contentType: 'Space walkthrough', format: 'Reel', requires: 'One continuous phone take of a finished room', adoption: 36 },
  ],
  credibility: [
    { contentType: 'Design decision story', format: 'Carousel', requires: 'One decision from a real project and why it was made', adoption: 68 },
    { contentType: 'Educational explainer', format: 'Carousel', requires: 'Existing expertise, no project photography needed', adoption: 55 },
    { contentType: 'Process walkthrough', format: 'Reel', requires: 'Phone footage from an in-progress site', adoption: 43 },
    { contentType: 'Material comparison', format: 'Carousel', requires: 'Two materials you have specified and the trade-off', adoption: 31 },
  ],
  trust: [
    { contentType: 'Client story', format: 'Image', requires: 'Client permission and one quote', adoption: 61 },
    { contentType: 'Project context', format: 'Carousel', requires: 'Brief and constraints of a past project', adoption: 49 },
    { contentType: 'Founder / team', format: 'Reel', requires: 'Founder willing to appear on camera', adoption: 38 },
    { contentType: 'Budget reality', format: 'Carousel', requires: 'A real budget breakdown you can share', adoption: 27 },
  ],
}

const TOPICS: Record<PillarKey, EvidenceItem[]> = {
  discovery: [
    { label: 'Small spaces', focusPct: 24, comparisonPct: 11 },
    { label: 'Transformations', focusPct: 21, comparisonPct: 9 },
    { label: 'Kitchen projects', focusPct: 19, comparisonPct: 16 },
  ],
  credibility: [
    { label: 'Materials & finishes', focusPct: 27, comparisonPct: 12 },
    { label: 'Design decisions', focusPct: 22, comparisonPct: 8 },
    { label: 'Lighting decisions', focusPct: 16, comparisonPct: 9 },
  ],
  trust: [
    { label: 'Client collaboration', focusPct: 23, comparisonPct: 7 },
    { label: 'Budget & cost decisions', focusPct: 18, comparisonPct: 6 },
    { label: 'Project timelines', focusPct: 14, comparisonPct: 5 },
  ],
}

const HOOKS: Record<PillarKey, EvidenceItem[]> = {
  discovery: [
    { label: 'Problem + consequence', focusPct: 31, comparisonPct: 12, detail: '“Most [rooms] fail because… and it costs you…”' },
    { label: 'Curiosity gap', focusPct: 22, comparisonPct: 10, detail: '“We nearly demolished this wall. Here’s why we didn’t.”' },
  ],
  credibility: [
    { label: 'Design decision', focusPct: 28, comparisonPct: 9, detail: '“We chose oak over walnut. Here’s the reason.”' },
    { label: 'Common mistake', focusPct: 24, comparisonPct: 11, detail: '“The lighting mistake in almost every rental.”' },
  ],
  trust: [
    { label: 'Client problem', focusPct: 26, comparisonPct: 8, detail: '“They had a 12m² kitchen and three kids.”' },
    { label: 'Personal confession', focusPct: 17, comparisonPct: 6, detail: '“This project went over budget. Here’s what I learned.”' },
  ],
}

const HASHTAGS: Record<PillarKey, EvidenceItem[]> = {
  discovery: [
    { label: '#antesydespues', focusPct: 34, comparisonPct: 14 },
    { label: '#reformaintegral', focusPct: 31, comparisonPct: 22 },
    { label: '#pisospequenos', focusPct: 22, comparisonPct: 9 },
  ],
  credibility: [
    { label: '#materialesnaturales', focusPct: 29, comparisonPct: 11 },
    { label: '#interiorismo', focusPct: 41, comparisonPct: 38 },
    { label: '#detallesdediseno', focusPct: 19, comparisonPct: 7 },
  ],
  trust: [
    { label: '#proyectosdediseno', focusPct: 26, comparisonPct: 10 },
    { label: '#estudiodeinteriorismo', focusPct: 21, comparisonPct: 12 },
    { label: '#clientesfelices', focusPct: 15, comparisonPct: 6 },
  ],
}

const STOP: EvidenceItem[] = [
  { label: 'Generic reveal hooks', focusPct: 8, comparisonPct: 23, detail: 'High performers moved away from these; adoption fell 12pp' },
  { label: 'Hashtag-only captions', focusPct: 4, comparisonPct: 19, detail: 'Almost absent among high performers' },
  { label: 'Lifestyle / personal filler', focusPct: 6, comparisonPct: 17, detail: 'Weakening across the whole group' },
]

/** Larger accounts publish more; how much scales with the bracket. */
function tierFor(range: string): number {
  const order = ['1K – 5K', '5K – 20K', '20K – 50K', 'Over 50K']
  const i = order.indexOf(range)
  return i < 0 ? 1 : i
}

export async function getPlaybook(q: SegmentQuery): Promise<Playbook> {
  await new Promise((r) => setTimeout(r, 200))

  const tier = tierFor(q.followerRange)
  const marketScale = q.country === 'Spain' ? 1 : 0.4

  // "High performer" is the top quartile of the comparable group by median
  // engagement rate, restricted to accounts that publish consistently. It is a
  // subset of the comparison group, never half of it.
  const comparisonAccounts = Math.max(1, Math.round((48 - tier * 6) * marketScale))
  const highPerformers = Math.max(1, Math.round(comparisonAccounts * 0.25))
  const postsAnalyzed = Math.round((1842 - tier * 260) * marketScale)
  const belowThreshold =
    highPerformers < thresholds.minAccountsForPattern ||
    comparisonAccounts < thresholds.comparisonGroupTarget.min

  // Customers in this segment who actually carry this gap.
  const matching = mockCustomers.filter((c) => {
    const followers = c.latestFollowerCount ?? 0
    const inRange =
      q.followerRange === '1K – 5K'
        ? followers >= 1000 && followers < 5000
        : q.followerRange === '5K – 20K'
          ? followers >= 5000 && followers < 20000
          : q.followerRange === '20K – 50K'
            ? followers >= 20000 && followers < 50000
            : followers >= 50000
    if (!inRange) return false
    if (c.location.country !== q.country) return false
    const value = c.authorityGap?.[q.gap]
    return value != null && value < PILLAR_BENCHMARK[q.gap]
  })

  const gapPlays = PLAYS[q.gap]
  const others = (Object.keys(PLAYS) as PillarKey[]).filter((p) => p !== q.gap)

  // A full week: four slots on the gap pillar, three kept varied. High
  // performers never ran a single pillar across the whole week. Every slot is
  // a distinct play, so no two days can disagree about the same one.
  const slot = (day: string, pillar: PillarKey, def: PlayDef): PlaybookPlay => ({
    day,
    pillar,
    contentType: def.contentType,
    format: def.format,
    requires: def.requires,
    adoptionPct: Math.max(5, def.adoption - tier * 4),
  })

  const plan: PlaybookPlay[] = [
    slot('Day 1', q.gap, gapPlays[0]),
    slot('Day 2', others[0], PLAYS[others[0]][0]),
    slot('Day 3', q.gap, gapPlays[1]),
    slot('Day 4', others[1], PLAYS[others[1]][0]),
    slot('Day 5', q.gap, gapPlays[2]),
    slot('Day 6', others[0], PLAYS[others[0]][1]),
    slot('Day 7', q.gap, gapPlays[3]),
  ]

  return {
    segment: {
      followerRange: q.followerRange,
      country: q.country,
      gap: q.gap,
      gapLabel: PILLAR_LABEL[q.gap],
    },
    evidence: {
      highPerformers,
      comparisonAccounts,
      highPerformerDefinition:
        'Top 25% of the comparable group by median engagement rate over the last 30 days, ' +
        'counting only accounts that published at least 3 times a week throughout.',
      postsAnalyzed,
      windowDays: 30,
      strength: belowThreshold ? 'exploratory' : highPerformers >= 10 ? 'strong' : 'moderate',
      belowThreshold,
    },
    customers: {
      count: matching.length,
      examples: matching.slice(0, 4).map((c) => c.name),
    },
    benchmark: {
      postsPerWeek: Math.round((3.2 + tier * 0.9) * 10) / 10,
      engagementRate: Math.round((2.6 - tier * 0.4) * 10) / 10,
      gapPillarSharePct: 34 - tier * 2,
      gapPillarComparisonPct: 17 - tier,
    },
    plan,
    topics: TOPICS[q.gap],
    hooks: HOOKS[q.gap],
    hashtags: HASHTAGS[q.gap],
    stopDoing: STOP,
    experiment: {
      hypothesis: `Publishing ${PILLAR_LABEL[q.gap].toLowerCase()} content three times a week closes part of the ${PILLAR_LABEL[q.gap].toLowerCase()} gap.`,
      change: `Replace two low-performing posts a week with the ${PILLAR_LABEL[q.gap].toLowerCase()} plays above. Keep everything else unchanged.`,
      measure: `Saves and profile visits on the ${PILLAR_LABEL[q.gap].toLowerCase()} posts, and the pillar score after the next collection cycle.`,
      horizon: '4 weeks — shorter than that and normal week-to-week variation dominates.',
    },
    limitations: [
      'Competitor metrics are public only. Reach, saves and paid promotion are unknown, so a high performer may be boosting posts.',
      'This is observed correlation, not proof. These accounts publish this way and perform well; the content may not be what causes the performance.',
      'Timing is excluded on purpose — it is set per customer from their own audience-activity data.',
      belowThreshold
        ? `Sample is below the ${thresholds.comparisonGroupTarget.min}-account target for this segment; treat as exploratory.`
        : 'Sample meets the minimum account and post thresholds for this segment.',
    ],
  }
}
