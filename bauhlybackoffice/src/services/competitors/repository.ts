import { competitorAccount, competitorGroup, competitorSuggestion, rawPostsResponse, competitorAnalysis } from '../../types'
import type { CompetitorAccount, CompetitorGroup, CompetitorSuggestion, RawPostsResponse, CompetitorAnalysis } from '../../types'
import { mockCompetitors, mockFollowerChange, mockGroups, mockSuggestions } from './mockData'
import { periodMeta, type ComparisonPeriod } from '../period'
import { ApiError, USE_MOCKS, api } from '../api'
import { z } from 'zod'

/*
 * Competitor repository — the single seam between the UI and its data.
 *
 * Backed by the backoffice API; set VITE_USE_MOCKS=true to fall back to the
 * in-memory mock dataset (offline dev and tests). Every API response is parsed
 * with the Zod schema for its type, so a backend that drifts from the contract
 * fails loudly here instead of rendering wrong numbers.
 */

/*
 * There is no approval workflow: an account is either in the register or
 * deleted. Deleted accounts are hidden everywhere.
 */

export interface CompetitorQuery {
  search: string
  country: string
  followerRange: string
  period: ComparisonPeriod
  sort: 'name' | 'followers' | 'change' | 'lastCollection'
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const defaultCompetitorQuery: CompetitorQuery = {
  search: '',
  country: 'all',
  followerRange: 'all',
  period: 'last-30',
  sort: 'followers',
  sortDir: 'desc',
  page: 1,
  pageSize: 8,
}

export interface CompetitorRow extends CompetitorAccount {
  followerChange30d: number | null
}

export interface CompetitorListResult {
  rows: CompetitorRow[]
  total: number
  page: number
  pageCount: number
  stats: {
    total: number
    approved: number
    watchlist: number
    inBenchmarks: number
    collectionSuccessRate: number
    collectedPosts: number
    collectionErrors: number
    statusBreakdown: { label: string; value: number; color: string }[]
    /** Six-point trend series per card, index-matched to card order. */
    series: number[][]
  }
}

// Module-level mutable copies — the "database" for mock phases.
const accounts: CompetitorAccount[] = [...mockCompetitors]
let suggestions: CompetitorSuggestion[] = [...mockSuggestions]

const followerBuckets: Record<string, [number, number | null]> = {
  'Under 1K': [0, 1000],
  '1K – 5K': [1000, 5000],
  '5K – 20K': [5000, 20000],
  '20K – 50K': [20000, 50000],
  'Over 50K': [50000, null],
}

function matches(account: CompetitorAccount, q: CompetitorQuery): boolean {
  if (q.search) {
    const s = q.search.toLowerCase()
    const hit =
      account.username.toLowerCase().includes(s) ||
      (account.displayName?.toLowerCase().includes(s) ?? false) ||
      (account.website?.toLowerCase().includes(s) ?? false)
    if (!hit) return false
  }
  if (q.country !== 'all' && account.location.country !== q.country) return false
  if (account.approvalStatus === 'deleted') return false
  if (q.followerRange !== 'all') {
    const bucket = followerBuckets[q.followerRange]
    const f = account.latestFollowerCount
    if (!bucket || f == null) return false
    if (f < bucket[0] || (bucket[1] != null && f >= bucket[1])) return false
  }
  return true
}

export function listCompetitorsSync(q: CompetitorQuery): CompetitorListResult {
  const filtered = accounts.filter((a) => matches(a, q))

  const dir = q.sortDir === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    switch (q.sort) {
      case 'name':
        return dir * (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username)
      case 'change':
        return dir * ((mockFollowerChange[a.id] ?? 0) - (mockFollowerChange[b.id] ?? 0))
      case 'lastCollection':
        return dir * (a.lastSuccessfulCollectionAt ?? '').localeCompare(b.lastSuccessfulCollectionAt ?? '')
      default:
        return dir * ((a.latestFollowerCount ?? 0) - (b.latestFollowerCount ?? 0))
    }
  })

  const pageCount = Math.max(1, Math.ceil(filtered.length / q.pageSize))
  const page = Math.min(q.page, pageCount)
  // Observed change is reported over the selected window; the stored series
  // is a 30-day figure, scaled here so the column always matches its header.
  const windowScale = periodMeta(q.period).days / 30
  const rows = filtered.slice((page - 1) * q.pageSize, page * q.pageSize).map((a) => ({
    ...a,
    followerChange30d:
      mockFollowerChange[a.id] != null
        ? Math.round(mockFollowerChange[a.id] * windowScale * 10) / 10
        : null,
  }))

  // Mutually exclusive buckets: an account is exactly one of these.
  const collected = accounts.filter((a) => a.lastSuccessfulCollectionAt != null)
  const partial = collected.filter((a) => a.dataQuality === 'partial' || a.dataQuality === 'low').length
  const successCount = collected.length - partial
  const failed = accounts.filter((a) => a.dataQuality === 'failed').length
  const notRun = accounts.length - collected.length - failed

  return {
    rows,
    total: filtered.length,
    page,
    pageCount,
    stats: {
      total: accounts.filter((a) => a.approvalStatus !== 'deleted').length,
      approved: accounts.filter((a) => ['approved', 'included-in-benchmarks'].includes(a.approvalStatus)).length,
      watchlist: accounts.filter((a) => a.approvalStatus === 'watchlist-only').length,
      inBenchmarks: accounts.filter((a) => a.approvalStatus === 'included-in-benchmarks').length,
      collectionSuccessRate: Math.round((collected.length / accounts.length) * 1000) / 10,
      collectedPosts: Math.round(24851 * windowScale),
      collectionErrors: failed + Math.round(partial / 8),
      series: [
        [138, 142, 149, 153, 158, accounts.length],
        [72, 78, 84, 89, 94, 98],
        [91.2, 92.8, 93.5, 94.9, 95.2, 95.7],
        [19200, 20400, 21600, 22800, 23900, Math.round(24851 * windowScale)],
        [14, 12, 11, 9, 8, failed + Math.round(partial / 8)],
      ],
      statusBreakdown: [
        { label: 'Successful', value: successCount, color: 'var(--positive)' },
        { label: 'Failed', value: failed, color: 'var(--negative)' },
        { label: 'Partial', value: partial, color: 'var(--warning)' },
        { label: 'Not run', value: Math.max(0, notRun), color: 'var(--ink-300)' },
      ],
    },
  }
}

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** The row shape adds a derived field the account schema doesn't carry. */
const competitorRow = competitorAccount.extend({ followerChange30d: z.number().nullable() })

export async function listCompetitors(q: CompetitorQuery): Promise<CompetitorListResult> {
  if (USE_MOCKS) {
    await delay()
    return listCompetitorsSync(q)
  }
  const data = await api.get<CompetitorListResult>('/competitors', {
    search: q.search,
    country: q.country,
    followerRange: q.followerRange,
    period: q.period,
    sort: q.sort,
    sortDir: q.sortDir,
    page: q.page,
    pageSize: q.pageSize,
  })
  return { ...data, rows: z.array(competitorRow).parse(data.rows) }
}

/**
 * Countries present on competitor account metadata (location + enrichment).
 * Overview Location filter is built from this list (+ Global).
 */
export async function getCompetitorLocations(): Promise<string[]> {
  if (USE_MOCKS) {
    await delay()
    const byKey = new Map<string, string>()
    for (const a of accounts) {
      for (const raw of [a.location.country, a.enrichment?.country]) {
        if (!raw?.trim()) continue
        const key = raw.trim().toLowerCase()
        if (!byKey.has(key)) byKey.set(key, raw.trim())
      }
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b))
  }
  const data = await api.get<{ locations: string[] }>('/competitors/locations', {
    requirePosts: '1',
  })
  return data.locations ?? []
}

/** How many accounts match Overview location · follower-range filters. */
export async function getCompetitorFilterCount(filters: {
  location: string
  followerRangeLabel: string
}): Promise<{ matching: number; total: number }> {
  if (!USE_MOCKS) {
    return api.get<{ matching: number; total: number }>('/competitors/filter-count', {
      location: filters.location,
      followerRangeLabel: filters.followerRangeLabel,
    })
  }
  await delay()
  const range = followerBuckets[filters.followerRangeLabel]
  let matching = 0
  for (const a of accounts) {
    if (a.approvalStatus === 'deleted') continue
    if (filters.location !== 'Global') {
      const country = a.location.country ?? a.enrichment?.country
      if (!country || country.toLowerCase() !== filters.location.toLowerCase()) continue
    }
    if (range) {
      const [min, max] = range
      const f = a.latestFollowerCount
      if (f == null) continue
      if (f < min) continue
      if (max != null && f >= max) continue
    }
    matching += 1
  }
  return { matching, total: accounts.filter((a) => a.approvalStatus !== 'deleted').length }
}

export async function listGroups(): Promise<(CompetitorGroup & { memberCount: number })[]> {
  if (USE_MOCKS) {
    await delay()
    return mockGroups.map((g) => ({
      ...g,
      memberCount: accounts.filter((a) => a.groupIds.includes(g.id)).length,
    }))
  }
  const data = await api.get<unknown[]>('/competitor-groups')
  return z.array(competitorGroup.extend({ memberCount: z.number() })).parse(data)
}

export async function listSuggestions(): Promise<CompetitorSuggestion[]> {
  if (USE_MOCKS) {
    await delay()
    return suggestions.filter((s) => s.status === 'pending' || s.status === 'saved-for-later')
  }
  return z.array(competitorSuggestion).parse(await api.get<unknown[]>('/competitor-suggestions'))
}

export interface NewCompetitorInput {
  username: string
  displayName: string
  website: string | null
  country: string
  city: string | null
  language: string | null
  role: CompetitorAccount['role']
  specialization: string | null
  internalNotes: string | null
  /** From profile lookup, when available. */
  followerCount?: number | null
}

/**
 * Parse any accepted competitor input — full Instagram URL, @handle, or bare
 * username — down to the username. Returns null when nothing valid is found.
 */
export function parseInstagramInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/)
  const candidate = (urlMatch ? urlMatch[1] : trimmed.replace(/^@/, '')).toLowerCase()
  if (!/^[a-z0-9._]{2,30}$/.test(candidate)) return null
  return candidate
}

export interface ProfilePreview {
  username: string
  displayName: string
  biography: string
  website: string | null
  followerCount: number
  followingCount: number
  postCount: number
  verified: boolean
  locationGuess: { country: string; city: string | null }
  suggestedRole: CompetitorAccount['role']
  /** What collection will do once the account is approved. */
  plannedCollection: string
}

/**
 * Mock profile lookup — deterministic enrichment from the username so the
 * two-step add flow (URL → preview → confirm) works before Apify exists.
 * Phase 6 swaps the internals for a real single-account Apify run; the UI
 * and return shape stay the same.
 */
export async function lookupCompetitorProfile(input: string): Promise<ProfilePreview> {
  if (!USE_MOCKS) {
    // Real single-account Apify run behind the API.
    return api.post<ProfilePreview>('/competitors/lookup', { input })
  }
  await delay()
  const username = parseInstagramInput(input)
  if (!username) {
    throw new Error('Enter an Instagram URL (instagram.com/…) or a username.')
  }
  if (accounts.some((a) => a.username.toLowerCase() === username)) {
    throw new Error(`@${username} is already in the competitor list.`)
  }
  // Deterministic pseudo-profile derived from the username.
  let hash = 0
  for (const ch of username) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const followerCount = 1200 + (hash % 45000)
  const cities = ['Barcelona', 'Madrid', 'Valencia', 'Bilbao', null] as const
  const displayName = username
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  return {
    username,
    displayName,
    biography: `Interior design studio · Projects & process · ${displayName}`,
    website: hash % 3 === 0 ? null : `https://${username.replace(/[._]/g, '')}.com`,
    followerCount,
    followingCount: 300 + (hash % 900),
    postCount: 80 + (hash % 400),
    verified: hash % 11 === 0,
    locationGuess: { country: 'Spain', city: cities[hash % cities.length] },
    suggestedRole:
      followerCount > 30000 ? 'aspirational' : followerCount < 4000 ? 'emerging' : 'peer-benchmark',
    plannedCollection:
      'On add: profile snapshot only. Use Scrape posts on selected rows for the last 30 days.',
  }
}

export async function addCompetitor(input: NewCompetitorInput): Promise<CompetitorAccount> {
  if (!USE_MOCKS) {
    return competitorAccount.parse(await api.post<unknown>('/competitors', input))
  }
  await delay()
  if (accounts.some((a) => a.username.toLowerCase() === input.username.toLowerCase())) {
    throw new Error(`@${input.username} is already in the competitor list.`)
  }
  const account: CompetitorAccount = {
    id: `comp-new-${accounts.length}`,
    platform: 'instagram',
    username: input.username,
    displayName: input.displayName || input.username,
    profileImageUrl: null,
    website: input.website,
    location: { country: input.country, region: null, city: input.city },
    language: input.language,
    niche: 'interior-design',
    services: [],
    specialization: input.specialization,
    targetAudience: null,
    positioningNote: null,
    role: input.role,
    approvalStatus: 'awaiting-review',
    groupIds: [],
    relevantCustomerIds: [],
    internalNotes: input.internalNotes,
    latestFollowerCount: input.followerCount ?? null,
    lastSuccessfulCollectionAt: null,
    dataQuality: null,
    addedAt: new Date().toISOString(),
    addedBy: 'manual',
  }
  accounts.unshift(account)
  return account
}

export interface BulkCompetitorInput {
  inputs: string[]
  role: CompetitorAccount['role']
  internalNotes: string | null
}

export interface BulkAddResult {
  added: { id: string; username: string }[]
  skipped: { username: string; reason: string }[]
  failed: { username: string; error: string }[]
  role: string
}

/** Split a paste of handles/URLs (newline, comma, or semicolon separated). */
export function parseBulkInstagramInputs(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[\n,;]+/)) {
    const raw = part.trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

/**
 * Add many Instagram accounts at once. Duplicates and invalid handles are
 * reported in the result; valid new accounts are created and profile-snapshotted
 * in the background (same as single add).
 */
export async function addCompetitorsBulk(input: BulkCompetitorInput): Promise<BulkAddResult> {
  if (!USE_MOCKS) {
    return api.post<BulkAddResult>('/competitors/bulk', input)
  }
  await delay()
  const added: BulkAddResult['added'] = []
  const skipped: BulkAddResult['skipped'] = []
  const failed: BulkAddResult['failed'] = []
  for (const raw of input.inputs) {
    const username = parseInstagramInput(raw)
    if (!username) {
      failed.push({ username: raw.trim(), error: 'Invalid Instagram username or URL' })
      continue
    }
    if (accounts.some((a) => a.username.toLowerCase() === username)) {
      skipped.push({ username, reason: 'Already in the competitor list' })
      continue
    }
    const account = await addCompetitor({
      username,
      displayName: username,
      website: null,
      country: 'Unknown',
      city: null,
      language: null,
      role: input.role,
      specialization: null,
      internalNotes: input.internalNotes,
      followerCount: null,
    })
    added.push({ id: account.id, username: account.username })
  }
  return { added, skipped, failed, role: input.role }
}

export async function setApprovalStatus(
  ids: string[],
  status: CompetitorAccount['approvalStatus'],
): Promise<void> {
  if (!USE_MOCKS) {
    await api.patch('/competitors/status', { ids, status })
    return
  }
  await delay()
  for (const account of accounts) {
    if (ids.includes(account.id)) account.approvalStatus = status
  }
}

export interface DeleteResult {
  removed: number
  purged: number
}

/**
 * Remove competitors from the register.
 *
 * Default is reversible: the account is marked `deleted` and stops being
 * collected, but its snapshots and posts survive so past benchmarks stay
 * reproducible. `purge` destroys the account and every observation of it — for
 * accounts added by mistake, where keeping history would mislead.
 */
export async function deleteCompetitors(ids: string[], purge = false): Promise<DeleteResult> {
  if (!USE_MOCKS) {
    return api.del<DeleteResult>('/competitors', { ids, purge })
  }
  await delay()
  if (purge) {
    for (const id of ids) {
      const index = accounts.findIndex((a) => a.id === id)
      if (index >= 0) accounts.splice(index, 1)
    }
    return { removed: 0, purged: ids.length }
  }
  for (const account of accounts) {
    if (ids.includes(account.id)) account.approvalStatus = 'deleted'
  }
  return { removed: ids.length, purged: 0 }
}

export async function resolveSuggestion(
  id: string,
  resolution: 'approved' | 'rejected' | 'saved-for-later',
  rejectionReason?: string,
): Promise<void> {
  if (resolution === 'rejected' && !rejectionReason?.trim()) {
    throw new Error('A rejection reason is required so this account is not re-suggested.')
  }
  if (!USE_MOCKS) {
    await api.patch(`/competitor-suggestions/${id}`, { resolution, rejectionReason: rejectionReason ?? null })
    return
  }
  await delay()
  const suggestion = suggestions.find((s) => s.id === id)
  if (!suggestion) return
  suggestion.status = resolution
  suggestion.rejectionReason = rejectionReason ?? null
  if (resolution === 'approved') {
    await addCompetitor({
      username: suggestion.username,
      displayName: suggestion.username,
      website: null,
      country: 'Spain',
      city: null,
      language: null,
      role: suggestion.suggestedRole,
      specialization: null,
      internalNotes: `Approved from discovery: ${suggestion.reason}`,
    }).catch(() => undefined)
  }
  suggestions = [...suggestions]
}


export interface CompetitorDetail {
  account: CompetitorAccount
  followerChange: number | null
  postsCollected: number
  postsPerWeek: number
  medianEngagementRate: number
  /** Authority pillar mix — share of classified posts per pillar. */
  authorityMix: { pillar: 'discovery' | 'credibility' | 'trust'; sharePct: number; peerPct: number }[]
  topFormats: { label: string; sharePct: number }[]
  topTopics: { label: string; sharePct: number }[]
  lastCollectionAt: string | null
  followerSeries: number[]
}

/**
 * Detail for one competitor, derived deterministically from the account so
 * the panel stays stable across renders.
 */
export async function getCompetitorDetail(
  id: string,
  period: ComparisonPeriod,
): Promise<CompetitorDetail | null> {
  if (!USE_MOCKS) {
    try {
      return await api.get<CompetitorDetail>(`/competitors/${id}`, { period })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  return getCompetitorDetailSync(id, period)
}

function getCompetitorDetailSync(id: string, period: ComparisonPeriod): CompetitorDetail | null {
  const account = accounts.find((a) => a.id === id)
  if (!account) return null

  let hash = 0
  for (const ch of account.id + account.username) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const pick = (min: number, max: number, salt: number) =>
    min + (((hash >>> salt) % 1000) / 1000) * (max - min)
  const round = (n: number) => Math.round(n * 10) / 10

  const windowScale = periodMeta(period).days / 30
  const followers = account.latestFollowerCount ?? 0

  const discovery = round(pick(18, 42, 2))
  const credibility = round(pick(18, 40, 5))
  const trust = round(Math.max(8, 100 - discovery - credibility - pick(20, 40, 8)))

  return {
    account,
    followerChange:
      mockFollowerChange[account.id] != null
        ? round(mockFollowerChange[account.id] * windowScale)
        : null,
    postsCollected: Math.max(1, Math.round(pick(60, 320, 3) * windowScale)),
    postsPerWeek: round(pick(1.4, 6.2, 6)),
    medianEngagementRate: round(pick(0.9, 4.6, 9)),
    authorityMix: [
      { pillar: 'discovery', sharePct: discovery, peerPct: 30 },
      { pillar: 'credibility', sharePct: credibility, peerPct: 34 },
      { pillar: 'trust', sharePct: trust, peerPct: 24 },
    ],
    topFormats: [
      { label: 'Carousel', sharePct: round(pick(24, 48, 4)) },
      { label: 'Reel', sharePct: round(pick(18, 40, 7)) },
      { label: 'Single image', sharePct: round(pick(8, 26, 10)) },
    ],
    topTopics: [
      { label: 'Kitchen projects', sharePct: round(pick(12, 30, 11)) },
      { label: 'Materials & finishes', sharePct: round(pick(8, 24, 12)) },
      { label: 'Full-home renovation', sharePct: round(pick(6, 20, 13)) },
    ],
    lastCollectionAt: account.lastSuccessfulCollectionAt,
    followerSeries: Array.from({ length: 8 }, (_, i) =>
      Math.round(followers * (0.9 + (i / 7) * 0.1 + (((hash >>> i) % 100) / 100) * 0.01)),
    ),
  }
}


export interface CollectionStatus {
  /** Last successful Apify scrape across the tracked accounts. */
  /** null until a collection run has completed. */
  lastRunAt: string | null
  accountsProcessed: number
  postsCollected: number
  failures: number
  source: 'Apify'
}

export async function getCollectionStatus(): Promise<CollectionStatus> {
  if (!USE_MOCKS) {
    return api.get<CollectionStatus>('/collection/status')
  }
  await delay()
  const collected = accounts.filter((a) => a.lastSuccessfulCollectionAt != null)
  const lastRunAt = collected
    .map((a) => a.lastSuccessfulCollectionAt!)
    .sort()
    .at(-1)!
  return {
    lastRunAt,
    accountsProcessed: collected.length,
    postsCollected: 24851,
    failures: accounts.filter((a) => a.dataQuality === 'failed').length,
    source: 'Apify',
  }
}

export interface PostScrapePlan {
  started: { id: string; username: string }[]
  skipped: { id: string; username: string; lastPostsCollectedAt: string }[]
  windowDays: number
}

/**
 * Scrape last-N-days posts for selected competitors. Accounts scraped inside
 * that window are skipped and listed in the response.
 */
export async function scrapeCompetitorPosts(ids: string[]): Promise<PostScrapePlan> {
  if (!USE_MOCKS) {
    return api.post<PostScrapePlan>('/collection/scrape-posts', { ids })
  }
  // Mimic a real scrape so the UI loader is visible in mock mode.
  await delay(1800)
  const windowDays = 30
  const cutoff = Date.now() - windowDays * 864e5
  const started: PostScrapePlan['started'] = []
  const skipped: PostScrapePlan['skipped'] = []
  for (const id of ids) {
    const account = accounts.find((a) => a.id === id)
    if (!account) continue
    const last = account.lastPostsCollectedAt
    if (last && new Date(last).getTime() >= cutoff) {
      skipped.push({ id, username: account.username, lastPostsCollectedAt: last })
    } else {
      started.push({ id, username: account.username })
      account.lastPostsCollectedAt = new Date().toISOString()
    }
  }
  return { started, skipped, windowDays }
}

export interface EnrichmentPlan {
  started: { id: string; username: string }[]
  skipped: { id: string; username: string; lastEnrichmentAt: string }[]
  failed: { id: string; username: string; error: string }[]
  enriched: { id: string; username: string }[]
  windowDays: number
}

/**
 * Run Claude enrichment for selected competitors. Accounts enriched inside
 * the last windowDays are skipped.
 */
export async function enrichCompetitorAccounts(ids: string[]): Promise<EnrichmentPlan> {
  if (!USE_MOCKS) {
    return api.post<EnrichmentPlan>('/collection/enrich-accounts', { ids })
  }
  await delay(1600)
  const windowDays = 30
  const cutoff = Date.now() - windowDays * 864e5
  const started: EnrichmentPlan['started'] = []
  const skipped: EnrichmentPlan['skipped'] = []
  const enriched: EnrichmentPlan['enriched'] = []
  for (const id of ids) {
    const account = accounts.find((a) => a.id === id)
    if (!account) continue
    const last = account.lastEnrichmentAt
    if (last && new Date(last).getTime() >= cutoff) {
      skipped.push({ id, username: account.username, lastEnrichmentAt: last })
    } else {
      started.push({ id, username: account.username })
      account.lastEnrichmentAt = new Date().toISOString()
      account.enrichment = {
        country: account.location.country,
        countryConfidence: account.location.country ? 'Medium' : null,
        accountType: account.niche ?? 'Independent practice',
        followersCount: account.latestFollowerCount,
        postsAnalyzed: 12,
        averagePostsPerWeek: 2.5,
        postingFrequency: 'Weekly',
        averageLikes: 40,
        averageComments: 3,
        engagementRate: 1.2,
        estimatedPerformance: 'Average',
        primaryContentType: account.specialization ?? 'Interior design',
        dominantPostFormat: 'carousel',
        latestPostDate: new Date().toISOString(),
        model: 'mock-claude',
      }
      enriched.push({ id, username: account.username })
    }
  }
  return { started, skipped, failed: [], enriched, windowDays }
}

/**
 * Raw Apify payloads behind an account's posts — the inspector behind the JSON
 * button on each competitor row.
 *
 * Only posts collected since raw capture was added carry a payload, so an item
 * with `payload: null` is normal for older history rather than an error.
 */
export async function getRawPosts(id: string, limit = 50): Promise<RawPostsResponse | null> {
  if (!USE_MOCKS) {
    try {
      return rawPostsResponse.parse(await api.get<unknown>(`/competitors/${id}/raw-posts`, { limit }))
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }

  await delay()
  const account = accounts.find((a) => a.id === id)
  if (!account) return null
  // Mock mode has no scraper behind it — show the shape, not invented payloads.
  return { username: account.username, lastCollectedAt: null, windowDays: 30, totalPosts: 0, capturedCount: 0, items: [] }
}

function scopeKey(input: {
  location?: string
  followerRangeLabel?: string
  period?: string
}): string {
  return [
    input.location ?? 'Global',
    input.followerRangeLabel ?? 'All sizes',
    input.period ?? 'last-30',
  ].join('|')
}

/** Saved analysis for the given Overview filters (or newest overall if none). */
export async function getLatestAnalysis(filters?: {
  location?: string
  followerRangeLabel?: string
  period?: string
}): Promise<CompetitorAnalysis | null> {
  if (!USE_MOCKS) {
    const data = await api.get<unknown>(
      '/analysis/latest',
      filters
        ? {
            location: filters.location,
            followerRangeLabel: filters.followerRangeLabel,
            period: filters.period,
          }
        : undefined,
    )
    if (data == null) return null
    return competitorAnalysis.parse(data)
  }
  await delay()
  if (filters) return mockAnalyses.get(scopeKey(filters)) ?? null
  const values = [...mockAnalyses.values()]
  return values.at(-1) ?? null
}

const mockAnalyses = new Map<string, CompetitorAnalysis>()

/** Run Claude over filtered competitor posts for the Overview dashboard. */
export async function runCompetitorAnalysis(input?: {
  location?: string
  followerRangeLabel?: string
  period?: string
  windowDays?: number
}): Promise<CompetitorAnalysis> {
  const windowDays = input?.windowDays ?? 30
  const location = input?.location ?? 'Global'
  const followerRangeLabel = input?.followerRangeLabel ?? 'All sizes'
  const period = input?.period ?? 'last-30'
  if (!USE_MOCKS) {
    try {
      return competitorAnalysis.parse(
        await api.post<unknown>('/analysis/run', {
          location,
          followerRangeLabel,
          period,
          windowDays,
        }),
      )
    } catch (err) {
      if (err instanceof ApiError) {
        try {
          const latest = await getLatestAnalysis({ location, followerRangeLabel, period })
          if (latest?.status === 'failed') return latest
        } catch {
          /* fall through */
        }
      }
      throw err
    }
  }
  await delay(2200)
  const { computeDashboard } = await import('../intelligence/repository')
  const { defaultFilters } = await import('../intelligence/filters')
  const dashboard = computeDashboard({
    ...defaultFilters,
    location,
    followerRangeLabel,
    period: period as typeof defaultFilters.period,
  })
  const saved: CompetitorAnalysis = {
    id: `analysis-${Date.now()}`,
    status: 'completed',
    windowDays,
    model: 'mock-claude',
    markdown: null,
    dashboard,
    error: null,
    accountsAnalyzed: dashboard.summary.accountsAnalyzed,
    postsAnalyzed: dashboard.summary.postsAnalyzed,
    filterScope: {
      location,
      followerRangeLabel,
      period,
      windowDays,
    },
    startedAt: new Date(Date.now() - 2200).toISOString(),
    finishedAt: new Date().toISOString(),
  }
  mockAnalyses.set(scopeKey({ location, followerRangeLabel, period }), saved)
  return saved
}
