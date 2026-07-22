import { describe, expect, it } from 'vitest'
import { competitorAccount, competitorSuggestion } from '../../types'
import { mockCompetitors, mockSuggestions } from './mockData'
import {
  addCompetitor,
  defaultCompetitorQuery,
  listCompetitorsSync,
  resolveSuggestion,
} from './repository'

describe('competitor mock dataset', () => {
  it('validates against the Phase 2 schemas', () => {
    for (const c of mockCompetitors) {
      const result = competitorAccount.safeParse(c)
      expect(result.success, `${c.id}: ${JSON.stringify(result.error?.issues?.[0])}`).toBe(true)
    }
    for (const s of mockSuggestions) {
      expect(competitorSuggestion.safeParse(s).success).toBe(true)
    }
  })

  it('matches the mockup distribution', () => {
    const r = listCompetitorsSync(defaultCompetitorQuery)
    expect(r.stats.total).toBe(162)
    expect(r.stats.inBenchmarks).toBe(98)
    expect(r.stats.approved).toBe(112)
    expect(r.stats.watchlist).toBe(28)
  })
})

describe('listCompetitorsSync', () => {
  it('paginates at the requested size', () => {
    const r = listCompetitorsSync(defaultCompetitorQuery)
    expect(r.rows).toHaveLength(8)
    expect(r.pageCount).toBe(Math.ceil(r.total / 8))
    const page2 = listCompetitorsSync({ ...defaultCompetitorQuery, page: 2 })
    expect(page2.rows[0].id).not.toBe(r.rows[0].id)
  })

  it('searches by username fragment', () => {
    const target = mockCompetitors[10]
    const r = listCompetitorsSync({ ...defaultCompetitorQuery, search: target.username.slice(0, 8) })
    expect(r.total).toBeGreaterThan(0)
    expect(r.rows.some((row) => row.id === target.id)).toBe(true)
  })

  it('filters by country and follower range together', () => {
    const r = listCompetitorsSync({
      ...defaultCompetitorQuery,
      country: 'Spain',
      followerRange: '5K – 20K',
    })
    expect(r.total).toBeGreaterThan(0)
    for (const row of r.rows) {
      expect(row.location.country).toBe('Spain')
      expect(row.latestFollowerCount).toBeGreaterThanOrEqual(5000)
      expect(row.latestFollowerCount).toBeLessThan(20000)
    }
  })

  it('sorts by follower change ascending', () => {
    const r = listCompetitorsSync({ ...defaultCompetitorQuery, sort: 'change', sortDir: 'asc' })
    const changes = r.rows.map((row) => row.followerChange30d ?? 0)
    expect([...changes].sort((a, b) => a - b)).toEqual(changes)
  })
})

describe('mutations', () => {
  it('rejects duplicate usernames on add', async () => {
    const existing = mockCompetitors[0].username
    await expect(
      addCompetitor({
        username: existing,
        displayName: 'Dup',
        website: null,
        country: 'Spain',
        city: null,
        language: null,
        role: 'peer-benchmark',
        specialization: null,
        internalNotes: null,
      }),
    ).rejects.toThrow(/already in the competitor list/)
  })

  it('requires a reason to reject a suggestion', async () => {
    await expect(resolveSuggestion('sug-4', 'rejected')).rejects.toThrow(/reason is required/)
  })
})

describe('profile lookup', () => {
  it('parses URLs, handles and bare usernames', async () => {
    const { parseInstagramInput } = await import('./repository')
    expect(parseInstagramInput('https://instagram.com/studio.example/')).toBe('studio.example')
    expect(parseInstagramInput('https://www.instagram.com/Studio_Example?igsh=x')).toBe('studio_example')
    expect(parseInstagramInput('@Studio.Example')).toBe('studio.example')
    expect(parseInstagramInput('studio.example')).toBe('studio.example')
    expect(parseInstagramInput('not a handle!')).toBeNull()
    expect(parseInstagramInput('')).toBeNull()
  })

  it('returns a deterministic profile preview', async () => {
    const { lookupCompetitorProfile } = await import('./repository')
    const a = await lookupCompetitorProfile('https://instagram.com/nuevo.estudio')
    const b = await lookupCompetitorProfile('@nuevo.estudio')
    expect(a).toEqual(b)
    expect(a.username).toBe('nuevo.estudio')
    expect(a.followerCount).toBeGreaterThan(0)
  })

  it('rejects accounts already in the list', async () => {
    const { lookupCompetitorProfile } = await import('./repository')
    const { mockCompetitors } = await import('./mockData')
    await expect(lookupCompetitorProfile(mockCompetitors[0].username)).rejects.toThrow(/already/)
  })
})

describe('deleted accounts', () => {
  it('are hidden from the list', () => {
    // There is no approval workflow any more: an account is either in the
    // register or deleted, and deleted never appears.
    const r = listCompetitorsSync(defaultCompetitorQuery)
    for (let page = 1; page <= r.pageCount; page += 1) {
      const p = listCompetitorsSync({ ...defaultCompetitorQuery, page })
      expect(p.rows.every((row) => row.approvalStatus !== 'deleted')).toBe(true)
    }
  })

  it('are excluded from the headline total, so it matches the list', () => {
    const r = listCompetitorsSync({ ...defaultCompetitorQuery, pageSize: 500 })
    expect(r.stats.total).toBe(r.total)
  })
})
