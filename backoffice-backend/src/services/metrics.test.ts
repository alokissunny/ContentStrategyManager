import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { AccountSnapshot, Post, PostMetricSnapshot } from '../models/snapshots.ts'
import { accountActivity, followerChangePct, followerSeries, median } from './metrics.ts'

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
  await Promise.all([
    CompetitorAccount.deleteMany({}),
    AccountSnapshot.deleteMany({}),
    Post.deleteMany({}),
    PostMetricSnapshot.deleteMany({}),
  ])
})

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

async function makeAccount(followers: number | null = 10_000) {
  return CompetitorAccount.create({ username: 'peer.studio', latestFollowerCount: followers })
}

describe('median', () => {
  it('averages the middle pair for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([])).toBe(0)
  })
})

describe('followerChangePct', () => {
  it('is the percentage difference between two real readings in the window', async () => {
    const account = await makeAccount()
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_000, collectedAt: daysAgo(20) })
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_800, collectedAt: daysAgo(1) })

    // (9800 - 9000) / 9000 = +8.9% — a percentage, because that is the unit
    // the UI renders. Returning the raw delta here shows up as "+800%".
    expect(await followerChangePct(account._id, 30)).toBe(8.9)
  })

  it('is null with only one reading — change is never inferred from a point', async () => {
    const account = await makeAccount()
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_800, collectedAt: daysAgo(1) })

    expect(await followerChangePct(account._id, 30)).toBeNull()
  })

  it('ignores readings outside the window', async () => {
    const account = await makeAccount()
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 1_000, collectedAt: daysAgo(200) })
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_800, collectedAt: daysAgo(1) })

    // Only the recent reading falls inside 30 days, so there's no baseline.
    expect(await followerChangePct(account._id, 30)).toBeNull()
    // Widen the window and the older reading becomes the baseline.
    expect(await followerChangePct(account._id, 365)).toBe(880)
  })

  it('skips snapshots where the follower count was not collected', async () => {
    const account = await makeAccount()
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: null, collectedAt: daysAgo(10) })
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_000, collectedAt: daysAgo(5) })
    await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: 9_500, collectedAt: daysAgo(1) })

    expect(await followerChangePct(account._id, 30)).toBe(5.6)
  })
})

describe('followerSeries', () => {
  it('returns readings oldest to newest', async () => {
    const account = await makeAccount()
    for (const [n, followers] of [[3, 100], [2, 200], [1, 300]] as const) {
      await AccountSnapshot.create({ accountId: account._id, username: 'x', followerCount: followers, collectedAt: daysAgo(n) })
    }
    expect(await followerSeries(account._id)).toEqual([100, 200, 300])
  })
})

describe('accountActivity', () => {
  it('computes volume, cadence and engagement from the latest metric per post', async () => {
    const account = await makeAccount(10_000)
    for (const [i, format] of ['reel', 'carousel', 'reel', 'image'].entries()) {
      const post = await Post.create({
        accountId: account._id,
        platformPostId: `p${i}`,
        format,
        publishedAt: daysAgo(i + 1),
      })
      // An older reading plus a newer one — only the newest should count.
      await PostMetricSnapshot.create({ postId: post._id, accountId: account._id, likes: 1, comments: 0, collectedAt: daysAgo(5) })
      await PostMetricSnapshot.create({ postId: post._id, accountId: account._id, likes: 200, comments: 50, collectedAt: daysAgo(1) })
    }

    const activity = await accountActivity(account._id, 30, 10_000)
    expect(activity.postsCollected).toBe(4)
    // 4 posts over 30 days ≈ 0.9/week
    expect(activity.postsPerWeek).toBeCloseTo(0.9, 1)
    // (200 + 50) / 10000 = 2.5%
    expect(activity.medianEngagementRate).toBeCloseTo(2.5, 2)
    expect(activity.topFormats[0]).toEqual({ label: 'Reels', sharePct: 50 })
  })

  it('excludes hidden-metric posts from the rate but still counts them as volume', async () => {
    const account = await makeAccount(1_000)
    await Post.create({ accountId: account._id, platformPostId: 'visible', format: 'reel', publishedAt: daysAgo(2) })
    const hidden = await Post.create({
      accountId: account._id,
      platformPostId: 'hidden',
      format: 'reel',
      publishedAt: daysAgo(3),
      metricsHidden: true,
    })
    const visible = await Post.findOne({ platformPostId: 'visible' })
    await PostMetricSnapshot.create({ postId: visible!._id, accountId: account._id, likes: 100, comments: 0 })
    await PostMetricSnapshot.create({ postId: hidden._id, accountId: account._id, likes: null, comments: null })

    const activity = await accountActivity(account._id, 30, 1_000)
    expect(activity.postsCollected).toBe(2)
    // Only the visible post contributes: 100/1000 = 10%. A hidden post must not
    // drag this toward zero.
    expect(activity.medianEngagementRate).toBeCloseTo(10, 2)
  })

  it('reports a zero rate when follower count is unknown', async () => {
    const account = await makeAccount(null)
    const post = await Post.create({ accountId: account._id, platformPostId: 'p', format: 'image', publishedAt: daysAgo(1) })
    await PostMetricSnapshot.create({ postId: post._id, accountId: account._id, likes: 10, comments: 1 })

    const activity = await accountActivity(account._id, 30, null)
    expect(activity.postsCollected).toBe(1)
    expect(activity.medianEngagementRate).toBe(0)
  })
})
