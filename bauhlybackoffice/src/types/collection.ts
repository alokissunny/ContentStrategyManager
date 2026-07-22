import { z } from 'zod'
import { id, isoDateTime } from './common'

/*
 * Collection infrastructure records (sections 27, 35 of the brief).
 *
 * Every external fetch is a CollectionRun; every failure inside it is a
 * CollectionError. Raw external responses are referenced (not embedded) so
 * normalization can be replayed when an Actor's output shape changes.
 */

export const collectionRun = z.object({
  id,
  source: z.enum(['apify', 'meta', 'manual', 'mock']),
  kind: z.enum(['initial', 'refresh', 'scheduled', 'test']),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed']),
  targetAccountIds: z.array(id),
  accountsSucceeded: z.number().int().nonnegative(),
  accountsFailed: z.number().int().nonnegative(),
  postsCollected: z.number().int().nonnegative(),
  /** Pointer to the stored raw response payload(s) for replay/audit. */
  rawResponseRef: z.string().nullable(),
  notes: z.string().nullable(),
})
export type CollectionRun = z.infer<typeof collectionRun>

export const collectionError = z.object({
  id,
  collectionRunId: id,
  accountId: id.nullable(),
  occurredAt: isoDateTime,
  kind: z.enum([
    'account-private',
    'account-not-found',
    'rate-limited',
    'timeout',
    'validation-failed',
    'missing-fields',
    'duplicate',
    'actor-error',
    'permission-error',
    'expired-token',
    'unknown',
  ]),
  message: z.string(),
  retryable: z.boolean(),
  resolvedAt: isoDateTime.nullable(),
})
export type CollectionError = z.infer<typeof collectionError>
