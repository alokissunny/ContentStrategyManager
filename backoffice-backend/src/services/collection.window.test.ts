import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const scrapeProfile = vi.fn()
const scrapePosts = vi.fn()
vi.mock('./instagram.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./instagram.ts')>()),
  scrapeProfile: (...a: unknown[]) => scrapeProfile(...a),
  scrapePosts: (...a: unknown[]) => scrapePosts(...a),
}))

const { CompetitorAccount } = await import('../models/CompetitorAccount.ts')
const { AccountSnapshot, Post, PostMetricSnapshot } = await import('../models/snapshots.ts')
const { collectAccount } = await import('./collection.ts')

let mongo: MongoMemoryServer

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

beforeEach(async () => {
  vi.clearAllMocks()
  await Promise.all([
    CompetitorAccount.deleteMany({}),
    AccountSnapshot.deleteMany({}),
    Post.deleteMany({}),
    PostMetricSnapshot.deleteMany({}),
  ])
})

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

describe('collectAccount date window', () => {
  it('keeps only posts inside the requested window', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    scrapePosts.mockResolvedValue([
      post('recent', daysAgo(5)),
      post('edge', daysAgo(59)),
      post('old', daysAgo(75)), // outside a 60-day backfill
    ])

    const result = await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(result.postsCollected).toBe(2)
    const stored = (await Post.find({ accountId: account._id })).map((p) => p.platformPostId).sort()
    expect(stored).toEqual(['edge', 'recent'])
  })

  it('passes the post limit through to the scraper', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    scrapePosts.mockResolvedValue([])

    await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(scrapePosts).toHaveBeenCalledWith('peer', 90)
  })

  it('keeps undated posts rather than silently dropping them', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    scrapePosts.mockResolvedValue([post('undated', null)])

    const result = await collectAccount(account._id, null, { sinceDays: 60 })

    expect(result.postsCollected).toBe(1)
  })

  it('collects everything when no window is given', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    scrapePosts.mockResolvedValue([post('a', daysAgo(5)), post('b', daysAgo(400))])

    const result = await collectAccount(account._id)

    expect(result.postsCollected).toBe(2)
  })
})

describe('backfill window coverage', () => {
  it('reaches back a full 60 days', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    scrapePosts.mockResolvedValue([post('recent', daysAgo(1)), post('edge', daysAgo(59)), post('old', daysAgo(61))])

    const result = await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    const stored = (await Post.find({ accountId: account._id })).map((p) => p.platformPostId).sort()
    expect(stored).toEqual(['edge', 'recent'])
    expect(result.windowTruncated).toBe(false)
  })

  it('flags truncation when the post limit is hit before the window is covered', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    // A full pull whose oldest post is only ~18 days back: this account posts
    // faster than the limit covers, so 19-60 days ago was never fetched.
    scrapePosts.mockResolvedValue(Array.from({ length: 90 }, (_, i) => post(`p${i}`, daysAgo(i * 0.2))))

    const result = await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(result.windowTruncated).toBe(true)
    expect(result.ok).toBe(true) // the data collected is still sound
    expect(result.error).toBeNull()
  })

  it('does not flag truncation when the pull reaches past the cutoff', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    // Full pull, but it got all the way past 60 days — nothing was missed.
    scrapePosts.mockResolvedValue(Array.from({ length: 90 }, (_, i) => post(`p${i}`, daysAgo(i * 0.9))))

    const result = await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(result.windowTruncated).toBe(false)
  })

  it('does not flag truncation on a short pull', async () => {
    const account = await CompetitorAccount.create({ username: 'peer' })
    scrapeProfile.mockResolvedValue(profile)
    // Only 12 posts exist at all — the account is simply quiet.
    scrapePosts.mockResolvedValue(Array.from({ length: 12 }, (_, i) => post(`p${i}`, daysAgo(i * 2))))

    const result = await collectAccount(account._id, null, { sinceDays: 60, postLimit: 90 })

    expect(result.windowTruncated).toBe(false)
  })
})
