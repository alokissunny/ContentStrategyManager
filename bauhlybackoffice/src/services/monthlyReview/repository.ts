import { mockMovements, mockWeekly, type WeeklyDayObservation } from '../intelligence/mockData'
import type { PatternMovement } from '../../types'
import { periodMeta, type ComparisonPeriod } from '../period'

/*
 * Monthly Review repository (mock). Change lists are derived from the same
 * pattern-movement dataset the Intelligence Dashboard uses, so the two pages
 * can never disagree. Real month-over-month computation replaces the
 * internals in the comparison-logic phase.
 */

export interface ChangeItem {
  label: string
  detail: string
  changePp: number
}

export interface Opportunity {
  title: string
  detail: string
  impact: 1 | 2 | 3 | 4 | 5
  relevance: 'High' | 'Medium' | 'Low'
}

export interface Hypothesis {
  direction: 'gaining' | 'losing' | 'no-change' | 'new'
  count: number
}

export interface MonthlyReviewData {
  period: { label: string; comparedTo: string }
  summary: {
    accountsMonitored: number
    newThisMonth: number
    newPosts: number
    emergingPatterns: number
    strengtheningPatterns: number
    weakeningPatterns: number
    recommendationReady: number
  }
  increased: ChangeItem[]
  decreased: ChangeItem[]
  emerging: { pattern: string; changePp: number }[]
  weakening: { pattern: string; changePp: number }[]
  highlights: { title: string; detail: string }[]
  weekly: WeeklyDayObservation[]
  opportunities: Opportunity[]
  dataQuality: { label: string; value: number; color: string }[]
  hypotheses: Hypothesis[]
  limitations: string[]
  /** Customer-side movement for the same window. */
  customers: {
    monitored: number
    contentPublishedPct: number
    improved: ChangeItem[]
    declined: ChangeItem[]
    statusMovement: { label: string; count: number; tone: 'positive' | 'neutral' | 'negative' }[]
    highlights: { title: string; detail: string }[]
  }
}

function toChangeItem(m: PatternMovement, detail: string): ChangeItem {
  return { label: m.pattern, detail, changePp: m.changePp ?? 0 }
}

export async function getMonthlyReview(period: ComparisonPeriod = 'month'): Promise<MonthlyReviewData> {
  await new Promise((r) => setTimeout(r, 200))

  const meta = periodMeta(period)
  const scale = meta.days / 30
  const round = (n: number) => Math.round(n * 10) / 10
  const withChange = mockMovements.filter((m) => m.changePp != null)
  const increased = withChange
    .filter((m) => (m.changePp ?? 0) >= 3)
    .sort((a, b) => (b.changePp ?? 0) - (a.changePp ?? 0))
    .slice(0, 6)
    .map((m) => toChangeItem(m, m.state === 'strengthening' ? 'Increase in adoption' : 'Gaining ground'))
  const decreased = withChange
    .filter((m) => (m.changePp ?? 0) <= -3)
    .sort((a, b) => (a.changePp ?? 0) - (b.changePp ?? 0))
    .slice(0, 6)
    .map((m) => toChangeItem(m, m.state === 'saturated' ? 'Declining performance' : 'Less common this period'))

  return {
    period: { label: meta.current, comparedTo: meta.previous },
    summary: {
      accountsMonitored: 162,
      newThisMonth: Math.max(1, Math.round(12 * scale)),
      newPosts: Math.round(24851 * scale),
      emergingPatterns: mockMovements.filter((m) => m.state === 'emerging').length,
      strengtheningPatterns: mockMovements.filter((m) => m.state === 'strengthening').length,
      weakeningPatterns: mockMovements.filter((m) => ['weakening', 'saturated', 'disappearing'].includes(m.state)).length,
      recommendationReady: 18,
    },
    increased,
    decreased,
    emerging: [
      { pattern: 'Project walkthrough (Voice-over Reels)', changePp: 18 },
      { pattern: 'Client problem storytelling', changePp: 15 },
      { pattern: 'Material close-up content', changePp: 12 },
      { pattern: 'Educational tips (Design rules)', changePp: 11 },
      { pattern: 'Q&A format', changePp: 9 },
    ],
    weakening: [
      { pattern: 'Generic reveal hooks', changePp: -12 },
      { pattern: 'Lifestyle / Personal content', changePp: -7 },
      { pattern: 'Single image posts', changePp: -6 },
      { pattern: 'Trend audio usage', changePp: -5 },
      { pattern: 'Hashtag-only captions', changePp: -4 },
    ],
    highlights: [
      { title: 'Educational content continues to rise', detail: '31% of comparable accounts increased educational content usage this month.' },
      { title: 'Founder presence drives results', detail: 'Accounts with founder-led Reels saw 1.4x higher observed engagement than average.' },
      { title: 'Weekday strategy becoming clearer', detail: 'Mon–Wed focus on trust & credibility, Thu–Fri on discovery and transformation.' },
      { title: 'Local competitors level up', detail: 'Local group increased posting consistency by 13% vs previous period.' },
      { title: 'Ad activity increased', detail: '18% more accounts showing paid promotion evidence this month.' },
    ],
    weekly: mockWeekly,
    opportunities: [
      { title: 'Increase educational carousels', detail: 'High-performing peers use 2.3x more often', impact: 5, relevance: 'High' },
      { title: 'Add project decision stories', detail: 'Underused but high engagement lift', impact: 5, relevance: 'High' },
      { title: 'Use stronger problem-focused hooks', detail: 'Top hooks outperform generic reveals', impact: 3, relevance: 'Medium' },
      { title: 'Improve posting consistency', detail: 'Peers post 1.6x more consistently', impact: 5, relevance: 'High' },
      { title: 'Leverage founder-led Reels', detail: 'Driving higher engagement in your segment', impact: 5, relevance: 'High' },
    ],
    dataQuality: [
      { label: 'Complete', value: 68, color: 'var(--positive)' },
      { label: 'Partial', value: 24, color: 'var(--warning)' },
      { label: 'Low', value: 6, color: 'var(--negative)' },
      { label: 'Failed', value: 2, color: 'var(--ink-300)' },
    ],
    hypotheses: [
      { direction: 'gaining', count: 6 },
      { direction: 'losing', count: 3 },
      { direction: 'no-change', count: 11 },
      { direction: 'new', count: 4 },
    ],
    limitations: [
      'Public metrics only — reach, saves and paid distribution are unknown for competitor accounts.',
      'Pattern states are computed from observed post counts; deleted posts are excluded.',
    ],
    customers: {
      monitored: 54,
      contentPublishedPct: Math.round(62 * Math.min(1, 0.7 + scale * 0.3)),
      improved: [
        { label: 'Median reach', detail: 'across connected accounts', changePp: round(12.4 * scale) },
        { label: 'Median saves', detail: 'across connected accounts', changePp: round(9.6 * scale) },
        { label: 'Publishing rate', detail: 'generated posts published', changePp: round(6.1 * scale) },
        { label: 'Content acceptance', detail: 'of delivered items', changePp: round(4.4 * scale) },
      ],
      declined: [
        { label: 'Edit rate', detail: 'lower is better — cross-check engagement', changePp: round(-5.2 * scale) },
        { label: 'Review completion', detail: 'customers finishing review mode', changePp: round(-2.8 * scale) },
        { label: 'Time to first publish', detail: 'days from delivery to publish', changePp: round(-1.6 * scale) },
      ],
      statusMovement: [
        { label: 'Moved to improving', count: 7, tone: 'positive' },
        { label: 'Stayed stable', count: 16, tone: 'neutral' },
        { label: 'Moved to at risk', count: 4, tone: 'negative' },
        { label: 'New this period', count: 5, tone: 'neutral' },
      ],
      highlights: [
        { title: 'Customers who completed review mode publish more', detail: 'Publishing rate is 21pp higher for customers who finished review mode.' },
        { title: 'Edit rate falling alongside acceptance rising', detail: 'Both moved in the healthy direction, so the drop is not disengagement.' },
        { title: 'Four customers need attention', detail: 'Publishing and review completion both dropped vs the previous period.' },
        { title: 'Design-decision content adopted fastest', detail: 'The most-accepted recommendation type this period.' },
      ],
    },
  }
}
