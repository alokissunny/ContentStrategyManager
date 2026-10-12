import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DeletionError, deleteCustomer, getDeletionSummary } from './customerDeletion.ts'

/*
 * Deleting a customer is irreversible and writes into the customer app's
 * collections, so: everything of theirs goes, nothing of anyone else's does,
 * and the guard rails hold.
 */

let mongo: MongoMemoryServer
const ADMIN = new mongoose.Types.ObjectId()
const A = new mongoose.Types.ObjectId()
const B = new mongoose.Types.ObjectId()

beforeAll(async () => {
  delete process.env.S3_BUCKET_NAME // media deletion is skipped without S3
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

beforeEach(async () => {
  const db = mongoose.connection.db!
  await db.dropDatabase()
  await db.collection('users').insertMany([
    { _id: ADMIN, email: 'boss@bauhly.com', role: 'admin' },
    { _id: A, email: 'a@studio.com', name: 'Studio A', role: 'user' },
    { _id: B, email: 'b@studio.com', name: 'Studio B', role: 'user' },
  ])
  for (const u of [A, B]) {
    await db.collection('instagramprofiles').insertOne({ user: u, username: `h${String(u).slice(-4)}` })
    await db.collection('projects').insertOne({ user: u, name: 'P', captures: [{ text: 'x' }] })
    await db.collection('plannedposts').insertMany([{ user: u, date: '2026-10-01' }, { user: u, date: '2026-10-02' }])
    const run = await db.collection('planruns').insertOne({ user: u })
    await db.collection('planrunposts').insertOne({ run: run.insertedId, index: 0 })
    await db.collection('branddnas').insertOne({ userId: String(u) })
  }
})

const count = (c: string, q: object) => mongoose.connection.db!.collection(c).countDocuments(q)

describe('customer deletion', () => {
  it('summarises what will be removed', async () => {
    const s = await getDeletionSummary(String(A), String(ADMIN))
    expect(s.canDelete).toBe(true)
    expect(s.email).toBe('a@studio.com')
    const byKey = Object.fromEntries(s.items.map((i) => [i.key, i.count]))
    expect(byKey).toMatchObject({ plannedposts: 2, projects: 1, planruns: 1, planrunposts: 1, branddnas: 1 })
  })

  it('removes the customer and all their data, and nobody else’s', async () => {
    const r = await deleteCustomer(String(A), { adminId: String(ADMIN), adminEmail: 'boss@bauhly.com', confirmEmail: ' A@Studio.com ' })
    expect(r.mediaSkipped).toBe(true)
    expect(await count('users', { _id: A })).toBe(0)
    for (const c of ['instagramprofiles', 'projects', 'plannedposts', 'planruns']) expect(await count(c, { user: A })).toBe(0)
    expect(await count('branddnas', { userId: String(A) })).toBe(0)
    expect(await count('planrunposts', {})).toBe(1) // B's
    expect(await count('users', { _id: B })).toBe(1)
    expect(await count('plannedposts', { user: B })).toBe(2)
  })

  it('refuses without the matching email', async () => {
    await expect(deleteCustomer(String(A), { adminId: String(ADMIN), adminEmail: '', confirmEmail: 'b@studio.com' }))
      .rejects.toMatchObject({ status: 400 })
    expect(await count('users', { _id: A })).toBe(1)
  })

  it('refuses admins and the signed-in account', async () => {
    const s = await getDeletionSummary(String(ADMIN), String(A))
    expect(s.canDelete).toBe(false)
    await expect(deleteCustomer(String(ADMIN), { adminId: String(A), adminEmail: '', confirmEmail: 'boss@bauhly.com' }))
      .rejects.toBeInstanceOf(DeletionError)
    await expect(deleteCustomer(String(A), { adminId: String(A), adminEmail: '', confirmEmail: 'a@studio.com' }))
      .rejects.toMatchObject({ status: 403 })
    expect(await count('users', {})).toBe(3)
  })
})
