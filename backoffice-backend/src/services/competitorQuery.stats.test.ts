import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { listCompetitors } from './competitorQuery.ts'

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
  await CompetitorAccount.deleteMany({})
})

describe('list stats', () => {
  it('excludes deleted accounts from the headline counts', async () => {
    await CompetitorAccount.create({ username: 'a', approvalStatus: 'included-in-benchmarks' })
    await CompetitorAccount.create({ username: 'b', approvalStatus: 'approved' })
    await CompetitorAccount.create({ username: 'gone', approvalStatus: 'deleted' })

    const { stats, total } = await listCompetitors({})

    // A removed account must not keep inflating "tracked accounts".
    expect(stats.total).toBe(2)
    expect(stats.approved).toBe(2)
    expect(total).toBe(2)
  })

  it('counts every account in the register, so the card matches the list', async () => {
    // There is no approval workflow: anything not deleted is in the register
    // and is counted, so the headline can never disagree with the rows.
    await CompetitorAccount.create({ username: 'one', approvalStatus: 'approved' })
    await CompetitorAccount.create({ username: 'two', approvalStatus: 'approved' })

    const { stats, total } = await listCompetitors({})

    expect(total).toBe(2)
    expect(stats.total).toBe(2)
  })

  it('reports zero after every tracked account is deleted', async () => {
    await CompetitorAccount.create({ username: 'a', approvalStatus: 'deleted' })
    await CompetitorAccount.create({ username: 'b', approvalStatus: 'deleted' })

    const { stats, total } = await listCompetitors({})

    expect(total).toBe(0)
    expect(stats.total).toBe(0)
    expect(stats.collectedPosts).toBe(0)
  })

  it('still lets you find deleted accounts explicitly', async () => {
    await CompetitorAccount.create({ username: 'gone', approvalStatus: 'deleted' })

    const { rows, total } = await listCompetitors({ status: 'deleted' })

    expect(total).toBe(1)
    expect(rows[0]?.username).toBe('gone')
  })

  it('hides deleted accounts from "all statuses"', async () => {
    // "All" means every status a live account can hold — not every row in the
    // collection. A removed account must not reappear in the register.
    await CompetitorAccount.create({ username: 'live.one', approvalStatus: 'excluded' })
    await CompetitorAccount.create({ username: 'gone.one', approvalStatus: 'deleted' })

    const { rows, total } = await listCompetitors({ status: 'all' })

    expect(total).toBe(1)
    expect(rows.map((r) => r.username)).toEqual(['live.one'])
  })

  it('hides deleted accounts from every other filter too', async () => {
    await CompetitorAccount.create({
      username: 'gone.two',
      approvalStatus: 'deleted',
      location: { country: 'Spain', region: null, city: null },
      latestFollowerCount: 10_000,
    })

    // Searching, or filtering by country/followers, must not resurface it.
    expect((await listCompetitors({ status: 'all', search: 'gone' })).total).toBe(0)
    expect((await listCompetitors({ status: 'all', country: 'Spain' })).total).toBe(0)
    expect((await listCompetitors({ status: 'all', followerRange: '5K – 20K' })).total).toBe(0)
  })
})
