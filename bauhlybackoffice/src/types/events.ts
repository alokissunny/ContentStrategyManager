import { z } from 'zod'
import { id, isoDateTime } from './common'
import { onboardingStage } from './customer'

/*
 * Product usage events (sections 23–24 of the brief).
 *
 * Events are append-only facts about what a customer did in the Bauhly
 * product. Funnels and rates are computed from them in code, never stored
 * as opinions on the event itself.
 */

export const onboardingEvent = z.object({
  id,
  customerId: id,
  stage: onboardingStage,
  occurredAt: isoDateTime,
  /** 'entered' when a stage begins, 'completed' when it finishes; funnels
   * need both to compute drop-off and time-in-stage. */
  kind: z.enum(['entered', 'completed', 'abandoned', 'returned']),
})
export type OnboardingEvent = z.infer<typeof onboardingEvent>

export const reviewModeEvent = z.object({
  id,
  customerId: id,
  occurredAt: isoDateTime,
  kind: z.enum([
    'started',
    'screen-viewed',
    'screen-skipped',
    'option-selected',
    'manual-answer-entered',
    'edit-made',
    'exited',
    'returned',
    'completed',
  ]),
  screen: z.string().nullable(),
  detail: z.string().nullable(),
})
export type ReviewModeEvent = z.infer<typeof reviewModeEvent>

/** Generic product event for everything not covered by the two funnels
 * (recommendation viewed/accepted, content published, login, …). */
export const productEvent = z.object({
  id,
  customerId: id,
  name: z.string().min(1),
  occurredAt: isoDateTime,
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
})
export type ProductEvent = z.infer<typeof productEvent>
