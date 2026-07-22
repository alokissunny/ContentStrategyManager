import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Accounts enter the register with a profile snapshot only. Post scraping is
 * an explicit operator action (POST /collection/scrape-posts) and skips
 * accounts whose posts were already scraped inside the backfill window.
 */

const scrapeProfile = vi.fn()
const scrapePosts = vi.fn()
vi.mock('../services/instagram.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/instagram.ts')>()),
  scrapeProfile: (...a: unknown[]) => scrapeProfile(...a),
  scrapePosts: (...a: unknown[]) => scrapePosts(...a),
}))

const { CompetitorAccount } = await import('../models/CompetitorAccount.ts')
const { CompetitorSuggestion } = await import('../models/CompetitorGroup.ts')
const { Post } = await import('../models/snapshots.ts')
const { competitorRoutes } = await import('./competitors.ts')

let mongo: MongoMemoryServer
let port: number
let server: ReturnType<typeof app.listen>

const app = express()
app.use(express.json())
app.use('/api/backoffice', competitorRoutes)

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

const profile = {
  username: 'peer', displayName: 'Peer', biography: 'b', website: null, category: null,
  followerCount: 1000, followingCount: 10, visiblePostCount: 5, verified: false,
  profileImageUrl: null, missingFields: [], warnings: [],
}
const post = (id: string, publishedAt: Date | null) => ({
  platformPostId: id, url: null, publishedAt, caption: 'c', hashtags: [], mentions: [],
  format: 'image' as const, carouselCount: null, videoDurationSeconds: null,
  likes: 5, comments: 1, views: null, metricsHidden: false,
})

async function call(method: string, path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
}, 120_000)

afterAll(async () => {
  server.close()
  await mongoose.disconnect()
  await mongo.stop()
})

beforeEach(async () => {
  vi.clearAllMocks()
  scrapeProfile.mockResolvedValue(profile)
  scrapePosts.mockResolvedValue([
    post('inside-recent', daysAgo(3)),
    post('inside-edge', daysAgo(28)),
    post('outside', daysAgo(45)),
  ])
  await Promise.all([CompetitorAccount.deleteMany({}), CompetitorSuggestion.deleteMany({}), Post.deleteMany({})])
})

describe('profile snapshot on entry to the register', () => {
  it('snapshots profile only for a manually added competitor', async () => {
    const res = await call('POST', '/api/backoffice/competitors', { username: 'peer' })
    expect(res.status).toBe(201)

    await vi.waitFor(() => expect(scrapeProfile).toHaveBeenCalledWith('peer'), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(scrapePosts).not.toHaveBeenCalled()
    expect(await Post.countDocuments({})).toBe(0)

    const account = await CompetitorAccount.findOne({ username: 'peer' })
    expect(account?.lastPostsCollectedAt).toBeNull()
  })

  it('snapshots profile only for an approved suggestion', async () => {
    const suggestion = await CompetitorSuggestion.create({
      username: 'peer',
      suggestedRole: 'peer-benchmark',
      status: 'pending',
    })

    const res = await call('PATCH', `/api/backoffice/competitor-suggestions/${String(suggestion._id)}`, {
      resolution: 'approved',
    })
    expect(res.status).toBe(200)

    await vi.waitFor(() => expect(scrapeProfile).toHaveBeenCalledWith('peer'), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(scrapePosts).not.toHaveBeenCalled()
  })

  it('does not snapshot a suggestion whose account already exists', async () => {
    await CompetitorAccount.create({ username: 'peer' })
    const suggestion = await CompetitorSuggestion.create({
      username: 'peer',
      suggestedRole: 'peer-benchmark',
      status: 'pending',
    })

    await call('PATCH', `/api/backoffice/competitor-suggestions/${String(suggestion._id)}`, {
      resolution: 'approved',
    })

    await new Promise((r) => setTimeout(r, 300))
    expect(scrapeProfile).not.toHaveBeenCalled()
    expect(scrapePosts).not.toHaveBeenCalled()
  })

  it('does not snapshot a rejected suggestion', async () => {
    const suggestion = await CompetitorSuggestion.create({
      username: 'peer',
      suggestedRole: 'peer-benchmark',
      status: 'pending',
    })

    await call('PATCH', `/api/backoffice/competitor-suggestions/${String(suggestion._id)}`, {
      resolution: 'rejected',
    })

    await new Promise((r) => setTimeout(r, 300))
    expect(scrapeProfile).not.toHaveBeenCalled()
    expect(scrapePosts).not.toHaveBeenCalled()
    expect(await CompetitorAccount.countDocuments({})).toBe(0)
  })
})

describe('POST /collection/scrape-posts', () => {
  it('scrapes posts for selected accounts and skips fresh ones', async () => {
    const stale = await CompetitorAccount.create({
      username: 'stale',
      approvalStatus: 'approved',
      lastPostsCollectedAt: daysAgo(45),
    })
    const fresh = await CompetitorAccount.create({
      username: 'fresh',
      approvalStatus: 'approved',
      lastPostsCollectedAt: daysAgo(5),
    })
    const never = await CompetitorAccount.create({
      username: 'never',
      approvalStatus: 'approved',
      lastPostsCollectedAt: null,
    })

    scrapeProfile.mockImplementation(async (username: string) => ({ ...profile, username }))

    const res = await call('POST', '/api/backoffice/collection/scrape-posts', {
      ids: [String(stale._id), String(fresh._id), String(never._id)],
    })
    expect(res.status).toBe(200)
    expect(res.body.started.map((a: { username: string }) => a.username).sort()).toEqual(['never', 'stale'])
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ username: 'fresh' }),
    ])
    expect(res.body.windowDays).toBe(30)

    const scrapedUsernames = scrapePosts.mock.calls.map((c) => c[0]).sort()
    expect(scrapedUsernames).toEqual(['never', 'stale'])
    expect(scrapedUsernames).not.toContain('fresh')
  })
})
