import type { CompetitorAccount, CompetitorGroup, CompetitorSuggestion } from '../../types'

/*
 * Deterministic mock competitor dataset (~162 accounts, matching the mockup
 * counts). Generated with a seeded PRNG so tests and reloads always see the
 * same data. All records conform to the Phase 2 schemas.
 */

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260719)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min

export const mockGroups: CompetitorGroup[] = [
  { id: 'grp-comparable', name: 'Comparable (20–30)', type: 'peer', origin: 'manual', reviewed: true, customerId: null, memberAccountIds: [], criteriaNote: 'Spain · 5K–20K · interior studios', createdAt: '2026-04-01T09:00:00Z' },
  { id: 'grp-spain', name: 'Spain Studios', type: 'peer', origin: 'manual', reviewed: true, customerId: null, memberAccountIds: [], criteriaNote: null, createdAt: '2026-04-01T09:00:00Z' },
  { id: 'grp-larger', name: 'Larger Accounts', type: 'larger-account', origin: 'manual', reviewed: true, customerId: null, memberAccountIds: [], criteriaNote: null, createdAt: '2026-04-05T09:00:00Z' },
  { id: 'grp-emerging', name: 'Emerging Accounts', type: 'emerging', origin: 'auto-suggested', reviewed: true, customerId: null, memberAccountIds: [], criteriaNote: 'Observed growth > 8%/mo', createdAt: '2026-05-02T09:00:00Z' },
  { id: 'grp-content', name: 'Content-Style Group', type: 'content-style', origin: 'manual', reviewed: true, customerId: null, memberAccountIds: [], criteriaNote: null, createdAt: '2026-04-20T09:00:00Z' },
  { id: 'grp-valencia', name: 'Local – Valencia', type: 'local', origin: 'auto-suggested', reviewed: false, customerId: 'cust-luz', memberAccountIds: [], criteriaNote: 'Customer market: Valencia', createdAt: '2026-06-01T09:00:00Z' },
]

const namePartsA = ['Atelier', 'Studio', 'Casa', 'Nordic', 'Urban', 'Forma', 'Interior', 'Luz', 'Raum', 'Haus', 'Bo', 'Piedra', 'Verde', 'Blanco', 'Norte', 'Sur', 'Este', 'Aura', 'Linea', 'Marca'] as const
const namePartsB = ['Dawn', 'Terra', 'Design', 'Interiors', 'Konzept', 'Arquitectura', 'Living', 'Space', 'Projects', 'Works', 'Studio', 'Lab', 'Collective', 'Form', 'Casa', 'Objects', 'Craft', 'Milieu'] as const

const locations = [
  { country: 'Spain', city: 'Barcelona', weight: 5 },
  { country: 'Spain', city: 'Madrid', weight: 5 },
  { country: 'Spain', city: 'Valencia', weight: 4 },
  { country: 'Spain', city: 'Bilbao', weight: 2 },
  { country: 'Spain', city: 'Sevilla', weight: 2 },
  { country: 'Netherlands', city: 'Amsterdam', weight: 2 },
  { country: 'Netherlands', city: 'Rotterdam', weight: 1 },
  { country: 'Germany', city: 'Berlin', weight: 2 },
  { country: 'Germany', city: 'München', weight: 1 },
  { country: 'Denmark', city: 'Copenhagen', weight: 2 },
] as const
const weightedLocations = locations.flatMap((l) => Array.from({ length: l.weight }, () => l))

const roles = ['direct-competitor', 'peer-benchmark', 'local-competitor', 'high-performing-peer', 'aspirational', 'emerging', 'content-style'] as const

function statusFor(index: number): CompetitorAccount['approvalStatus'] {
  // Distribution matching the mockup: 112 approved+included, 28 watchlist,
  // remainder excluded / suggested / failed / private.
  if (index < 98) return 'included-in-benchmarks'
  if (index < 112) return 'approved'
  if (index < 140) return 'watchlist-only'
  if (index < 150) return 'excluded'
  if (index < 155) return 'awaiting-review'
  if (index < 159) return 'collection-failed'
  return 'private'
}

function groupsFor(status: CompetitorAccount['approvalStatus'], country: string, city: string, followers: number): string[] {
  const ids: string[] = []
  if (status === 'included-in-benchmarks' && followers >= 5000 && followers <= 20000 && country === 'Spain') ids.push('grp-comparable')
  if (country === 'Spain') ids.push('grp-spain')
  if (followers > 20000) ids.push('grp-larger')
  if (followers < 5000) ids.push('grp-emerging')
  if (city === 'Valencia') ids.push('grp-valencia')
  if (ids.length === 0) ids.push('grp-content')
  return ids
}

function buildAccount(index: number): CompetitorAccount {
  const a = pick(namePartsA)
  const b = pick(namePartsB)
  const name = `${a} ${b}`
  const username = `${a}${b}`.toLowerCase().replace(/\s+/g, '.') + (index > 40 ? String(index) : '')
  const location = pick(weightedLocations)
  const followers = randInt(800, 90000)
  const status = statusFor(index)
  const qualityPool = ['complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'partial', 'low'] as const
  const quality = qualityPool[randInt(0, qualityPool.length - 1)]
  return {
    id: `comp-${index}`,
    platform: 'instagram',
    username,
    displayName: name,
    profileImageUrl: null,
    website: rand() > 0.3 ? `https://${username.replace(/\./g, '')}.com` : null,
    location: { country: location.country, region: null, city: location.city },
    language: location.country === 'Spain' ? 'es' : location.country === 'Germany' ? 'de' : 'en',
    niche: 'interior-design',
    services: rand() > 0.5 ? ['residential'] : ['residential', 'commercial'],
    specialization: pick(['kitchens', 'full-home renovations', 'small spaces', 'commercial interiors', 'lighting'] as const),
    targetAudience: null,
    positioningNote: null,
    role: status === 'watchlist-only' ? pick(['emerging', 'aspirational', 'content-style'] as const) : pick(roles),
    approvalStatus: status,
    groupIds: groupsFor(status, location.country, location.city, followers),
    relevantCustomerIds: location.city === 'Valencia' ? ['cust-luz'] : [],
    internalNotes: null,
    latestFollowerCount: followers,
    lastSuccessfulCollectionAt:
      status === 'collection-failed' || status === 'private'
        ? null
        : `2026-07-${String(randInt(12, 19)).padStart(2, '0')}T0${randInt(1, 9)}:00:00Z`,
    dataQuality: status === 'collection-failed' ? 'failed' : status === 'private' ? null : quality,
    addedAt: `2026-0${randInt(4, 6)}-${String(randInt(1, 28)).padStart(2, '0')}T10:00:00Z`,
    addedBy: rand() > 0.25 ? 'manual' : 'discovery',
  }
}

export const mockCompetitors: CompetitorAccount[] = Array.from({ length: 162 }, (_, i) => buildAccount(i))

/** Observed 30-day follower change per account (view data, deterministic). */
export const mockFollowerChange: Record<string, number> = Object.fromEntries(
  mockCompetitors.map((c) => [c.id, Math.round((rand() * 12 - 3) * 10) / 10]),
)

export const mockSuggestions: CompetitorSuggestion[] = [
  {
    id: 'sug-1',
    username: 'estudio.mirall',
    reason: 'Barcelona interior studio in the 5K–20K range with strong educational-carousel output, similar service mix to your comparable group.',
    similarity: { locationMatch: true, followerRangeMatch: true, serviceMatch: true, contentStyleMatch: true },
    suggestedRole: 'peer-benchmark',
    confidence: 0.91,
    status: 'pending',
    rejectionReason: null,
    suggestedAt: '2026-07-17T08:00:00Z',
  },
  {
    id: 'sug-2',
    username: 'lumen.interiores',
    reason: 'Valencia studio frequently mentioned alongside two accounts in the Local – Valencia group; lighting specialization.',
    similarity: { locationMatch: true, followerRangeMatch: true, serviceMatch: false, contentStyleMatch: true },
    suggestedRole: 'local-competitor',
    confidence: 0.78,
    status: 'pending',
    rejectionReason: null,
    suggestedAt: '2026-07-17T08:00:00Z',
  },
  {
    id: 'sug-3',
    username: 'studio.fjord.cph',
    reason: 'Copenhagen aspirational account (64K) with the strongest process-content adoption in the Nordic set.',
    similarity: { locationMatch: false, followerRangeMatch: false, serviceMatch: true, contentStyleMatch: true },
    suggestedRole: 'aspirational',
    confidence: 0.66,
    status: 'pending',
    rejectionReason: null,
    suggestedAt: '2026-07-16T08:00:00Z',
  },
  {
    id: 'sug-4',
    username: 'homestories.es',
    reason: 'High-growth Spanish account; content is home-decor retail rather than studio work — verify relevance.',
    similarity: { locationMatch: true, followerRangeMatch: true, serviceMatch: false, contentStyleMatch: false },
    suggestedRole: 'content-style',
    confidence: 0.41,
    status: 'pending',
    rejectionReason: null,
    suggestedAt: '2026-07-15T08:00:00Z',
  },
]
