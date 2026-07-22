import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The raw-payload inspector exists to answer "did the scraper return this, or
 * did we map it wrong?", so the contract that matters is fidelity: the payload
 * comes back byte-for-byte as the actor sent it, and a post with no stored
 * payload is reported as missing rather than quietly dropped.
 */

const scrapeProfile = vi.fn()
const scrapePosts = vi.fn()
vi.mock('../services/instagram.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/instagram.ts')>()),
  scrapeProfile: (...a: unknown[]) => scrapeProfile(...a),
  scrapePosts: (...a: unknown[]) => scrapePosts(...a),
}))

const { CompetitorAccount } = await import('../models/CompetitorAccount.ts')
const { Post, PostMetricSnapshot, AccountSnapshot, RawPostPayload } = await import('../models/snapshots.ts')
const { collectAccount } = await import('../services/collection.ts')
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

/* A payload with fields our normaliser does not know about — those are exactly
 * the ones an operator opens this view to find. */
const RAW_ITEM = {
  id: 'abc123',
  type: 'Sidecar',
  caption: 'hello world',
  likesCount: 42,
  undocumentedField: { nested: [1, 2, 3], flag: true },
  childPosts: [{ id: 'c1' }, { id: 'c2' }],
}

const scrapedPost = (id: string, publishedAt: Date, raw?: Record<string, unknown>) => ({
  platformPostId: id, url: `https://instagram.com/p/${id}`, publishedAt, caption: 'c',
  hashtags: [], mentions: [], format: 'image' as const, carouselCount: null,
  videoDurationSeconds: null, likes: 5, comments: 1, views: null, metricsHidden: false,
  ...(raw ? { raw } : {}),
})

interface RawPostsBody {
  username: string
  totalPosts: number
  capturedCount: number
  items: {
    platformPostId: string
    publishedAt: string | null
    url: string | null
    collectedAt: string | null
    source: string | null
    payload: Record<string, unknown> | null
  }[]
}

async function get(path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: res.status, body: (await res.json()) as RawPostsBody }
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
  await Promise.all([
    CompetitorAccount.deleteMany({}),
    Post.deleteMany({}),
    PostMetricSnapshot.deleteMany({}),
    AccountSnapshot.deleteMany({}),
    RawPostPayload.deleteMany({}),
  ])
})

describe('raw Apify payload capture', () => {
  it('stores the actor item untouched and serves it back verbatim', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2), RAW_ITEM)])

    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    const res = await get(`/api/backoffice/competitors/${String(account._id)}/raw-posts`)
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('peer')
    expect(res.body.capturedCount).toBe(1)
    expect(res.body.items).toHaveLength(1)
    // Fidelity is the whole point: unknown and nested fields must survive.
    expect(res.body.items[0].payload).toEqual(RAW_ITEM)
    expect(res.body.items[0].platformPostId).toBe('abc123')
  })

  it('reports posts with no stored payload as missing rather than hiding them', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    // Collected before raw capture existed: a post with no raw attached.
    scrapePosts.mockResolvedValue([scrapedPost('old1', daysAgo(3))])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    const res = await get(`/api/backoffice/competitors/${String(account._id)}/raw-posts`)
    expect(res.body.totalPosts).toBe(1)
    expect(res.body.capturedCount).toBe(0)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].payload).toBeNull()
  })

  it('replaces the payload on re-collection instead of accumulating copies', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })

    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2), { ...RAW_ITEM, likesCount: 42 })])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2), { ...RAW_ITEM, likesCount: 99 })])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(await RawPostPayload.countDocuments({ accountId: account._id })).toBe(1)
    const res = await get(`/api/backoffice/competitors/${String(account._id)}/raw-posts`)
    expect(res.body.items[0]?.payload?.likesCount).toBe(99)
  })

  it('does not overwrite a stored payload when a later scrape carries none', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2), RAW_ITEM)])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2))])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    const res = await get(`/api/backoffice/competitors/${String(account._id)}/raw-posts`)
    expect(res.body.items[0].payload).toEqual(RAW_ITEM)
  })

  it('404s an unknown competitor and 400s a malformed id', async () => {
    const missing = await get(`/api/backoffice/competitors/${String(new mongoose.Types.ObjectId())}/raw-posts`)
    expect(missing.status).toBe(404)

    const malformed = await get('/api/backoffice/competitors/not-an-id/raw-posts')
    expect(malformed.status).toBe(400)
  })

  it('purging a competitor leaves no raw payloads behind', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapePosts.mockResolvedValue([scrapedPost('abc123', daysAgo(2), RAW_ITEM)])
    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })
    expect(await RawPostPayload.countDocuments({})).toBe(1)

    const res = await fetch(`http://127.0.0.1:${port}/api/backoffice/competitors`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [String(account._id)], purge: true }),
    })
    expect(res.status).toBe(200)

    expect(await RawPostPayload.countDocuments({})).toBe(0)
  })
})
