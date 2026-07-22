import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Collection must be exercised without touching Apify.
const scrapeProfile = vi.fn()
const scrapePosts = vi.fn()
vi.mock('./instagram.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./instagram.ts')>()),
  scrapeProfile: (...args: unknown[]) => scrapeProfile(...args),
  scrapePosts: (...args: unknown[]) => scrapePosts(...args),
}))

const { CompetitorAccount } = await import('../models/CompetitorAccount.ts')
const { AccountSnapshot, CollectionRun, Post, PostMetricSnapshot } = await import('../models/snapshots.ts')
const { collectAccount, deriveDataQuality, runCollection } = await import('./collection.ts')

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
    CollectionRun.deleteMany({}),
  ])
})

const profileFixture = (followers: number) => ({
  username: 'peer.studio',
  displayName: 'Peer Studio',
  biography: 'Interior design',
  website: null,
  category: null,
  followerCount: followers,
  followingCount: 300,
  visiblePostCount: 120,
  verified: false,
  profileImageUrl: null,
  missingFields: [],
  warnings: [],
})

const postFixture = (id: string, likes = 100) => ({
  platformPostId: id,
  url: `https://instagram.com/p/${id}`,
  publishedAt: new Date(),
  caption: 'A calm kitchen #oak',
  hashtags: ['oak'],
  mentions: [],
  format: 'carousel' as const,
  carouselCount: 3,
  videoDurationSeconds: null,
  likes,
  comments: 10,
  views: null,
  metricsHidden: false,
})

describe('deriveDataQuality', () => {
  it('grades a run from what the source returned', () => {
    expect(deriveDataQuality(null)).toBe('failed')
    expect(deriveDataQuality({ ...profileFixture(100), followerCount: null })).toBe('low')
    expect(deriveDataQuality({ ...profileFixture(100), missingFields: ['biography'] })).toBe('partial')
    expect(deriveDataQuality(profileFixture(100))).toBe('complete')
  })
})

describe('collectAccount', () => {
  it('writes a snapshot, posts and metrics, and denormalizes the latest values', async () => {
    const account = await CompetitorAccount.create({ username: 'peer.studio' })
    scrapeProfile.mockResolvedValue(profileFixture(9_000))
    scrapePosts.mockResolvedValue([postFixture('a'), postFixture('b')])

    const result = await collectAccount(account._id)

    expect(result).toMatchObject({ ok: true, postsCollected: 2, error: null })
    expect(await AccountSnapshot.countDocuments({ accountId: account._id })).toBe(1)
    expect(await Post.countDocuments({ accountId: account._id })).toBe(2)
    expect(await PostMetricSnapshot.countDocuments({ accountId: account._id })).toBe(2)

    const updated = await CompetitorAccount.findById(account._id)
    expect(updated!.latestFollowerCount).toBe(9_000)
    expect(updated!.dataQuality).toBe('complete')
    expect(updated!.lastSuccessfulCollectionAt).not.toBeNull()
  })

  it('upserts posts on re-collection instead of duplicating them', async () => {
    const account = await CompetitorAccount.create({ username: 'peer.studio' })
    scrapeProfile.mockResolvedValue(profileFixture(9_000))
    scrapePosts.mockResolvedValue([postFixture('a', 100)])
    await collectAccount(account._id)

    scrapeProfile.mockResolvedValue(profileFixture(9_400))
    scrapePosts.mockResolvedValue([postFixture('a', 250)])
    await collectAccount(account._id)

    // One post, but two metric readings and two profile snapshots — history
    // accumulates while the immutable post record stays single.
    expect(await Post.countDocuments({ accountId: account._id })).toBe(1)
    expect(await PostMetricSnapshot.countDocuments({ accountId: account._id })).toBe(2)
    expect(await AccountSnapshot.countDocuments({ accountId: account._id })).toBe(2)

    const metrics = await PostMetricSnapshot.find().sort({ collectedAt: 1 })
    expect(metrics.map((m) => m.likes)).toEqual([100, 250])
  })

  it('records an unreadable handle as failed without throwing', async () => {
    const account = await CompetitorAccount.create({ username: 'ghost' })
    scrapeProfile.mockResolvedValue(null) // not-found row

    const result = await collectAccount(account._id)

    expect(result.ok).toBe(false)
    expect((await CompetitorAccount.findById(account._id))!.dataQuality).toBe('failed')
    // The failed observation is still recorded — absence is data.
    expect(await AccountSnapshot.countDocuments({ accountId: account._id })).toBe(1)
    expect(await Post.countDocuments({ accountId: account._id })).toBe(0)
  })
})

describe('runCollection', () => {
  it('collects every account in the register and survives a per-account failure', async () => {
    await CompetitorAccount.create({ username: 'good.one', approvalStatus: 'approved' })
    await CompetitorAccount.create({ username: 'bad.one', approvalStatus: 'approved' })
    // Deleted accounts have left the register and are never collected.
    await CompetitorAccount.create({ username: 'skipped', approvalStatus: 'deleted' })

    scrapeProfile.mockImplementation((username: string) =>
      username === 'bad.one' ? Promise.reject(new Error('Apify blocked')) : Promise.resolve(profileFixture(5_000)),
    )
    scrapePosts.mockResolvedValue([postFixture('a')])

    const run = await runCollection('manual')

    expect(run.accountsProcessed).toBe(2)
    expect(run.failures).toBe(1)
    expect(run.postsCollected).toBe(1)
    expect(run.finishedAt).not.toBeNull()
    // The failure is attributed, not just counted.
    expect(run.results.find((r) => r.username === 'bad.one')?.error).toContain('Apify blocked')
    expect(run.results.find((r) => r.username === 'good.one')?.ok).toBe(true)
  })
})
