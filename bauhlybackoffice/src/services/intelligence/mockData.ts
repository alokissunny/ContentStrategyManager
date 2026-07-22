import type { Finding, PatternMovement, SampleContext } from '../../types'

/*
 * Handcrafted mock dataset for Phase 4, mirroring the approved dashboard
 * mockups (Atelier Dawn cohort, Spain, 5K–20K, comparable 20–30).
 *
 * Shaped exactly like the Phase 2 schemas — a test validates every record
 * against them — so swapping in real analysis output later is a repository
 * change, not a UI change. Numbers are plausible but fictional; the UI
 * labels the phase as mock data.
 */

const baseSample: SampleContext = {
  accountsAnalyzed: 27,
  postsAnalyzed: 1842,
  dateRange: { from: '2026-05-20', to: '2026-06-20' },
  locations: [{ country: 'Spain', region: null, city: null }],
  followerRange: { min: 5000, max: 20000 },
  comparisonGroupLabel: 'Comparable (20–30)',
  lastCollectionDate: '2026-06-21T06:00:00Z',
}

const LIMITATION_PAID =
  'Private reach, saves, shares and advertising influence are unknown.'

function makeFinding(
  partial: Pick<
    Finding,
    'id' | 'title' | 'explanation' | 'authorityPillar' | 'focusValue' | 'comparisonValue'
  > &
    Partial<Finding>,
): Finding {
  return {
    kind: 'stronger-account-difference',
    dimension: 'content-type',
    valueUnit: 'percent-of-posts',
    metricDefinition:
      'Percentage of relevant posts showing this behavior within the selected account group.',
    sample: baseSample,
    evidenceStrength: 'moderate',
    evidenceKinds: ['observed-public-fact', 'ai-classification', 'calculated-metric'],
    limitations: [LIMITATION_PAID],
    paidDistributionUncertainty: true,
    exampleAccountIds: ['comp-atelierdawn', 'comp-nordic'],
    examplePostIds: [],
    recommendationReady: false,
    recommendationReadyReasons: [],
    reproducibilityNote: null,
    suggestedExperiment: null,
    relevantCustomerIds: ['cust-atelierdawn'],
    humanReviewed: false,
    detectedAt: '2026-06-21T06:30:00Z',
    ...partial,
  }
}

export const mockFindings: Finding[] = [
  makeFinding({
    id: 'find-design-decisions',
    title: 'Explain design decisions more often',
    explanation:
      'High-performing peers publish posts explaining why a design decision was made far more often than the comparison group.',
    authorityPillar: 'credibility',
    focusValue: 22,
    comparisonValue: 8,
    evidenceStrength: 'strong',
    recommendationReady: true,
    recommendationReadyReasons: [
      'Supported by 9 of 12 high-performing accounts',
      '186 relevant posts across the group',
      'Not driven by a single outlier account',
    ],
    reproducibilityNote: 'Any customer with completed projects can reproduce this behavior.',
    suggestedExperiment: 'Add one design-decision post per week for 4 weeks.',
    humanReviewed: true,
  }),
  makeFinding({
    id: 'find-educational-carousels',
    title: 'Use educational carousels consistently',
    explanation:
      'Educational carousels appear consistently in high-performing accounts and are increasing month over month.',
    authorityPillar: 'credibility',
    focusValue: 31,
    comparisonValue: 14,
    evidenceStrength: 'strong',
    dimension: 'format',
    recommendationReady: true,
    recommendationReadyReasons: [
      'Used by 11 accounts',
      'Consistent across three consecutive months',
    ],
    suggestedExperiment: 'Publish one educational carousel per week tied to a current project.',
    humanReviewed: true,
  }),
  makeFinding({
    id: 'find-strong-hook',
    title: 'Open with a strong hook',
    explanation:
      'Posts from high-performing peers open with an identifiable hook (problem, question, contrarian statement) far more often.',
    authorityPillar: 'discovery',
    focusValue: 41,
    comparisonValue: 19,
    dimension: 'hook',
    evidenceStrength: 'moderate',
    recommendationReady: true,
    recommendationReadyReasons: ['Pattern holds across 14 accounts'],
    suggestedExperiment: 'Rewrite next week’s openers using the problem + consequence structure.',
  }),
  makeFinding({
    id: 'find-process',
    title: 'Show process behind the project',
    explanation:
      'Process and work-in-progress content is meaningfully more common among stronger accounts.',
    authorityPillar: 'trust',
    focusValue: 26,
    comparisonValue: 11,
    evidenceStrength: 'moderate',
    recommendationReady: false,
  }),
  makeFinding({
    id: 'find-consistency',
    title: 'Post with higher weekly consistency',
    explanation:
      'High-performing peers publish 4.1 posts per week versus 2.3 in the comparison group.',
    authorityPillar: 'discovery',
    focusValue: 4.1,
    comparisonValue: 2.3,
    valueUnit: 'per-week',
    dimension: 'posting-frequency',
    metricDefinition: 'Median posts per week within the selected account group.',
    evidenceStrength: 'exploratory',
    recommendationReady: false,
    limitations: [
      LIMITATION_PAID,
      'Posting frequency alone does not explain performance differences.',
    ],
  }),
]

/*
 * Which account sizes each finding applies to. What separates a 2K account
 * from its peers is not what separates a 60K one, so the list itself changes
 * with the follower range rather than only the numbers moving.
 */
export type SizeBand = 'small' | 'mid' | 'large'

export const findingBands: Record<string, SizeBand[]> = {
  'find-design-decisions': ['small', 'mid', 'large'],
  'find-educational-carousels': ['small', 'mid'],
  'find-strong-hook': ['mid', 'large'],
  'find-process': ['small', 'mid'],
  'find-consistency': ['small', 'mid'],
  'find-reply-questions': ['small'],
  'find-fixed-rhythm': ['small'],
  'find-reels-reach': ['large'],
  'find-series': ['large'],
  'find-collabs': ['large'],
}

export const extraFindings: Finding[] = [
  makeFinding({
    id: 'find-reply-questions',
    title: 'Answer beginner questions directly',
    explanation:
      'At this size, accounts that answer the questions prospects actually ask outgrow those posting finished work only.',
    authorityPillar: 'credibility',
    focusValue: 29,
    comparisonValue: 11,
    evidenceStrength: 'moderate',
  }),
  makeFinding({
    id: 'find-fixed-rhythm',
    title: 'Publish on a fixed weekly rhythm',
    explanation:
      'Small accounts that post on the same days each week grow faster than those posting more often but irregularly.',
    authorityPillar: 'discovery',
    focusValue: 3.0,
    comparisonValue: 1.6,
    valueUnit: 'per-week',
    dimension: 'posting-frequency',
    metricDefinition: 'Median posts per week within the selected account group.',
    evidenceStrength: 'moderate',
  }),
  makeFinding({
    id: 'find-reels-reach',
    title: 'Lean on Reels for non-follower reach',
    explanation:
      'Larger accounts get most of their new audience from Reels; carousels mainly reach people who already follow them.',
    authorityPillar: 'discovery',
    focusValue: 44,
    comparisonValue: 21,
    dimension: 'format',
    evidenceStrength: 'strong',
  }),
  makeFinding({
    id: 'find-series',
    title: 'Run a recurring content series',
    explanation:
      'Named, repeating series appear in most larger high performers and almost never in the comparison group.',
    authorityPillar: 'credibility',
    focusValue: 38,
    comparisonValue: 9,
    evidenceStrength: 'moderate',
  }),
  makeFinding({
    id: 'find-collabs',
    title: 'Collaborate with adjacent studios and brands',
    explanation:
      'Collaboration posts are common among larger high performers and rare below this size band.',
    authorityPillar: 'trust',
    focusValue: 26,
    comparisonValue: 7,
    evidenceStrength: 'exploratory',
  }),
]

function makeMovement(
  partial: Pick<
    PatternMovement,
    'id' | 'dimension' | 'pattern' | 'previousValue' | 'currentValue' | 'state'
  > &
    Partial<PatternMovement>,
): PatternMovement {
  const changePp =
    partial.previousValue != null && partial.currentValue != null
      ? Math.round((partial.currentValue - partial.previousValue) * 10) / 10
      : null
  return {
    changePp,
    metricDefinition:
      'Percentage of relevant posts using this pattern within the selected account group.',
    relativePerformance: null,
    sample: baseSample,
    evidenceStrength: 'moderate',
    ...partial,
  }
}

export const mockMovements: PatternMovement[] = [
  makeMovement({ id: 'mv-reels-vo', dimension: 'format', pattern: 'Reels (Voice-over)', previousValue: 19, currentValue: 27, state: 'strengthening' }),
  makeMovement({ id: 'mv-carousel-edu', dimension: 'format', pattern: 'Carousels (Educational)', previousValue: 24, currentValue: 31, state: 'strengthening', evidenceStrength: 'strong' }),
  makeMovement({ id: 'mv-before-after', dimension: 'format', pattern: 'Before & After', previousValue: 18, currentValue: 18, state: 'stable' }),
  makeMovement({ id: 'mv-single-image', dimension: 'format', pattern: 'Single Image (Text)', previousValue: 13, currentValue: 9, state: 'weakening' }),
  makeMovement({ id: 'mv-lifestyle', dimension: 'format', pattern: 'Lifestyle / Personal', previousValue: 9, currentValue: 6, state: 'weakening' }),
  makeMovement({ id: 'mv-topic-materials', dimension: 'topic', pattern: 'Materials & finishes', previousValue: 12, currentValue: 17, state: 'emerging' }),
  makeMovement({ id: 'mv-topic-budget', dimension: 'topic', pattern: 'Budget & cost decisions', previousValue: 7, currentValue: 11, state: 'emerging', evidenceStrength: 'exploratory' }),
  makeMovement({ id: 'mv-topic-kitchen', dimension: 'topic', pattern: 'Kitchen projects', previousValue: 22, currentValue: 21, state: 'stable' }),
  makeMovement({ id: 'mv-topic-smallspace', dimension: 'topic', pattern: 'Small spaces', previousValue: 14, currentValue: 10, state: 'weakening' }),
  makeMovement({ id: 'mv-hook-problem', dimension: 'hook', pattern: 'Problem + Consequence', previousValue: 18, currentValue: 24, state: 'strengthening', evidenceStrength: 'strong' }),
  makeMovement({ id: 'mv-hook-question', dimension: 'hook', pattern: 'Question hook', previousValue: 19, currentValue: 21, state: 'stable' }),
  makeMovement({ id: 'mv-hook-reveal', dimension: 'hook', pattern: 'Generic reveal', previousValue: 23, currentValue: 11, state: 'saturated' }),
  makeMovement({ id: 'mv-cap-edu', dimension: 'caption-structure', pattern: 'Educational explanation', previousValue: 26, currentValue: 31, state: 'strengthening' }),
  makeMovement({ id: 'mv-cap-story', dimension: 'caption-structure', pattern: 'Project story', previousValue: 20, currentValue: 22, state: 'stable' }),
  makeMovement({ id: 'mv-cap-hashtag', dimension: 'caption-structure', pattern: 'Hashtag-only caption', previousValue: 9, currentValue: 5, state: 'disappearing' }),
  makeMovement({ id: 'mv-pillar-cred', dimension: 'authority-pillar', pattern: 'Credibility', previousValue: 29, currentValue: 34, state: 'strengthening' }),
  makeMovement({ id: 'mv-pillar-disc', dimension: 'authority-pillar', pattern: 'Discovery', previousValue: 31, currentValue: 30, state: 'stable' }),
  makeMovement({ id: 'mv-pillar-trust', dimension: 'authority-pillar', pattern: 'Trust', previousValue: 22, currentValue: 24, state: 'stable' }),
  makeMovement({ id: 'mv-day-wed', dimension: 'posting-day', pattern: 'Wednesday publishing', previousValue: 16, currentValue: 19, state: 'strengthening', evidenceStrength: 'exploratory' }),
  makeMovement({ id: 'mv-day-sun', dimension: 'posting-day', pattern: 'Sunday publishing', previousValue: 11, currentValue: 8, state: 'weakening', evidenceStrength: 'exploratory' }),
  makeMovement({ id: 'mv-time-morning', dimension: 'posting-time', pattern: '10:00–12:00 publishing', previousValue: 33, currentValue: 38, state: 'strengthening', evidenceStrength: 'exploratory' }),
  makeMovement({ id: 'mv-time-evening', dimension: 'posting-time', pattern: '19:00–21:00 publishing', previousValue: 21, currentValue: 18, state: 'stable', evidenceStrength: 'exploratory' }),
]

/* View models for sections whose real analysis arrives in later phases. */

export interface HookPerformanceRow {
  hookType: string
  structure: string
  useRate: number
  medianEngagement: number
  trend: 'up' | 'down' | 'flat'
  pillar: 'discovery' | 'credibility' | 'trust'
}

export const mockHooks: HookPerformanceRow[] = [
  { hookType: 'Problem + Consequence', structure: '“Most [rooms] fail because… and it costs you…”', useRate: 24, medianEngagement: 2.8, trend: 'up', pillar: 'discovery' },
  { hookType: 'Question hook', structure: '“Would you have kept this wall?”', useRate: 21, medianEngagement: 2.4, trend: 'up', pillar: 'discovery' },
  { hookType: 'Contrarian statement', structure: '“White walls are not neutral.”', useRate: 17, medianEngagement: 2.6, trend: 'up', pillar: 'credibility' },
  { hookType: 'Transformation / Result', structure: '“From unusable corner to reading nook.”', useRate: 15, medianEngagement: 2.7, trend: 'flat', pillar: 'trust' },
  { hookType: 'Common mistake', structure: '“The lighting mistake in almost every rental.”', useRate: 11, medianEngagement: 2.1, trend: 'down', pillar: 'credibility' },
]

export interface WeeklyDayObservation {
  day: string
  pillar: 'discovery' | 'credibility' | 'trust'
  pillarLabel: string
  contentType: string
  format: 'carousel' | 'reel' | 'image'
  accounts: number
  posts: number
  medianTime: string
}

export const mockWeekly: WeeklyDayObservation[] = [
  { day: 'Mon', pillar: 'trust', pillarLabel: 'Trust', contentType: 'Project context', format: 'carousel', accounts: 27, posts: 312, medianTime: '10:00' },
  { day: 'Tue', pillar: 'credibility', pillarLabel: 'Credibility', contentType: 'Educational', format: 'carousel', accounts: 25, posts: 298, medianTime: '11:00' },
  { day: 'Wed', pillar: 'discovery', pillarLabel: 'Discovery', contentType: 'Transformation', format: 'reel', accounts: 26, posts: 356, medianTime: '12:00' },
  { day: 'Thu', pillar: 'credibility', pillarLabel: 'Credibility', contentType: 'Process / Decision', format: 'reel', accounts: 26, posts: 301, medianTime: '11:30' },
  { day: 'Fri', pillar: 'trust', pillarLabel: 'Trust', contentType: 'Founder / Team', format: 'reel', accounts: 22, posts: 214, medianTime: '12:30' },
  { day: 'Sat', pillar: 'trust', pillarLabel: 'Trust', contentType: 'Client story', format: 'image', accounts: 15, posts: 142, medianTime: '11:00' },
  { day: 'Sun', pillar: 'discovery', pillarLabel: 'Discovery', contentType: 'Inspiration', format: 'image', accounts: 13, posts: 118, medianTime: '10:30' },
]

export interface CustomerOverviewMock {
  medianChanges: { label: string; value: number; series: number[] }[]
  adoption: { label: string; value: number; tone: 'positive' | 'info' | 'negative' | 'accent' }[]
}

export const mockCustomerOverview: CustomerOverviewMock = {
  medianChanges: [
    { label: 'Followers', value: 1.8, series: [0.4, 0.7, 0.5, 1.1, 1.4, 1.8] },
    { label: 'Reach', value: 12.4, series: [3, 5, 4, 8, 10, 12.4] },
    { label: 'Saves', value: 9.6, series: [2, 4, 5, 6, 8, 9.6] },
    { label: 'Shares', value: 6.2, series: [1, 2, 3, 4, 5, 6.2] },
    { label: 'Comments', value: 5.1, series: [1, 3, 2, 4, 4.5, 5.1] },
  ],
  adoption: [
    { label: 'Published Rate', value: 62, tone: 'positive' },
    { label: 'Edited Rate', value: 34, tone: 'info' },
    { label: 'Rejected Rate', value: 18, tone: 'negative' },
  ],
}

/** Sparkline series for the summary cards (index-matched to card order). */
export const mockSummarySeries: number[][] = [
  [20, 22, 24, 25, 26, 27],
  [1500, 1580, 1640, 1700, 1780, 1842],
  [11, 12, 14, 15, 17, 18],
  [4, 5, 5, 6, 6, 7],
  [8, 9, 10, 11, 12, 12],
  [10, 11, 12, 13, 14, 14],
]

export interface TopicRow {
  topic: string
  /** Share of relevant posts in the selected group. */
  sharePct: number
  accounts: number
  posts: number
  changePp: number
  pillar: 'discovery' | 'credibility' | 'trust'
}

/** What comparable accounts are actually posting about, most to least. */
export const mockTopics: TopicRow[] = [
  { topic: 'Kitchen projects', sharePct: 21, accounts: 24, posts: 387, changePp: -1, pillar: 'discovery' },
  { topic: 'Materials & finishes', sharePct: 17, accounts: 22, posts: 313, changePp: 5, pillar: 'credibility' },
  { topic: 'Full-home renovation', sharePct: 14, accounts: 19, posts: 258, changePp: 2, pillar: 'trust' },
  { topic: 'Lighting decisions', sharePct: 12, accounts: 18, posts: 221, changePp: 4, pillar: 'credibility' },
  { topic: 'Budget & cost decisions', sharePct: 11, accounts: 15, posts: 203, changePp: 4, pillar: 'trust' },
  { topic: 'Small spaces', sharePct: 10, accounts: 16, posts: 184, changePp: -4, pillar: 'discovery' },
  { topic: 'Storage solutions', sharePct: 8, accounts: 13, posts: 147, changePp: 1, pillar: 'discovery' },
  { topic: 'Colour & palettes', sharePct: 7, accounts: 12, posts: 129, changePp: -2, pillar: 'brand' as 'discovery' },
  { topic: 'Client collaboration', sharePct: 6, accounts: 11, posts: 110, changePp: 3, pillar: 'trust' },
  { topic: 'Sustainability', sharePct: 4, accounts: 8, posts: 74, changePp: 2, pillar: 'credibility' },
]


export type TopicSource = 'instagram' | 'google-trends'

export interface TopicSourceMeta {
  id: TopicSource
  label: string
  /** What the numbers mean for this source. */
  metricLabel: string
  definition: string
  connected: boolean
}

export const topicSources: TopicSourceMeta[] = [
  {
    id: 'instagram',
    label: 'Competitor posts',
    metricLabel: 'share of posts',
    definition:
      'Share of classified competitor posts mentioning the topic within the selected account group.',
    connected: true,
  },
  {
    id: 'google-trends',
    label: 'Search demand',
    metricLabel: 'search interest',
    definition:
      'What people search for in the selected location, via Google Trends. Demand, not supply — a topic can be in high demand while competitors barely post about it.',
    connected: false,
  },
]

/**
 * Search-interest ranking. Deliberately ordered differently from post share:
 * the gap between what competitors post and what people search for is the
 * point of showing both.
 */
export interface TrendTopicRow extends TopicRow {
  /** What the searcher is expressing. */
  intent: 'frustration' | 'desire'
  /** A representative query behind the topic. */
  query: string
}

export const mockTrendTopics: TrendTopicRow[] = [
  { topic: 'Renovation cost', sharePct: 24, accounts: 0, posts: 0, changePp: 9, pillar: 'trust', intent: 'frustration', query: 'how much does a kitchen reform really cost' },
  { topic: 'Small spaces', sharePct: 21, accounts: 0, posts: 0, changePp: 6, pillar: 'discovery', intent: 'desire', query: 'small flat design ideas' },
  { topic: 'Kitchen projects', sharePct: 19, accounts: 0, posts: 0, changePp: -2, pillar: 'discovery', intent: 'desire', query: 'modern kitchen inspiration' },
  { topic: 'Storage solutions', sharePct: 15, accounts: 0, posts: 0, changePp: 5, pillar: 'discovery', intent: 'frustration', query: 'not enough storage in my flat' },
  { topic: 'Choosing a designer', sharePct: 13, accounts: 0, posts: 0, changePp: 8, pillar: 'trust', intent: 'frustration', query: 'how to know if an interior designer is good' },
  { topic: 'Project delays', sharePct: 12, accounts: 0, posts: 0, changePp: 6, pillar: 'trust', intent: 'frustration', query: 'reform taking longer than promised' },
  { topic: 'Lighting decisions', sharePct: 11, accounts: 0, posts: 0, changePp: 3, pillar: 'credibility', intent: 'frustration', query: 'why does my lighting look bad' },
  { topic: 'Sustainability', sharePct: 10, accounts: 0, posts: 0, changePp: 7, pillar: 'credibility', intent: 'desire', query: 'sustainable interior materials' },
  { topic: 'Materials & finishes', sharePct: 9, accounts: 0, posts: 0, changePp: 1, pillar: 'credibility', intent: 'desire', query: 'best worktop material' },
  { topic: 'Colour & palettes', sharePct: 7, accounts: 0, posts: 0, changePp: -3, pillar: 'discovery', intent: 'desire', query: 'warm neutral colour palette' },
]


/*
 * Hashtag usage.
 *
 * A scrape gives us the captions of the posts we collect, so what we can state
 * honestly is which accounts use a hashtag and how consistently — not what
 * reach it produced, which Instagram never exposes for other people's posts.
 * Ranking is therefore by how much more high performers use a tag than the
 * rest of the group, not by raw frequency, which would mostly surface generic
 * category tags everyone uses.
 */
export interface HashtagRow {
  tag: string
  type: 'Category' | 'Local' | 'Niche' | 'Branded'
  /** High-performing accounts using it, of those scraped. */
  highPerformerAccounts: number
  /** Accounts in the rest of the comparable group using it. */
  comparisonAccounts: number
}

export const mockHashtags: HashtagRow[] = [
  { tag: '#antesydespues', type: 'Niche', highPerformerAccounts: 10, comparisonAccounts: 3 },
  { tag: '#materialesnaturales', type: 'Niche', highPerformerAccounts: 9, comparisonAccounts: 2 },
  { tag: '#proyectosdediseno', type: 'Niche', highPerformerAccounts: 9, comparisonAccounts: 4 },
  { tag: '#reformaintegral', type: 'Category', highPerformerAccounts: 11, comparisonAccounts: 7 },
  { tag: '#cocinasmodernas', type: 'Category', highPerformerAccounts: 8, comparisonAccounts: 5 },
  { tag: '#interiorismobarcelona', type: 'Local', highPerformerAccounts: 7, comparisonAccounts: 3 },
  { tag: '#estudiodeinteriorismo', type: 'Branded', highPerformerAccounts: 7, comparisonAccounts: 4 },
  { tag: '#interiorismovalencia', type: 'Local', highPerformerAccounts: 5, comparisonAccounts: 2 },
  { tag: '#interiorismo', type: 'Category', highPerformerAccounts: 12, comparisonAccounts: 13 },
  { tag: '#decoracion', type: 'Category', highPerformerAccounts: 6, comparisonAccounts: 11 },
]
