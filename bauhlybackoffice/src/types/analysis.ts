import { z } from 'zod'
import { id, isoDateTime } from './common'

export const competitorAnalysis = z.object({
  id,
  status: z.enum(['running', 'completed', 'failed']),
  windowDays: z.number().int().positive(),
  model: z.string().nullable(),
  markdown: z.string().nullable(),
  /** Structured Overview dashboard — same shape as DashboardData when present. */
  dashboard: z.unknown().nullable().optional(),
  error: z.string().nullable(),
  accountsAnalyzed: z.number().int().nonnegative(),
  postsAnalyzed: z.number().int().nonnegative(),
  filterScope: z
    .object({
      location: z.string(),
      followerRangeLabel: z.string(),
      period: z.string(),
      windowDays: z.number().int().positive(),
    })
    .nullable()
    .optional(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
})
export type CompetitorAnalysis = z.infer<typeof competitorAnalysis>
