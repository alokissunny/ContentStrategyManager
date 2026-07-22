import { z } from 'zod'
import { authorityPillar, id, isoDate } from './common'

/*
 * Recommendation outcomes — the product's feedback loop.
 *
 * Without this the backoffice can only ever say "here is what competitors
 * do". With it, it can say "we told 14 customers to do this, 9 followed it,
 * and 6 of those improved" — which is the only thing that makes a
 * recommendation worth more than a guess.
 *
 * On causality: following a recommendation and improving afterwards is a
 * sequence, not a cause. These records are deliberately shaped so the UI
 * cannot accidentally claim otherwise — there is no `causedBy` field, the
 * verdict enum says `improved-after`, not `improved-because`, and every
 * outcome carries the confounders we know we did not control for.
 */

export const adherence = z.enum([
  /** Recommended, window not finished yet. */
  'pending',
  /** Published the recommended play, in the recommended week. */
  'followed',
  /** Published something in the pillar, but not the recommended play. */
  'partially-followed',
  /** Published nothing matching the recommendation. */
  'not-followed',
])
export type Adherence = z.infer<typeof adherence>

/** What happened after, stated as sequence rather than cause. */
export const outcomeVerdict = z.enum([
  'improved-after',
  'no-measurable-change',
  'declined-after',
  /** Followed, but the measurement window has not closed. */
  'too-early',
  /** Cannot be evaluated because it was never followed. */
  'not-evaluable',
])
export type OutcomeVerdict = z.infer<typeof outcomeVerdict>

export const recommendationOutcome = z.object({
  id,
  customerId: id,
  /** The play as it was recommended, so a later wording change cannot rewrite history. */
  contentType: z.string(),
  pillar: authorityPillar,
  recommendedOn: isoDate,
  /** Days of measurement after the recommended week. */
  windowDays: z.number().int().positive(),
  adherence,
  verdict: outcomeVerdict,
  /** Posts the customer published that match the recommendation. */
  matchedPostCount: z.number().int().nonnegative(),
  /**
   * Movement over the window, in the metric the play targets. Null when the
   * recommendation was not followed or the window is still open — an
   * unfollowed recommendation has no result, and saying "0%" would imply one.
   */
  metricLabel: z.string(),
  metricChangePct: z.number().nullable(),
  /** What could explain the movement other than the recommendation. */
  confounders: z.array(z.string()),
})
export type RecommendationOutcome = z.infer<typeof recommendationOutcome>

/** A play's track record across every customer it was recommended to. */
export const playTrackRecord = z.object({
  contentType: z.string(),
  pillar: authorityPillar,
  recommended: z.number().int().nonnegative(),
  followed: z.number().int().nonnegative(),
  improvedAfter: z.number().int().nonnegative(),
  declinedAfter: z.number().int().nonnegative(),
  /** Median movement among customers who followed it. Null if too few did. */
  medianChangePct: z.number().nullable(),
  /** False when too few customers followed it to report a rate at all. */
  reportable: z.boolean(),
})
export type PlayTrackRecord = z.infer<typeof playTrackRecord>
