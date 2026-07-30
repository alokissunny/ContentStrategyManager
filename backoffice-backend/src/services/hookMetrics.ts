/**
 * Aggregate hook use-rate and median ER from map-step memos.
 *
 * Median ER = median of per-post ER across every classified post for that hook,
 * pooled from all competitors (not per-account). Per post:
 *   ER = (likes + comments) / followers × 100
 *
 * Use rate = share of classified exemplars that use the hook.
 * Example captions are resolved from the condensed account exemplars — never invented.
 */

import { median } from './metrics.ts'
import type { CondensedAccount } from './analysisCorpus.ts'

/** Up to this many real captions are surfaced per hook (a sample, not all). */
export const MAX_HOOK_EXAMPLES = 4

export interface HookExampleCaption {
  competitor: string
  caption: string
}

export interface ComputedHookMetric {
  hookType: string
  structure: string
  pillar: 'discovery' | 'credibility' | 'trust' | null
  useRate: number
  medianEngagement: number
  postCount: number
  /** Real captions from classified exemplars — empty when none resolved. */
  exampleCaptions: HookExampleCaption[]
}

function normalizeHookKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function asStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string' && v.trim()) return v.trim()
  return fallback
}

function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const PILLARS = new Set(['discovery', 'credibility', 'trust'])

function pillarOf(v: unknown): 'discovery' | 'credibility' | 'trust' | null {
  const s = asStr(v).toLowerCase()
  return PILLARS.has(s) ? (s as 'discovery' | 'credibility' | 'trust') : null
}

/** Lookup ER for an exemplar by username+postId (and postId alone). */
export function buildEngagementRateLookup(accounts: CondensedAccount[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const account of accounts) {
    const user = account.username.toLowerCase()
    for (const post of account.exemplars) {
      if (post.engagementRate == null) continue
      map.set(`${user}:${post.platformPostId}`, post.engagementRate)
      if (!map.has(post.platformPostId)) map.set(post.platformPostId, post.engagementRate)
    }
  }
  return map
}

/** Caption + display name for an exemplar, keyed by username:postId and postId. */
export function buildCaptionLookup(
  accounts: CondensedAccount[],
): Map<string, HookExampleCaption> {
  const map = new Map<string, HookExampleCaption>()
  for (const account of accounts) {
    const name = account.displayName?.trim() || account.username
    const user = account.username.toLowerCase()
    for (const post of account.exemplars) {
      const caption = (post.caption ?? '').trim()
      if (!caption || !post.platformPostId) continue
      const entry = { competitor: name, caption }
      map.set(`${user}:${post.platformPostId}`, entry)
      if (!map.has(post.platformPostId)) map.set(post.platformPostId, entry)
    }
  }
  return map
}

export function countExemplars(accounts: CondensedAccount[]): number {
  return accounts.reduce((n, a) => n + a.exemplars.length, 0)
}

/**
 * Pull classified hook posts out of map memos and compute useRate + median ER
 * + a sample of real matching captions.
 */
export function aggregateHookMetrics(
  memos: unknown[],
  erLookup: Map<string, number>,
  totalExemplars: number,
  captionLookup: Map<string, HookExampleCaption> = new Map(),
): ComputedHookMetric[] {
  type Bucket = {
    hookType: string
    structure: string
    pillar: 'discovery' | 'credibility' | 'trust' | null
    rates: number[]
    postKeys: Set<string>
    examples: HookExampleCaption[]
    seenCaptions: Set<string>
  }
  const buckets = new Map<string, Bucket>()

  for (const memo of memos) {
    if (!memo || typeof memo !== 'object') continue
    const hooks = (memo as { hooks?: unknown }).hooks
    if (!Array.isArray(hooks)) continue

    for (const raw of hooks) {
      const row = (raw ?? {}) as Record<string, unknown>
      const hookType = asStr(row.hookType)
      if (!hookType) continue
      const key = normalizeHookKey(hookType)
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          hookType,
          structure: asStr(row.structure),
          pillar: pillarOf(row.pillar),
          rates: [],
          postKeys: new Set(),
          examples: [],
          seenCaptions: new Set(),
        }
        buckets.set(key, bucket)
      } else if (!bucket.structure && asStr(row.structure)) {
        bucket.structure = asStr(row.structure)
      }
      if (!bucket.pillar) bucket.pillar = pillarOf(row.pillar)

      const posts = Array.isArray(row.posts) ? row.posts : []
      for (const p of posts) {
        const post = (p ?? {}) as Record<string, unknown>
        const username = asStr(post.username).toLowerCase()
        const platformPostId = asStr(post.platformPostId)
        if (!platformPostId) continue
        const postKey = username ? `${username}:${platformPostId}` : platformPostId
        if (bucket.postKeys.has(postKey)) continue
        bucket.postKeys.add(postKey)

        const fromMemo = asNum(post.engagementRate)
        const fromLookup =
          (username ? erLookup.get(`${username}:${platformPostId}`) : undefined) ??
          erLookup.get(platformPostId)
        const er = fromMemo ?? fromLookup ?? null
        if (er != null && er >= 0) bucket.rates.push(er)

        if (bucket.examples.length < MAX_HOOK_EXAMPLES) {
          const caption =
            (username ? captionLookup.get(`${username}:${platformPostId}`) : undefined) ??
            captionLookup.get(platformPostId)
          if (caption && !bucket.seenCaptions.has(caption.caption)) {
            bucket.seenCaptions.add(caption.caption)
            bucket.examples.push(caption)
          }
        }
      }
    }
  }

  const denom = Math.max(1, totalExemplars)
  return [...buckets.values()]
    .map((b) => ({
      hookType: b.hookType,
      structure: b.structure,
      pillar: b.pillar,
      postCount: b.postKeys.size,
      useRate: Math.round((b.postKeys.size / denom) * 1000) / 10,
      medianEngagement: b.rates.length > 0 ? Math.round(median(b.rates) * 100) / 100 : 0,
      exampleCaptions: b.examples,
    }))
    .filter((h) => h.postCount > 0)
    .sort((a, b) => b.useRate - a.useRate || b.medianEngagement - a.medianEngagement)
}

export interface DashboardHookRow {
  hookType: string
  structure: string
  useRate: number
  medianEngagement: number
  trend: 'up' | 'down' | 'flat'
  pillar: 'discovery' | 'credibility' | 'trust'
  exampleCaptions?: HookExampleCaption[]
}

/**
 * Prefer computed useRate / medianEngagement over Claude's (often zero) values.
 * Keep Claude trend / structure / pillar when present. Attach real example captions.
 */
export function applyComputedHookMetrics(
  hooks: DashboardHookRow[],
  computed: ComputedHookMetric[],
): DashboardHookRow[] {
  if (computed.length === 0) return hooks

  const byKey = new Map(computed.map((c) => [normalizeHookKey(c.hookType), c]))
  const used = new Set<string>()

  const merged = hooks.map((h) => {
    const key = normalizeHookKey(h.hookType)
    const c = byKey.get(key)
    if (!c) return h
    used.add(key)
    return {
      ...h,
      structure: h.structure || c.structure,
      useRate: c.useRate,
      medianEngagement: c.medianEngagement,
      pillar: h.pillar ?? c.pillar ?? 'discovery',
      exampleCaptions: c.exampleCaptions.length > 0 ? c.exampleCaptions : h.exampleCaptions,
    }
  })

  // Include strong computed hooks Claude omitted.
  for (const c of computed) {
    const key = normalizeHookKey(c.hookType)
    if (used.has(key)) continue
    merged.push({
      hookType: c.hookType,
      structure: c.structure,
      useRate: c.useRate,
      medianEngagement: c.medianEngagement,
      trend: 'flat',
      pillar: c.pillar ?? 'discovery',
      exampleCaptions: c.exampleCaptions,
    })
  }

  return merged
    .sort((a, b) => b.useRate - a.useRate || b.medianEngagement - a.medianEngagement)
    .slice(0, 8)
}
