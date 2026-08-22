/**
 * Aggregate hook use-rate and median ER from map-step memos.
 *
 * Median ER = median of per-post ER across every classified post for that hook,
 * pooled from all competitors (not per-account). Per post:
 *   ER = (likes + comments) / followers × 100
 *
 * Use rate = share of unique competitor accounts that open with the hook (NOT
 * share of posts) — so a few very active accounts can't inflate a hook by
 * repeating it. Hooks used by fewer than the recommendation threshold's worth
 * of accounts are dropped. Example captions are resolved from the condensed
 * account exemplars — never invented.
 */

import { median } from './metrics.ts'
import { meetsAccountThreshold, type CondensedAccount } from './analysisCorpus.ts'

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
  /** Share of unique competitor accounts that use the hook (0–100). */
  useRate: number
  medianEngagement: number
  /** Distinct accounts that use the hook — the basis for `useRate`. */
  accountCount: number
  /** Distinct classified posts using the hook (evidence volume, not the metric). */
  postCount: number
  /** Usernames of the distinct accounts — kept so fragmented batch-level hooks
   *  can be unioned (not double-counted) when merged into a canonical hook. */
  accounts: string[]
  /** Per-post ER for every classified post — pooled so a merge can recompute the median. */
  engagementRates: number[]
  /** Real captions from classified exemplars — empty when none resolved. */
  exampleCaptions: HookExampleCaption[]
}

function normalizeHookKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Significant tokens of a hook name, for similarity grouping. Generic words that
 * appear in most hook names ("hook", "opener", …) carry no meaning and are
 * dropped, so "Direct question hook" and "Rhetorical question opener" still
 * share the token that matters ("question").
 */
const HOOK_STOPWORDS = new Set([
  'hook', 'hooks', 'opener', 'open', 'opening', 'cta', 'style', 'type', 'the', 'a', 'an',
  'of', 'to', 'with', 'and', 'or', 'for', 'that', 'then', 'into', 'via', 'using',
])
function hookTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !HOOK_STOPWORDS.has(t)),
  )
}
function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
/** Two hook names are the "same" logical hook when they share a third of their meaningful tokens. */
const HOOK_MERGE_SIMILARITY = 0.34

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
 * platformPostId → owning account username (lowercased). Lets us attribute a
 * hook's post to its account even when the map memo omits `username` — the
 * account counting must not depend on the LLM faithfully echoing usernames.
 */
export function buildPostAccountLookup(accounts: CondensedAccount[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const account of accounts) {
    const user = account.username.toLowerCase()
    for (const post of account.exemplars) {
      if (post.platformPostId) map.set(post.platformPostId, user)
    }
  }
  return map
}

/**
 * Pull classified hook posts out of map memos and compute useRate + median ER
 * + a sample of real matching captions.
 */
export function aggregateHookMetrics(
  memos: unknown[],
  erLookup: Map<string, number>,
  totalAccounts: number,
  captionLookup: Map<string, HookExampleCaption> = new Map(),
  postAccountLookup: Map<string, string> = new Map(),
): ComputedHookMetric[] {
  type Bucket = {
    hookType: string
    structure: string
    pillar: 'discovery' | 'credibility' | 'trust' | null
    rates: number[]
    postKeys: Set<string>
    accountKeys: Set<string>
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
          accountKeys: new Set(),
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
        const platformPostId = asStr(post.platformPostId)
        if (!platformPostId) continue
        // Prefer the memo's username, but fall back to the post's real owner so
        // account counts don't collapse to zero when the LLM omits usernames.
        const username =
          asStr(post.username).toLowerCase() || (postAccountLookup.get(platformPostId) ?? '')
        const postKey = username ? `${username}:${platformPostId}` : platformPostId
        if (bucket.postKeys.has(postKey)) continue
        bucket.postKeys.add(postKey)
        if (username) bucket.accountKeys.add(username)

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

  const denom = Math.max(1, totalAccounts)
  // Per-batch buckets — one row per raw hook name. These still fragment (each
  // map batch names the same logical hook differently), so the account-based
  // useRate here is per-fragment. The threshold is NOT applied yet: fragments
  // are unioned into canonical hooks in applyComputedHookMetrics first, and only
  // the merged account count is checked against the recommendation floor.
  return [...buckets.values()]
    .map((b) => ({
      hookType: b.hookType,
      structure: b.structure,
      pillar: b.pillar,
      accountCount: b.accountKeys.size,
      postCount: b.postKeys.size,
      accounts: [...b.accountKeys],
      engagementRates: b.rates,
      // Share of unique accounts, not posts — a few prolific accounts can no
      // longer inflate a hook by repeating it.
      useRate: Math.round((b.accountKeys.size / denom) * 1000) / 10,
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
  /** Distinct accounts using the hook — present once computed metrics are applied. */
  accountCount?: number
  trend: 'up' | 'down' | 'flat'
  pillar: 'discovery' | 'credibility' | 'trust'
  exampleCaptions?: HookExampleCaption[]
}

type HookCluster = {
  tokens: Set<string>
  /** Highest-account raw fragment — names the cluster if no Claude hook matches. */
  repHookType: string
  repStructure: string
  repPillar: 'discovery' | 'credibility' | 'trust' | null
  accounts: Set<string>
  rates: number[]
  postCount: number
  examples: HookExampleCaption[]
  seenCaptions: Set<string>
}

/**
 * Turn the fragmented per-batch hook buckets into the dashboard's hook rows.
 *
 * Each map batch names the same logical hook differently ("Direct question hook"
 * vs "Rhetorical question opener"), so counting unique accounts per raw name
 * undercounts every hook. Here we first CLUSTER the raw buckets by name
 * similarity, unioning their account sets (an account using the hook in two
 * batches is counted once), then compute the account-based use-rate and apply
 * the recommendation threshold on the MERGED count. Clusters are labelled with a
 * matching Claude hook when one exists (nicer wording + trend / pillar), else the
 * cluster's biggest fragment.
 *
 * When nothing survives (no memos, or every merged hook is still below the
 * threshold) we return an empty list, not Claude's rows — Claude's `useRate` is
 * always 0 (it copies its numbers from `hookMetrics`), so surfacing them would
 * show misleading 0% rows instead of an honest empty state.
 */
export function applyComputedHookMetrics(
  hooks: DashboardHookRow[],
  computed: ComputedHookMetric[],
  totalAccounts: number,
): DashboardHookRow[] {
  if (computed.length === 0) return []

  // Cluster fragments. Process by account count desc so the representative of a
  // cluster is its strongest fragment, and new fragments compare against that
  // representative (single-link off the rep avoids runaway chaining).
  const clusters: HookCluster[] = []
  for (const c of [...computed].sort((a, b) => b.accountCount - a.accountCount)) {
    const tokens = hookTokens(c.hookType)
    let best: HookCluster | null = null
    let bestScore = 0
    for (const cl of clusters) {
      const s = tokenSimilarity(tokens, cl.tokens)
      if (s > bestScore) {
        bestScore = s
        best = cl
      }
    }
    if (best && bestScore >= HOOK_MERGE_SIMILARITY) {
      for (const u of c.accounts) best.accounts.add(u)
      best.rates.push(...c.engagementRates)
      best.postCount += c.postCount
      for (const ex of c.exampleCaptions) {
        if (best.examples.length >= MAX_HOOK_EXAMPLES) break
        if (!best.seenCaptions.has(ex.caption)) {
          best.seenCaptions.add(ex.caption)
          best.examples.push(ex)
        }
      }
    } else {
      clusters.push({
        tokens,
        repHookType: c.hookType,
        repStructure: c.structure,
        repPillar: c.pillar,
        accounts: new Set(c.accounts),
        rates: [...c.engagementRates],
        postCount: c.postCount,
        examples: c.exampleCaptions.slice(0, MAX_HOOK_EXAMPLES),
        seenCaptions: new Set(c.exampleCaptions.map((e) => e.caption)),
      })
    }
  }

  const claudeByTokens = hooks.map((h) => ({ hook: h, tokens: hookTokens(h.hookType) }))
  const denom = Math.max(1, totalAccounts)

  return clusters
    .map((cl) => {
      // Prefer a matching Claude hook for the label + trend / structure / pillar.
      let claude: DashboardHookRow | null = null
      let claudeScore = 0
      for (const { hook, tokens } of claudeByTokens) {
        const s = tokenSimilarity(tokens, cl.tokens)
        if (s > claudeScore) {
          claudeScore = s
          claude = hook
        }
      }
      const useClaude = claude != null && claudeScore >= HOOK_MERGE_SIMILARITY
      const accountCount = cl.accounts.size
      return {
        hookType: useClaude ? claude!.hookType : cl.repHookType,
        structure: (useClaude && claude!.structure) || cl.repStructure,
        useRate: Math.round((accountCount / denom) * 1000) / 10,
        medianEngagement: cl.rates.length > 0 ? Math.round(median(cl.rates) * 100) / 100 : 0,
        accountCount,
        trend: (useClaude && claude!.trend) || ('flat' as const),
        pillar: (useClaude && claude!.pillar) || cl.repPillar || ('discovery' as const),
        exampleCaptions: cl.examples,
      }
    })
    // Threshold on the MERGED unique-account count.
    .filter((r) => meetsAccountThreshold(r.accountCount, totalAccounts))
    .sort((a, b) => b.useRate - a.useRate || b.medianEngagement - a.medianEngagement)
    .slice(0, 8)
}
