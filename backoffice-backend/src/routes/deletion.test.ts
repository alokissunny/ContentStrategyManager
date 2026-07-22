import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { AccountSnapshot, Post, PostMetricSnapshot } from '../models/snapshots.ts'
import { competitorRoutes } from './competitors.ts'

/*
 * Deletion is the one irreversible action in the tool, so it gets its own
 * coverage: "remove" must preserve observed history, "purge" must leave nothing
 * orphaned behind.
 */

let mongo: MongoMemoryServer
const app = express()
app.use(express.json())
app.use('/api/backoffice', competitorRoutes) // auth is exercised separately

async function call(method: 'delete', path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

let port: number
let server: ReturnType<typeof app.listen>

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
  await Promise.all([
    CompetitorAccount.deleteMany({}),
    AccountSnapshot.deleteMany({}),
    Post.deleteMany({}),
    PostMetricSnapshot.deleteMany({}),
  ])
})

async function seedAccountWithHistory(username: string) {
  const account = await CompetitorAccount.create({ username, approvalStatus: 'approved' })
  await AccountSnapshot.create({ accountId: account._id, username, followerCount: 1_000 })
  const post = await Post.create({ accountId: account._id, platformPostId: `${username}-1`, format: 'reel' })
  await PostMetricSnapshot.create({ postId: post._id, accountId: account._id, likes: 10, comments: 1 })
  return account
}

describe('DELETE /competitors — remove (default)', () => {
  it('marks the account deleted but keeps its collected history', async () => {
    const account = await seedAccountWithHistory('peer.one')

    const res = await call('delete', '/api/backoffice/competitors', { ids: [String(account._id)] })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ removed: 1, purged: 0 })

    const after = await CompetitorAccount.findById(account._id)
    expect(after).not.toBeNull()
    expect(after!.approvalStatus).toBe('deleted')

    // History is the expensive part — removal must not touch it.
    expect(await AccountSnapshot.countDocuments({ accountId: account._id })).toBe(1)
    expect(await Post.countDocuments({ accountId: account._id })).toBe(1)
    expect(await PostMetricSnapshot.countDocuments({ accountId: account._id })).toBe(1)
  })

  it('drops removed accounts out of the tracked working set', async () => {
    const account = await seedAccountWithHistory('peer.two')
    await call('delete', '/api/backoffice/competitors', { ids: [String(account._id)] })

    const tracked = await CompetitorAccount.countDocuments({
      approvalStatus: { $in: ['included-in-benchmarks', 'approved', 'watchlist-only'] },
    })
    expect(tracked).toBe(0)
  })
})

describe('DELETE /competitors — purge', () => {
  it('destroys the account and every observation of it', async () => {
    const account = await seedAccountWithHistory('typo.handle')

    const res = await call('delete', '/api/backoffice/competitors', {
      ids: [String(account._id)],
      purge: true,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ purged: 1, deletedPosts: 1, deletedSnapshots: 1, deletedMetrics: 1 })

    expect(await CompetitorAccount.findById(account._id)).toBeNull()
    // Nothing orphaned — orphans would keep skewing aggregate counts.
    expect(await AccountSnapshot.countDocuments({})).toBe(0)
    expect(await Post.countDocuments({})).toBe(0)
    expect(await PostMetricSnapshot.countDocuments({})).toBe(0)
  })

  it('leaves other accounts untouched', async () => {
    const doomed = await seedAccountWithHistory('doomed')
    const keeper = await seedAccountWithHistory('keeper')

    await call('delete', '/api/backoffice/competitors', { ids: [String(doomed._id)], purge: true })

    expect(await CompetitorAccount.findById(keeper._id)).not.toBeNull()
    expect(await Post.countDocuments({ accountId: keeper._id })).toBe(1)
    expect(await PostMetricSnapshot.countDocuments({ accountId: keeper._id })).toBe(1)
    expect(await AccountSnapshot.countDocuments({ accountId: keeper._id })).toBe(1)
  })

  it('rejects a request with no ids rather than deleting everything', async () => {
    await seedAccountWithHistory('safe.one')

    const res = await call('delete', '/api/backoffice/competitors', { ids: [], purge: true })

    expect(res.status).toBe(400)
    expect(await CompetitorAccount.countDocuments({})).toBe(1)
  })
})
