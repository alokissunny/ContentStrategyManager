import type { FilterState } from './filters'

/*
 * Caption Pattern Analysis — the honest core of the Competitors page.
 *
 * Everything here is derived from PUBLIC captions only. That constraint
 * defines what we may claim: frequency, prevalence, recurrence, distribution,
 * and change over time. It rules out anything about performance, reach, saves,
 * shares or conversion — none of which are observable for accounts we don't
 * own. The wording in this file (and the UI that renders it) stays on the
 * legal side of that line on purpose.
 *
 * Mock data for now; the shape is the contract the collector fills later.
 */

export type Pillar = 'discovery' | 'credibility' | 'trust'

/** Change over the compared window, stated as frequency — never performance. */
export interface PatternTrend {
  previousPct: number | null
  currentPct: number | null
  changePp: number | null
  /** Frequency language only. `inconclusive` when the sample is too thin. */
  state: 'increasing' | 'decreasing' | 'stable' | 'inconclusive'
  /** The two windows being compared, shown so a trend is never context-free. */
  previousWindow: string
  currentWindow: string
}

export interface CaptionPattern {
  id: string
  rank: number
  name: string
  /** One-line summary shown on the collapsed row. */
  summary: string
  pillar: Pillar
  /** Distinct competitors whose captions match this pattern. */
  competitors: number
  /** Matching captions across the analyzed set. */
  captions: number
  /** Share of all analyzed captions. */
  sharePct: number
  trend: PatternTrend
  /** Expanded detail. */
  whatWeDetected: string
  whyItMatters: string
  /** The recurring shape of the caption: each step with a one-line gloss. */
  structure: { step: string; detail: string }[]
  /** Why THIS pattern sits under its pillar — specific, not a generic line. */
  pillarReason: string
  /**
   * A real caption from the analyzed set. Null when none has been surfaced —
   * the UI shows an unavailable state rather than inventing one, because a
   * fabricated "representative" caption would misrepresent the dataset.
   */
  example: { competitor: string; caption: string } | null
  /**
   * Real matching captions resolved from analyzed posts (a sample, not the full
   * set). Populated by the backend; the "view all matching captions" page reads
   * this. Empty when the analysis hasn't surfaced any — never fabricated.
   */
  exampleCaptions?: { competitor: string; caption: string }[]
}

/** A frequency ranking row for formats, days or times. Never a performance rank. */
export interface RankRow {
  id: string
  rank: number
  label: string
  competitors: number
  posts: number
  sharePct: number
  previousPct: number | null
  currentPct: number | null
  changePp: number | null
  state: PatternTrend['state']
  /** For the day rows only: the time range that day is busiest. */
  peakTime?: string
}

export interface CaptionAnalysis {
  kpis: {
    competitors: number
    captions: number
    patternsDetected: number
  }
  /** The comparison windows, surfaced with every trend. */
  windows: { previous: string; current: string }
  patterns: CaptionPattern[]
  formats: RankRow[]
  days: RankRow[]
  times: RankRow[]
  /**
   * Format / day rankings computed within each pillar's own posts, so filtering
   * by pillar shows which formats and days work for Discovery / Credibility /
   * Trust — not the global list re-scaled. The active pillar's list is swapped
   * into `formats` / `days` when a pillar filter is applied.
   */
  formatsByPillar?: Record<Pillar, RankRow[]>
  daysByPillar?: Record<Pillar, RankRow[]>
}

const PILLAR_LABEL: Record<Pillar, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

export const pillarLabel = (p: Pillar) => PILLAR_LABEL[p]

/**
 * Empty caption analysis grounded in real summary counts — used when a live
 * report has no captionAnalysis yet. Never invents patterns or format rows.
 */
export function emptyCaptionAnalysis(
  summary: { accountsAnalyzed: number; postsAnalyzed: number },
  period: FilterState['period'],
): CaptionAnalysis {
  return {
    kpis: {
      competitors: summary.accountsAnalyzed,
      captions: summary.postsAnalyzed,
      patternsDetected: 0,
    },
    windows: WINDOWS[period],
    patterns: [],
    formats: [],
    days: [],
    times: [],
  }
}

/** A catalogue entry: the pattern minus the fields computed per filter. */
type PatternSeed = Omit<CaptionPattern, 'rank' | 'trend'> & {
  base: { competitors: number; captions: number; sharePct: number; changePp: number }
}

/** Base pattern catalogue. Absolute counts are scaled by the active filters. */
const PATTERNS: PatternSeed[] = [
  {
    id: 'educational-misconception',
    name: 'Educational Misconception',
    summary: 'Correcting a common misconception before explaining the reasoning.',
    pillar: 'discovery',
    competitors: 68,
    captions: 542,
    sharePct: 21.7,
    whatWeDetected:
      'Competitors frequently open by challenging a widely held belief or assumption, then explain why it is not always true, often using a real project as proof.',
    whyItMatters:
      'This pattern is commonly used to educate potential clients while demonstrating professional expertise and building authority.',
    structure: [
      { step: 'Misconception', detail: 'The belief most readers already hold' },
      { step: 'Explanation', detail: 'Why it does not always hold up' },
      { step: 'Real project or example', detail: 'Proof from work they have done' },
      { step: 'Practical takeaway', detail: 'What to do instead' },
    ],
    pillarReason:
      'Correcting a belief the reader already holds is what carries this post beyond the studio’s own followers — which is why it counts as Discovery rather than Credibility.',
    example: {
      competitor: 'Studio ABC',
      caption:
        'Many homeowners think removing walls always makes a home feel bigger.\n\nIn reality, too much openness can make a space feel less functional. In this apartment we kept one structural wall to define the living area while still improving the natural light.',
    },
    base: { competitors: 68, captions: 542, sharePct: 21.7, changePp: 6 },
  },
  {
    id: 'client-stories',
    name: 'Client Stories',
    summary: 'Sharing a client challenge and the design solution.',
    pillar: 'trust',
    competitors: 52,
    captions: 318,
    sharePct: 12.7,
    whatWeDetected:
      'Competitors describe a specific client situation and the constraints it created, then walk through how the design responded to it.',
    whyItMatters:
      'Telling a real client story is commonly used to make the work relatable and to show how the studio handles real-world constraints.',
    structure: [
      { step: 'Client situation', detail: 'Who they were and what they needed' },
      { step: 'Constraint or challenge', detail: 'What made the brief hard' },
      { step: 'Design response', detail: 'What the studio actually did' },
      { step: 'Outcome in context', detail: 'How it worked for that client' },
    ],
    pillarReason:
      'Naming a real client and the constraints they lived with is what makes the studio feel dependable, so this sits under Trust.',
    example: {
      competitor: 'Norte Interiors',
      caption:
        'They had a 12m² kitchen and three kids.\n\nEverything had to earn its place. We built storage into the bench seating and kept one open shelf for the things they actually reach for daily.',
    },
    base: { competitors: 52, captions: 318, sharePct: 12.7, changePp: 2 },
  },
  {
    id: 'behind-the-decision',
    name: 'Behind the Decision',
    summary: 'Explaining the reasoning behind a key design choice.',
    pillar: 'credibility',
    competitors: 46,
    captions: 267,
    sharePct: 10.7,
    whatWeDetected:
      'Competitors single out one concrete design decision and explain why it was made, usually weighing it against the obvious alternative.',
    whyItMatters:
      'Showing the reasoning behind a choice is commonly used to demonstrate expertise without claiming a result.',
    structure: [
      { step: 'The decision', detail: 'The specific choice that was made' },
      { step: 'The alternative considered', detail: 'What was weighed against it' },
      { step: 'Why this choice', detail: 'The reasoning behind it' },
      { step: 'What it achieves', detail: 'The effect on the finished space' },
    ],
    pillarReason:
      'Showing the reasoning behind a choice — not just the result — is a direct display of professional judgement, which is why this is Credibility.',
    example: {
      competitor: 'Atelier Casa',
      caption:
        'We chose oak over walnut here — and it was not about cost.\n\nThe room faces north and loses light early. The warmer grain keeps it from feeling cold in the evenings.',
    },
    base: { competitors: 46, captions: 267, sharePct: 10.7, changePp: -1 },
  },
  {
    id: 'design-lessons',
    name: 'Design Lessons',
    summary: 'Teaching a practical lesson or tip.',
    pillar: 'discovery',
    competitors: 44,
    captions: 231,
    sharePct: 9.2,
    whatWeDetected:
      'Competitors share a single practical, reusable tip framed as something the reader can apply themselves.',
    whyItMatters:
      'A concrete, usable tip is commonly used to give the audience a reason to save and follow the account.',
    structure: [
      { step: 'The lesson', detail: 'The tip stated in one line' },
      { step: 'Why it works', detail: 'The principle behind it' },
      { step: 'How to apply it', detail: 'What the reader can do at home' },
    ],
    pillarReason:
      'A tip that stands on its own gets saved and passed on by people who do not follow the studio, which is what makes it Discovery.',
    example: {
      competitor: 'Forma Living',
      caption:
        'Hang art lower than you think.\n\nMost people hang it too high. Centre it around 145cm from the floor and the whole wall settles.',
    },
    base: { competitors: 44, captions: 231, sharePct: 9.2, changePp: 3 },
  },
  {
    id: 'before-after-narrative',
    name: 'Before & After Narrative',
    summary: 'Showing the transformation with context.',
    pillar: 'trust',
    competitors: 37,
    captions: 201,
    sharePct: 8.0,
    whatWeDetected:
      'Competitors pair a before-and-after with the story of what changed and why, rather than posting the reveal alone.',
    whyItMatters:
      'Adding context to a transformation is commonly used to make the change legible instead of purely visual.',
    structure: [
      { step: 'Starting point', detail: 'What the space was like before' },
      { step: 'What changed', detail: 'The work that was carried out' },
      { step: 'The reasoning', detail: 'Why those changes and not others' },
      { step: 'Result in context', detail: 'How the space lives now' },
    ],
    pillarReason:
      'Pairing the transformation with the reasoning is evidence the studio delivers what it promises, which is why it counts as Trust.',
    example: {
      competitor: 'Volta Estudio',
      caption:
        'Same corner, eleven weeks apart.\n\nWe moved one wall to borrow light from the hallway. Nothing else structural changed — the rest is paint, storage and restraint.',
    },
    base: { competitors: 37, captions: 201, sharePct: 8.0, changePp: -2 },
  },
  {
    id: 'expert-explainer',
    name: 'Expert Explainer',
    summary: 'Explaining a technical topic in plain language.',
    pillar: 'credibility',
    competitors: 33,
    captions: 178,
    sharePct: 7.1,
    whatWeDetected:
      'Competitors take a technical subject — lighting temperature, material wear, acoustics — and explain it in accessible terms with visuals.',
    whyItMatters:
      'Plain-language explainers are commonly used to signal depth of knowledge to a non-expert audience.',
    structure: [
      { step: 'The technical topic', detail: 'The subject being explained' },
      { step: 'Why it matters', detail: 'What it affects in their home' },
      { step: 'Plain explanation', detail: 'The concept without jargon' },
      { step: 'What to do with it', detail: 'How to use the knowledge' },
    ],
    pillarReason:
      'Making a technical subject understandable is the clearest way to show depth of knowledge, so this belongs to Credibility.',
    example: {
      competitor: 'Lumen Casa',
      caption:
        'Colour temperature, in one photo set.\n\n2700K feels like candlelight, 4000K like a bright office. Most homes want the warmer end everywhere except the kitchen.',
    },
    base: { competitors: 33, captions: 178, sharePct: 7.1, changePp: 4 },
  },
  {
    id: 'process-walkthrough',
    name: 'Process Walkthrough',
    summary: 'Showing how a project moves from brief to finish.',
    pillar: 'credibility',
    competitors: 29,
    captions: 141,
    sharePct: 5.6,
    whatWeDetected:
      'Competitors document the stages of a project — brief, plan, build, finish — often across an in-progress site.',
    whyItMatters:
      'Showing process is commonly used to make the work feel considered and to set expectations for prospective clients.',
    structure: [
      { step: 'Brief', detail: 'What the client asked for' },
      { step: 'Plan', detail: 'How the studio approached it' },
      { step: 'Build', detail: 'The work while it is in progress' },
      { step: 'Finish', detail: 'The completed result' },
    ],
    pillarReason:
      'Showing how the work is actually done — not only how it ends — evidences competence, which places this under Credibility.',
    example: null,
    base: { competitors: 29, captions: 141, sharePct: 5.6, changePp: 1 },
  },
  {
    id: 'testimonial-feature',
    name: 'Testimonial Feature',
    summary: "Featuring a client's own words about the work.",
    pillar: 'trust',
    competitors: 21,
    captions: 96,
    sharePct: 3.8,
    whatWeDetected:
      "Competitors quote a client directly about their experience, usually alongside a finished photo of the project.",
    whyItMatters:
      'A first-person client quote is commonly used to add credibility that the studio cannot claim about itself.',
    structure: [
      { step: 'Client quote', detail: 'The client’s own words' },
      { step: 'Project context', detail: 'What the work involved' },
      { step: 'Finished result', detail: 'The space they are describing' },
    ],
    pillarReason:
      'A claim made by the client rather than by the studio is the strongest reassurance available, so this is Trust.',
    example: null,
    base: { competitors: 21, captions: 96, sharePct: 3.8, changePp: -1 },
  },
  {
    id: 'trend-commentary',
    name: 'Trend Commentary',
    summary: 'Commenting on design trends and directions.',
    pillar: 'discovery',
    competitors: 14,
    captions: 63,
    sharePct: 2.5,
    whatWeDetected:
      'Competitors take a position on a current design trend — endorsing, questioning, or reframing it.',
    whyItMatters:
      'Commentary on a trend is commonly used to enter an active conversation and show a point of view.',
    structure: [
      { step: 'The trend', detail: 'What is being discussed right now' },
      { step: 'Their position', detail: 'Where the studio stands on it' },
      { step: 'The reasoning', detail: 'Why they take that view' },
    ],
    pillarReason:
      'Joining a conversation people are already searching for puts the studio in front of audiences who have not met it, which is Discovery.',
    example: null,
    base: { competitors: 14, captions: 63, sharePct: 2.5, changePp: 2 },
  },
]

const FORMATS = [
  { id: 'carousel', label: 'Carousel', competitors: 74, posts: 1180, sharePct: 34.2, changePp: 3 },
  { id: 'reel', label: 'Reel', competitors: 66, posts: 902, sharePct: 26.1, changePp: 5 },
  { id: 'single-image', label: 'Single image', competitors: 58, posts: 741, sharePct: 21.5, changePp: -4 },
  { id: 'video', label: 'Video', competitors: 31, posts: 402, sharePct: 11.7, changePp: 2 },
  { id: 'multi-image', label: 'Multi-image post', competitors: 22, posts: 224, sharePct: 6.5, changePp: -1 },
]

const DAYS = [
  { id: 'tue', label: 'Tuesday', peakTime: '10:00–12:00', competitors: 71, posts: 612, sharePct: 17.8, changePp: 2 },
  { id: 'wed', label: 'Wednesday', peakTime: '10:00–12:00', competitors: 69, posts: 588, sharePct: 17.1, changePp: 3 },
  { id: 'thu', label: 'Thursday', peakTime: '18:00–20:00', competitors: 64, posts: 551, sharePct: 16.0, changePp: 1 },
  { id: 'fri', label: 'Friday', peakTime: '12:00–14:00', competitors: 58, posts: 494, sharePct: 14.4, changePp: -1 },
  { id: 'mon', label: 'Monday', peakTime: '18:00–20:00', competitors: 52, posts: 441, sharePct: 12.8, changePp: 0 },
  { id: 'sat', label: 'Saturday', peakTime: '10:00–12:00', competitors: 40, posts: 388, sharePct: 11.3, changePp: -2 },
  { id: 'sun', label: 'Sunday', peakTime: '12:00–14:00', competitors: 33, posts: 366, sharePct: 10.6, changePp: -1 },
]

const TIMES = [
  { id: 't-10-12', label: '10:00–12:00', competitors: 63, posts: 724, sharePct: 24.6, changePp: 4 },
  { id: 't-18-20', label: '18:00–20:00', competitors: 59, posts: 656, sharePct: 22.3, changePp: 2 },
  { id: 't-12-14', label: '12:00–14:00', competitors: 47, posts: 512, sharePct: 17.4, changePp: -1 },
  { id: 't-08-10', label: '08:00–10:00', competitors: 38, posts: 401, sharePct: 13.6, changePp: 1 },
  { id: 't-20-22', label: '20:00–22:00', competitors: 34, posts: 356, sharePct: 12.1, changePp: -2 },
  { id: 't-14-16', label: '14:00–16:00', competitors: 26, posts: 289, sharePct: 9.8, changePp: -1 },
]

/** Windows shown alongside every trend so a change is never context-free. */
const WINDOWS: Record<FilterState['period'], { previous: string; current: string }> = {
  'last-30': { previous: '31–60 days ago', current: 'Last 30 days' },
  'previous-30': { previous: '61–90 days ago', current: '31–60 days ago' },
  'last-90': { previous: 'Prior 90 days', current: 'Last 90 days' },
  'last-180': { previous: 'Prior 6 months', current: 'Last 6 months' },
  'last-365': { previous: 'Prior 12 months', current: 'Last 12 months' },
  'month-over-month': { previous: 'Previous month', current: 'This month' },
  all: { previous: 'Earlier history', current: 'All time' },
}

/** "12K – 18K" → its midpoint in followers, or null if not a custom label. */
function parseCustomRange(label: string): number | null {
  const m = label.match(/^([\d.]+)(K?)\s*[–-]\s*([\d.]+)(K?)$/)
  if (!m) return null
  const lo = Number(m[1]) * (m[2] ? 1000 : 1)
  const hi = Number(m[3]) * (m[4] ? 1000 : 1)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null
  return (lo + hi) / 2
}

/** Deterministic follower-range scaling so counts move with the filter. */
function rangeScale(label: string): number {
  // A typed range scales from its midpoint on the same curve as the presets:
  // the mid brackets hold the most accounts, the extremes the fewest.
  const mid = parseCustomRange(label)
  if (mid != null) {
    if (mid < 1000) return 0.55
    if (mid < 5000) return 0.75
    if (mid < 20000) return 0.95
    if (mid < 50000) return 0.65
    return 0.45
  }

  const map: Record<string, number> = {
    'All sizes': 1,
    'Under 1K': 0.55,
    '1K – 3K': 0.7,
    '3K – 5K': 0.8,
    '5K – 10K': 0.9,
    '5K – 20K': 1,
    '10K – 15K': 0.85,
    '15K – 20K': 0.75,
    '20K – 50K': 0.65,
    'Over 50K': 0.45,
  }
  return map[label] ?? 1
}

/** Share of analyzed captions that fall in each pillar. Used to scale by pillar. */
const PILLAR_SHARE: Record<Pillar, number> = { discovery: 0.44, credibility: 0.32, trust: 0.24 }

/**
 * A trend is only stated when the sample supports it. Below this many matching
 * captions we report `inconclusive` rather than a confident direction — a small
 * sample cannot carry a trend.
 */
const MIN_CAPTIONS_FOR_TREND = 40

function trendState(changePp: number, captions: number): PatternTrend['state'] {
  if (captions < MIN_CAPTIONS_FOR_TREND) return 'inconclusive'
  if (Math.abs(changePp) < 1) return 'stable'
  return changePp > 0 ? 'increasing' : 'decreasing'
}

function makeTrend(
  currentPct: number,
  changePp: number,
  captions: number,
  windows: { previous: string; current: string },
): PatternTrend {
  const state = trendState(changePp, captions)
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
  return {
    previousPct: Math.round((currentPct - changePp) * 10) / 10,
    currentPct: Math.round(currentPct * 10) / 10,
    changePp,
    state,
    previousWindow: windows.previous,
    currentWindow: windows.current,
  }
}

/**
 * Per-pillar emphasis so each pillar yields a genuinely different format / day
 * ranking (Discovery leans on Reels/weekends, Credibility on Carousels/midweek,
 * Trust on stills). Offline stand-in for the backend's real per-pillar counts.
 */
const PILLAR_FORMAT_WEIGHT: Record<Pillar, Record<string, number>> = {
  discovery: { reel: 1.7, video: 1.4, carousel: 1.05, 'single-image': 0.55, 'multi-image': 0.7 },
  credibility: { carousel: 1.6, 'single-image': 1.25, 'multi-image': 1.15, reel: 0.7, video: 0.85 },
  trust: { 'single-image': 1.55, 'multi-image': 1.3, carousel: 1.15, reel: 0.75, video: 0.7 },
}
const PILLAR_DAY_WEIGHT: Record<Pillar, Record<string, number>> = {
  discovery: { sat: 1.5, sun: 1.4, fri: 1.1, thu: 0.95, wed: 0.9, tue: 0.9, mon: 0.85 },
  credibility: { tue: 1.4, wed: 1.35, thu: 1.2, mon: 1.1, fri: 0.9, sat: 0.6, sun: 0.55 },
  trust: { thu: 1.3, mon: 1.2, fri: 1.15, tue: 1.0, wed: 0.95, sat: 0.85, sun: 0.8 },
}

/**
 * Largest-remainder allocation so parts sum exactly to `total`. Used so
 * Discovery + Credibility + Trust post counts equal the all-pillars total.
 */
export function allocateByWeights(weights: number[], total: number): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0)
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0)
  if (sumW <= 0) {
    const base = Math.floor(total / weights.length)
    const out = weights.map(() => base)
    for (let i = 0; i < total - base * weights.length; i++) out[i % out.length]! += 1
    return out
  }
  const exact = weights.map((w) => (Math.max(0, w) / sumW) * total)
  const floors = exact.map((x) => Math.floor(x))
  let rem = total - floors.reduce((s, n) => s + n, 0)
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (rem <= 0) break
    floors[i]! += 1
    rem -= 1
  }
  return floors
}

/** Caption volume attributed to a pillar — drives how many posts that pillar owns. */
export function pillarCaptionWeight(
  patterns: { pillar: Pillar; captions: number }[],
  pillar: Pillar,
): number {
  return patterns.filter((p) => p.pillar === pillar).reduce((s, p) => s + Math.max(0, p.captions), 0)
}

/**
 * Rescale a format/day ranking so its posts sum to `targetPosts`, preserving
 * relative mix. Claude only tags a sample of posts per pillar; without this
 * the per-pillar tables undercount and no longer add up to the all-pillars total.
 */
export function scaleRankRowsToTotal(rows: RankRow[], targetPosts: number, competitorCap: number): RankRow[] {
  if (targetPosts <= 0 || rows.length === 0) return []
  const weights = rows.map((r) => Math.max(0, r.posts))
  const samplePosts = weights.reduce((s, w) => s + w, 0) || 1
  const posts = allocateByWeights(weights, targetPosts)
  return rows
    .map((r, i) => {
      const p = posts[i]!
      const sharePct = Math.round((p / targetPosts) * 1000) / 10
      const competitors = Math.min(
        Math.max(1, competitorCap),
        Math.max(1, Math.round(r.competitors * (targetPosts / samplePosts))),
      )
      return {
        ...r,
        posts: p,
        sharePct,
        competitors,
        previousPct: null,
        currentPct: null,
        changePp: null,
        state: 'inconclusive' as const,
      }
    })
    .filter((r) => r.posts > 0)
    .sort((a, b) => b.sharePct - a.sharePct)
    .map((r, i) => ({ ...r, rank: i + 1 }))
}

export function getCaptionAnalysis(filters: FilterState): CaptionAnalysis {
  const windows = WINDOWS[filters.period]
  const scale = rangeScale(filters.followerRangeLabel)
  const pillarFilter = filters.pillar
  const pillarFactor = pillarFilter === 'all' ? 1 : PILLAR_SHARE[pillarFilter as Pillar] ?? 1

  const scaleCount = (n: number, extra = 1) => Math.max(1, Math.round(n * scale * extra))

  const patterns: CaptionPattern[] = PATTERNS.filter(
    (p) => pillarFilter === 'all' || p.pillar === pillarFilter,
  )
    .map((p) => ({
      ...p,
      competitors: scaleCount(p.base.competitors),
      captions: scaleCount(p.base.captions),
      sharePct: p.base.sharePct,
      trend: makeTrend(p.base.sharePct, p.base.changePp, scaleCount(p.base.captions), windows),
      // Offline we only have the single representative example — never the
      // fabricated sample list the old mock invented.
      exampleCaptions: p.example ? [p.example] : [],
    }))
    .sort((a, b) => b.sharePct - a.sharePct)
    .map((p, i) => ({ ...p, rank: i + 1 }))

  // Ranks a base row set, optionally re-weighted for a pillar so the ordering
  // and shares genuinely differ per pillar (not the same list re-scaled).
  const rankWeighted = (
    rows: {
      id: string
      label: string
      competitors: number
      posts: number
      sharePct: number
      changePp: number
      peakTime?: string
    }[],
    weight: Record<string, number> | null,
  ): RankRow[] => {
    const denom = rows.reduce((s, r) => s + r.sharePct * (weight ? (weight[r.id] ?? 1) : 1), 0) || 1
    return rows
      .map((r) => {
        const w = weight ? (weight[r.id] ?? 1) : 1
        const sharePct = Math.round(((r.sharePct * w) / denom) * 1000) / 10
        const posts = scaleCount(r.posts, (weight ? pillarFactor : 1) * w)
        const t = makeTrend(sharePct, r.changePp, posts, windows)
        return {
          id: r.id,
          label: r.label,
          peakTime: r.peakTime,
          competitors: scaleCount(r.competitors, weight ? 0.8 : 1),
          posts,
          sharePct,
          previousPct: t.previousPct,
          currentPct: t.currentPct,
          changePp: t.changePp,
          state: t.state,
        }
      })
      .sort((a, b) => b.sharePct - a.sharePct)
      .map((r, i) => ({ ...r, rank: i + 1 }))
  }

  // Build unweighted global ranks first, then carve post volume across pillars
  // by caption share so Discovery + Credibility + Trust equals the all-pillars total.
  const formatsAll = rankWeighted(FORMATS, null)
  const daysAll = rankWeighted(DAYS, null)
  const totalCaptionsAll = PATTERNS.reduce((sum, p) => sum + scaleCount(p.base.captions), 0)
  const competitorCap = scaleCount(100)
  const pillarKeys: Pillar[] = ['discovery', 'credibility', 'trust']
  const pillarTargets = allocateByWeights(
    pillarKeys.map((p) => pillarCaptionWeight(
      PATTERNS.map((x) => ({ pillar: x.pillar, captions: scaleCount(x.base.captions) })),
      p,
    )),
    totalCaptionsAll,
  )

  const formatsByPillar = {} as Record<Pillar, RankRow[]>
  const daysByPillar = {} as Record<Pillar, RankRow[]>
  for (let i = 0; i < pillarKeys.length; i++) {
    const p = pillarKeys[i]!
    const target = pillarTargets[i]!
    formatsByPillar[p] = scaleRankRowsToTotal(
      rankWeighted(FORMATS, PILLAR_FORMAT_WEIGHT[p]),
      target,
      competitorCap,
    )
    daysByPillar[p] = scaleRankRowsToTotal(
      rankWeighted(DAYS, PILLAR_DAY_WEIGHT[p]),
      target,
      competitorCap,
    )
  }

  const isPillar = pillarFilter !== 'all'
  const formats = isPillar ? formatsByPillar[pillarFilter as Pillar] ?? formatsAll : formatsAll
  const days = isPillar ? daysByPillar[pillarFilter as Pillar] ?? daysAll : daysAll

  const totalCaptions = isPillar
    ? formats.reduce((sum, r) => sum + r.posts, 0)
    : totalCaptionsAll
  // Detected count is the number of recurring patterns we actually hold, so the
  // KPI can never claim more patterns than the table can show.
  const patternsDetected = patterns.length
  const competitors = Math.max(...patterns.map((p) => p.competitors), 0)

  return {
    kpis: {
      competitors: pillarFilter === 'all' ? competitorCap : competitors,
      captions: totalCaptions,
      patternsDetected,
    },
    windows,
    patterns,
    formats,
    days,
    times: rankWeighted(TIMES, null),
    formatsByPillar,
    daysByPillar,
  }
}
