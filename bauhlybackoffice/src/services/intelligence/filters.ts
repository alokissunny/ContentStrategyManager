import type { AuthorityPillar } from '../../types'

/*
 * Dashboard filter state. Every widget on the Intelligence page derives from
 * this single object; the repository receives it whole so results always
 * reflect the full active filter set.
 */

export type ComparisonGroupKey =
  | 'comparable'
  | 'smaller'
  | 'larger'
  | 'high-performing-comparable'
  | 'average-performing-comparable'
  | 'local'
  | 'content-style'
  | 'emerging'
  | 'all-approved'

export type PeriodKey =
  | 'last-30'
  | 'previous-30'
  | 'last-90'
  | 'last-180'
  | 'last-365'
  | 'month-over-month'

export type EvidenceThresholdKey =
  | 'all'
  | 'recommendation-ready'
  | 'strong'
  | 'moderate'
  | 'exploratory'
  | 'human-reviewed'

export type PatternDimensionKey =
  | 'format'
  | 'topic'
  | 'hook'
  | 'caption-structure'
  | 'authority-pillar'
  | 'posting-day'
  | 'posting-time'

export interface FilterState {
  location: string
  comparisonGroup: ComparisonGroupKey
  followerRangeLabel: string
  pillar: AuthorityPillar | 'all'
  dimension: PatternDimensionKey
  period: PeriodKey
  evidenceThreshold: EvidenceThresholdKey
  customerId: string | 'all'
}

export const defaultFilters: FilterState = {
  location: 'Global',
  comparisonGroup: 'comparable',
  followerRangeLabel: 'All sizes',
  pillar: 'all',
  dimension: 'format',
  period: 'last-30',
  evidenceThreshold: 'all',
  customerId: 'all',
}

export const filterOptions = {
  /** Fallback only — Overview loads live countries via getCompetitorLocations. */
  location: ['Global'] as string[],
  comparisonGroup: [
    { value: 'comparable', label: 'Comparable accounts' },
    { value: 'smaller', label: 'Smaller accounts' },
    { value: 'larger', label: 'Larger accounts' },
    { value: 'high-performing-comparable', label: 'High-performing comparable' },
    { value: 'average-performing-comparable', label: 'Average-performing comparable' },
    { value: 'local', label: 'Local competitors' },
    { value: 'content-style', label: 'Content-style accounts' },
    { value: 'emerging', label: 'Emerging accounts' },
    { value: 'all-approved', label: 'All approved accounts' },
  ] satisfies { value: ComparisonGroupKey; label: string }[],
  followerRange: [
    'All sizes',
    'Under 1K',
    '1K – 3K',
    '3K – 5K',
    '5K – 10K',
    '5K – 20K',
    '10K – 15K',
    '15K – 20K',
    '20K – 50K',
    'Over 50K',
  ],
  pillar: [
    { value: 'all', label: 'All pillars' },
    { value: 'discovery', label: 'Discovery' },
    { value: 'credibility', label: 'Credibility' },
    { value: 'trust', label: 'Trust' },
  ],
  period: [
    { value: 'last-30', label: 'Last 30 days' },
    { value: 'previous-30', label: 'Previous 30 days' },
    { value: 'last-90', label: 'Last 3 months' },
    { value: 'last-180', label: 'Last 6 months' },
    { value: 'last-365', label: 'Last 12 months' },
    { value: 'month-over-month', label: 'Month over month' },
  ] satisfies { value: PeriodKey; label: string }[],
  evidenceThreshold: [
    { value: 'all', label: 'All findings' },
    { value: 'recommendation-ready', label: 'Recommendation-ready' },
    { value: 'strong', label: 'Strong evidence' },
    { value: 'moderate', label: 'Moderate evidence' },
    { value: 'exploratory', label: 'Exploratory' },
    { value: 'human-reviewed', label: 'Human-reviewed only' },
  ] satisfies { value: EvidenceThresholdKey; label: string }[],
  dimension: [
    { value: 'format', label: 'Formats' },
    { value: 'topic', label: 'Topics' },
    { value: 'hook', label: 'Hooks' },
    { value: 'caption-structure', label: 'Captions' },
    { value: 'posting-day', label: 'Days' },
    { value: 'posting-time', label: 'Times' },
  ] satisfies { value: PatternDimensionKey; label: string }[],
} as const
