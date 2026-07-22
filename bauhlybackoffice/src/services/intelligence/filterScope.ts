import type { PeriodKey } from './filters'

/** Map Overview period keys to a day window for collection/analysis. */
export function periodToDays(period: PeriodKey | string): number {
  switch (period) {
    case 'last-90':
      return 90
    case 'last-180':
      return 180
    case 'last-365':
      return 365
    case 'previous-30':
    case 'month-over-month':
    case 'last-30':
    default:
      return 30
  }
}

/** Parse a follower-range label into inclusive bounds. null max = unbounded. */
export function parseFollowerRange(label: string): { min: number; max: number | null } | null {
  if (!label || label === 'All sizes') return null
  if (label === 'Under 1K') return { min: 0, max: 999 }
  if (label === 'Over 50K') return { min: 50_000, max: null }
  const m = label.replace(/\s/g, '').match(/^(\d+)K[–-](\d+)K$/i)
  if (m) return { min: Number(m[1]) * 1000, max: Number(m[2]) * 1000 - 1 }
  return null
}

export function followerInRange(
  followers: number | null | undefined,
  range: { min: number; max: number | null } | null,
): boolean {
  if (!range) return true
  if (followers == null) return false
  if (followers < range.min) return false
  if (range.max != null && followers > range.max) return false
  return true
}

export function locationMatches(accountCountry: string | null | undefined, locationFilter: string): boolean {
  if (!locationFilter || locationFilter === 'Global') return true
  if (!accountCountry) return false
  return accountCountry.trim().toLowerCase() === locationFilter.trim().toLowerCase()
}

export interface AnalysisFilterScope {
  location: string
  followerRangeLabel: string
  period: string
  windowDays: number
}

export function scopesCompatible(
  stored: AnalysisFilterScope | null | undefined,
  requested: { location: string; followerRangeLabel: string; period: string },
): boolean {
  const scope = stored ?? {
    location: 'Global',
    followerRangeLabel: 'All sizes',
    period: 'last-30',
    windowDays: 30,
  }
  if (scope.location !== requested.location) return false
  if (scope.followerRangeLabel !== requested.followerRangeLabel) return false
  return periodToDays(scope.period as PeriodKey) === periodToDays(requested.period as PeriodKey)
}
