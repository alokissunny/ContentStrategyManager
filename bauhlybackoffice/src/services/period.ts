/*
 * Comparison windows (brief §20.2). Every page that reports change over time
 * uses the same vocabulary so "vs previous period" means the same thing in
 * Customers, Competitors and the Monthly Review.
 */

export type ComparisonPeriod = 'week' | 'month' | 'last-30' | 'last-90' | 'custom'

export const comparisonPeriods: {
  value: ComparisonPeriod
  label: string
  current: string
  previous: string
  /** Days in the window — drives the mock scaling of period metrics. */
  days: number
}[] = [
  { value: 'week', label: 'This week vs last week', current: 'This week', previous: 'last week', days: 7 },
  { value: 'month', label: 'This month vs last month', current: 'This month', previous: 'last month', days: 30 },
  { value: 'last-30', label: 'Last 30 days vs previous 30', current: 'Last 30 days', previous: 'previous 30 days', days: 30 },
  { value: 'last-90', label: 'Last 3 months vs previous 3', current: 'Last 3 months', previous: 'previous 3 months', days: 90 },
  { value: 'custom', label: 'Custom range…', current: 'Selected range', previous: 'preceding range', days: 30 },
]

export interface CustomRange {
  from: string
  to: string
}

/** Window length in days for a custom range, floored at 1. */
export function customRangeDays(range: CustomRange | undefined): number {
  if (!range?.from || !range?.to) return 30
  const ms = new Date(range.to).getTime() - new Date(range.from).getTime()
  return Math.max(1, Math.round(ms / 86_400_000))
}

export function periodMeta(period: ComparisonPeriod, range?: CustomRange) {
  const meta = comparisonPeriods.find((p) => p.value === period) ?? comparisonPeriods[1]
  if (period === 'custom') {
    return { ...meta, days: customRangeDays(range) }
  }
  return meta
}

/** Short suffix for column headers, e.g. "Change 30d". */
export function periodSuffix(period: ComparisonPeriod, range?: CustomRange): string {
  return `${periodMeta(period, range).days}d`
}
