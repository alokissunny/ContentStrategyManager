/** Shared filter-scope helpers for Overview analysis (backend). */

/**
 * Lookback used for the "All time" period. `since(days)` counts back from now,
 * so this is just a floor old enough to sweep in every post these accounts have
 * (10 years comfortably predates the oldest Instagram content we scrape). It is
 * not a real 3650-day window — posts-per-week and window labels special-case it
 * via `isAllTimePeriod`.
 */
export const ALL_TIME_WINDOW_DAYS = 3650

export function periodToDays(period: string | undefined): number {
  switch (period) {
    case 'all':
      return ALL_TIME_WINDOW_DAYS
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

/** True when the scope covers the whole history rather than a fixed window. */
export function isAllTimePeriod(period: string | undefined, windowDays?: number): boolean {
  return period === 'all' || (windowDays != null && windowDays >= ALL_TIME_WINDOW_DAYS)
}

/** Human label for a scope's window — "all time" instead of "last 3650 days". */
export function windowLabel(period: string | undefined, windowDays: number): string {
  return isAllTimePeriod(period, windowDays) ? 'all time' : `last ${windowDays} days`
}

export function parseFollowerRange(label: string | undefined): { min: number; max: number | null } | null {
  if (!label || label === 'All sizes') return null
  if (label === 'Under 1K') return { min: 0, max: 999 }
  if (label === 'Over 50K') return { min: 50_000, max: null }
  const m = String(label).replace(/\s/g, '').match(/^(\d+)K[–-](\d+)K$/i)
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

/** Sentinel for Location filters: accounts with no effective country. */
export const UNASSIGNED_LOCATION = 'Unassigned'

export function isUnassignedLocationFilter(locationFilter: string | null | undefined): boolean {
  return locationFilter?.trim().toLowerCase() === 'unassigned'
}

export function locationMatches(accountCountry: string | null | undefined, locationFilter: string | undefined): boolean {
  if (!locationFilter || locationFilter === 'Global') return true
  if (isUnassignedLocationFilter(locationFilter)) return !accountCountry?.trim()
  if (!accountCountry) return false
  return accountCountry.trim().toLowerCase() === locationFilter.trim().toLowerCase()
}

/** Prefer profile location; fall back to enrichment country from Run enrichment. */
export function accountCountryOf(account: {
  location?: { country?: string | null } | null
  enrichment?: { country?: string | null } | null
}): string | null {
  const fromLocation = account.location?.country?.trim()
  if (fromLocation) return fromLocation
  const fromEnrichment = account.enrichment?.country?.trim()
  if (fromEnrichment && !/^unknown$/i.test(fromEnrichment)) return fromEnrichment
  return null
}

/** Exact enum match; missing account category counts as Interior Designer. */
export function businessCategoryMatches(
  accountCategory: string | null | undefined,
  filter: string | undefined,
): boolean {
  if (!filter) return true
  const resolved = accountCategory ?? 'interior-designer'
  return resolved === filter
}

export interface AnalysisFilterScope {
  location: string
  followerRangeLabel: string
  businessCategory: string
  period: string
  windowDays: number
}

export function scopesCompatible(
  stored: AnalysisFilterScope | null | undefined,
  requested: {
    location: string
    followerRangeLabel: string
    businessCategory: string
    period: string
  },
): boolean {
  // Legacy analyses (no scope) are treated as Global · All sizes · Interior Designer · their window.
  const scope = stored ?? {
    location: 'Global',
    followerRangeLabel: 'All sizes',
    businessCategory: 'interior-designer',
    period: 'last-30',
    windowDays: 30,
  }
  if (scope.location !== requested.location) return false
  if (scope.followerRangeLabel !== requested.followerRangeLabel) return false
  const storedCat = scope.businessCategory ?? 'interior-designer'
  if (storedCat !== requested.businessCategory) return false
  return periodToDays(scope.period) === periodToDays(requested.period)
}
