import type { Customer } from '../../types'

/*
 * Deterministic mock customer dataset (54 customers, matching the mockup).
 * Schema-validated in tests. The first eight mirror the mockup rows.
 */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(54_2026)
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

interface Seed {
  name: string
  username: string
  country: string
  city: string
  followers: number
  status: Customer['status']
  onboarding: Customer['onboardingStage']
  review: Customer['reviewModeStatus']
  publishingRate: number
  editRate: number
  gap: { discovery: number; credibility: number; trust: number }
}

const seeds: Seed[] = [
  { name: 'Atelier Dawn', username: 'atelierdawn', country: 'Spain', city: 'Barcelona', followers: 18700, status: 'improving', onboarding: 'first-content-published', review: 'completed', publishingRate: 74, editRate: 28, gap: { discovery: 65, credibility: 72, trust: 58 } },
  { name: 'BuildAura Studio', username: 'buildaura.studio', country: 'Spain', city: 'Valencia', followers: 12900, status: 'improving', onboarding: 'first-content-published', review: 'in-progress', publishingRate: 58, editRate: 41, gap: { discovery: 55, credibility: 61, trust: 49 } },
  { name: 'Nordic Atelier', username: 'nordic.atelier', country: 'Denmark', city: 'Copenhagen', followers: 76300, status: 'stable', onboarding: 'first-content-published', review: 'completed', publishingRate: 68, editRate: 31, gap: { discovery: 78, credibility: 81, trust: 74 } },
  { name: 'Studio Terra', username: 'studioterra', country: 'Spain', city: 'Madrid', followers: 9800, status: 'improving', onboarding: 'first-recommendation-accepted', review: 'completed', publishingRate: 49, editRate: 36, gap: { discovery: 52, credibility: 66, trust: 60 } },
  { name: 'Madera Arquitectura', username: 'madera.arq', country: 'Spain', city: 'Bilbao', followers: 15400, status: 'declining', onboarding: 'review-mode-started', review: 'in-progress', publishingRate: 32, editRate: 52, gap: { discovery: 44, credibility: 51, trust: 39 } },
  { name: 'Luz Interiorismo', username: 'luz.interiorismo', country: 'Spain', city: 'Valencia', followers: 6200, status: 'improving', onboarding: 'first-content-published', review: 'completed', publishingRate: 61, editRate: 29, gap: { discovery: 58, credibility: 63, trust: 66 } },
  { name: 'Haus Konzept', username: 'haus.konzept', country: 'Germany', city: 'Berlin', followers: 3100, status: 'new-or-insufficient-data', onboarding: 'analysis-completed', review: 'not-started', publishingRate: 18, editRate: 48, gap: { discovery: 31, credibility: 42, trust: 36 } },
  { name: 'RAW Studio', username: 'raw.studio', country: 'Netherlands', city: 'Rotterdam', followers: 22100, status: 'stable', onboarding: 'first-content-published', review: 'completed', publishingRate: 70, editRate: 23, gap: { discovery: 71, credibility: 68, trust: 70 } },
]

const extraA = ['Casa', 'Studio', 'Forma', 'Nido', 'Piso', 'Ambienta', 'Lumen', 'Norte', 'Taller', 'Volta'] as const
const extraB = ['Interiors', 'Design', 'Estudio', 'Living', 'Projects', 'Casa', 'Works'] as const
const cities = [
  ['Spain', 'Barcelona'], ['Spain', 'Madrid'], ['Spain', 'Valencia'], ['Spain', 'Sevilla'],
  ['Netherlands', 'Amsterdam'], ['Germany', 'Hamburg'], ['Denmark', 'Aarhus'],
] as const
const stages: Customer['onboardingStage'][] = [
  'instagram-connection-completed', 'analysis-completed', 'answers-confirmed',
  'review-mode-started', 'review-mode-completed', 'brand-profile-completed',
  'first-recommendation-viewed', 'first-recommendation-accepted', 'first-content-published',
]

function extraSeed(i: number): Seed {
  const name = `${pick(extraA)} ${pick(extraB)}`
  const [country, city] = pick(cities)
  const status = (['improving', 'improving', 'stable', 'stable', 'declining', 'new-or-insufficient-data'] as const)[randInt(0, 5)]
  return {
    name: `${name} ${i}`,
    username: `${name.toLowerCase().replace(/\s+/g, '.')}${i}`,
    country,
    city,
    followers: randInt(900, 40000),
    status,
    onboarding: pick(stages),
    review: pick(['not-started', 'in-progress', 'completed'] as const),
    publishingRate: randInt(12, 85),
    editRate: randInt(15, 60),
    gap: { discovery: randInt(25, 85), credibility: randInt(25, 85), trust: randInt(25, 85) },
  }
}

/** Where the customer sits in the subscription lifecycle. */
export type Lifecycle = 'active' | 'onboarding' | 'at-risk' | 'churned' | 'paused'

export interface CustomerRow extends Customer {
  publishingRate: number
  editRate: number
  trendSeries: number[]
  lifecycle: Lifecycle
  /** Days since the customer last did anything in the product. */
  daysSinceActivity: number
  /**
   * This customer's own movement over the last period. Declining customers
   * carry negative values — a cohort of them must be allowed to look bad.
   */
  periodDeltas: {
    followers: number
    reach: number
    saves: number
    publishing: number
    acceptance: number
  }
}

function toCustomer(seed: Seed, index: number): CustomerRow {

  /*
   * Lifecycle is derived, not random: long silence means churned, a shorter
   * gap plus a declining trend means at risk, and customers who have not
   * published yet are still onboarding.
   */
  const daysSinceActivity =
    seed.status === 'declining' ? randInt(12, 46) : seed.status === 'new-or-insufficient-data' ? randInt(1, 9) : randInt(0, 8)
  // Activated = shipped something, or is publishing regularly even if the
  // onboarding flag lags behind.
  const activated = seed.onboarding === 'first-content-published' || seed.publishingRate >= 30
  const lifecycle: Lifecycle =
    daysSinceActivity > 35
      ? 'churned'
      : daysSinceActivity > 21
        ? 'paused'
        : !activated
          ? 'onboarding'
          : seed.status === 'declining' || seed.publishingRate < 38
            ? 'at-risk'
            : 'active'

  // Movement follows the customer's own state, with spread inside each state.
  const dir = seed.status === 'improving' ? 1 : seed.status === 'declining' ? -1 : 0
  const spread = (base: number) => {
    const jitter = (rand() * 0.8 + 0.6) * base
    if (dir === 1) return Math.round(jitter * 10) / 10
    if (dir === -1) return Math.round(-jitter * 10) / 10
    // Stable and new accounts hover around zero, either side.
    return Math.round((rand() * base * 0.6 - base * 0.3) * 10) / 10
  }

  /** The row's headline movement. The sparkline and the delta both use it. */
  const followerDelta = spread(2.6)

  return {
    id: index === 0 ? 'cust-atelierdawn' : `cust-${index}`,
    name: seed.name,
    instagramUsername: seed.username,
    email: null,
    location: { country: seed.country, region: null, city: seed.city },
    plan: seed.followers > 20000 ? 'studio' : 'solo',
    peerGroupId: seed.country === 'Spain' ? 'grp-comparable' : null,
    connectionStatus:
      seed.status === 'collection-error' ? 'expired-token' : seed.onboarding === 'analysis-completed' && seed.review === 'not-started' ? 'connected' : 'connected',
    onboardingStage: seed.onboarding,
    reviewModeStatus: seed.review,
    status: seed.status,
    statusReason:
      seed.status === 'improving'
        ? 'Reach and saves up vs previous 30 days; publishing consistent.'
        : seed.status === 'declining'
          ? 'Publishing rate and review completion dropped vs previous 30 days.'
          : seed.status === 'new-or-insufficient-data'
            ? 'Less than 30 days of connected data.'
            : 'Metrics within normal variation vs previous 30 days.',
    latestFollowerCount: seed.followers,
    authorityGap: seed.gap,
    lastActivityAt: `2026-07-${String(randInt(15, 19)).padStart(2, '0')}T0${randInt(1, 9)}:00:00Z`,
    dataQuality: seed.status === 'new-or-insufficient-data' ? 'partial' : 'complete',
    createdAt: `2026-0${randInt(2, 6)}-01T09:00:00Z`,
    publishingRate: seed.publishingRate,
    editRate: seed.editRate,
    // Drawn from the same figure the row reports, so the line and the number
    // can never point in opposite directions.
    trendSeries: (() => {
      const noise = Array.from({ length: 8 }, () => rand() * 4 - 2)
      return Array.from({ length: 8 }, (_, i) => 50 + (followerDelta * i * 4) / 7 + noise[i])
    })(),
    lifecycle,
    daysSinceActivity,
    periodDeltas: {
      followers: followerDelta,
      reach: spread(14),
      saves: spread(11),
      publishing: spread(7),
      acceptance: spread(5),
    },
  }
}

export const mockCustomers: CustomerRow[] = [
  ...seeds.map((s, i) => toCustomer(s, i)),
  ...Array.from({ length: 46 }, (_, i) => toCustomer(extraSeed(i + 8), i + 8)),
]

export interface FunnelStage {
  stage: string
  count: number
  /** Median time from entering this stage to completing it. */
  medianTime: string
  /** Where in the product the stage happens. */
  where: string
  /** Why people drop here, and when — from product events. */
  exits: { reason: string; where: string; count: number }[]
  returnRate: number
}

/** User-journey funnel (all customers) — entered counts per stage. */
export const mockFunnel: FunnelStage[] = [
  {
    stage: 'Account Created',
    count: 54,
    medianTime: '2 min',
    where: 'Sign-up form',
    exits: [],
    returnRate: 0,
  },
  {
    stage: 'Instagram Connected',
    count: 51,
    medianTime: '4 min',
    where: 'Connect account screen',
    exits: [
      { reason: 'Abandoned at Meta permission screen', where: 'Meta OAuth redirect', count: 2 },
      { reason: 'Closed before starting connection', where: 'Connect account screen', count: 1 },
    ],
    returnRate: 33,
  },
  {
    stage: 'Analysis Completed',
    count: 45,
    medianTime: '6 min',
    where: 'Account analysis (processing)',
    exits: [
      { reason: 'Left during analysis wait', where: 'Analysis progress screen', count: 4 },
      { reason: 'Analysis failed — private account', where: 'Analysis error state', count: 2 },
    ],
    returnRate: 50,
  },
  {
    stage: 'Review Mode Started',
    count: 41,
    medianTime: '1 day',
    where: 'Analysis results → review prompt',
    exits: [
      { reason: 'Viewed results, never opened review', where: 'Analysis results screen', count: 3 },
      { reason: 'Postponed review from the prompt', where: 'Review mode prompt', count: 1 },
    ],
    returnRate: 25,
  },
  {
    stage: 'Review Mode Completed',
    count: 39,
    medianTime: '11 min',
    where: 'Review mode (brand questions)',
    exits: [
      { reason: 'Stopped at brand tone questions', where: 'Review step 4 of 7', count: 2 },
    ],
    returnRate: 50,
  },
  {
    stage: 'First Content Published',
    count: 31,
    medianTime: '5 days',
    where: 'Weekly route → publish',
    exits: [
      { reason: 'Accepted content but never published', where: 'Content review screen', count: 5 },
      { reason: 'Rejected all first-week suggestions', where: 'Weekly route', count: 3 },
    ],
    returnRate: 12,
  },
]

export const mockAdoption = {
  delivered: 128,
  accepted: 87,
  edited: 44,
  rejected: 12,
  published: 79,
}
