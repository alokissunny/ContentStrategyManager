/*
 * Analysis thresholds — configurable, never hard-coded into logic.
 *
 * Every threshold that gates whether a finding is shown, graded, or promoted
 * lives here so it can be tuned (and later moved to Settings) without hunting
 * through analysis code. Values are starting points, not validated truths.
 */

export const thresholds = {
  /** Minimum accounts before a pattern can be called "common". */
  minAccountsForPattern: 3,
  /** Minimum relevant posts before a pattern is reported at all. */
  minPostsForPattern: 12,
  /** Minimum percentage-point change to surface in "what changed". */
  minChangePp: 3,
  /** Target comparison-group size for benchmarks. */
  comparisonGroupTarget: { min: 20, max: 30 },
  /** Days a delivered post can wait before counting as abandoned. */
  abandonmentWaitDays: 14,
} as const

/** Follower-range presets — assumed, to be made configurable in Settings. */
export const followerRangePresets = [
  { label: 'Under 1K', min: 0, max: 1_000 },
  { label: '1K – 3K', min: 1_000, max: 3_000 },
  { label: '3K – 5K', min: 3_000, max: 5_000 },
  { label: '5K – 10K', min: 5_000, max: 10_000 },
  { label: '10K – 15K', min: 10_000, max: 15_000 },
  { label: '15K – 20K', min: 15_000, max: 20_000 },
  { label: '20K – 50K', min: 20_000, max: 50_000 },
  { label: 'Over 50K', min: 50_000, max: null },
] as const
