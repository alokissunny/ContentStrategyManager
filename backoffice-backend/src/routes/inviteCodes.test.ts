import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { InviteCode } from '../models/inviteCode.ts'
import { INVITE_PATTERN } from '../services/inviteCodes.ts'
import { inviteCodeRoutes } from './inviteCodes.ts'

let mongo: MongoMemoryServer
const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  ;(req as { admin?: unknown }).admin = { id: 'a', name: 'Admin', email: 'admin@test' }
  next()
})
app.use('/api/backoffice', inviteCodeRoutes)

let port: number
let server: ReturnType<typeof app.listen>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  await InviteCode.init()
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
  await InviteCode.deleteMany({})
})

describe('invite codes', () => {
  it('generates unique 4-character codes with the admin as creator', async () => {
    const res = await call('/api/backoffice/invite-codes', 'POST', { count: 25, note: 'Batch A' })
    expect(res.status).toBe(201)
    expect(res.body.rows).toHaveLength(25)
    const codes = res.body.rows.map((r: { code: string }) => r.code)
    expect(new Set(codes).size).toBe(25)
    for (const c of codes) expect(c).toMatch(INVITE_PATTERN)
    expect(res.body.rows[0]).toMatchObject({ status: 'unused', note: 'Batch A', createdBy: 'admin@test' })
  })

  it('lists with status counts and filters', async () => {
    await call('/api/backoffice/invite-codes', 'POST', { count: 3 })
    const [a] = await InviteCode.find().lean()
    await InviteCode.updateOne({ _id: a._id }, { $set: { usedAt: new Date(), usedByEmail: 'x@y.z' } })

    const all = await call('/api/backoffice/invite-codes')
    expect(all.body.total).toBe(3)
    expect(all.body.counts).toEqual({ unused: 2, used: 1, revoked: 0 })
    const used = await call('/api/backoffice/invite-codes?status=used')
    expect(used.body.rows).toHaveLength(1)
    expect(used.body.rows[0]).toMatchObject({ status: 'used', usedByEmail: 'x@y.z' })
  })

  it('revokes and restores unused codes, but never a used one', async () => {
    const made = await call('/api/backoffice/invite-codes', 'POST', { count: 2 })
    const [one, two] = made.body.rows
    const revoked = await call(`/api/backoffice/invite-codes/${one.id}`, 'PATCH', { revoked: true })
    expect(revoked.body.status).toBe('revoked')
    const restored = await call(`/api/backoffice/invite-codes/${one.id}`, 'PATCH', { revoked: false })
    expect(restored.body.status).toBe('unused')

    await InviteCode.updateOne({ _id: two.id }, { $set: { usedAt: new Date() } })
    expect((await call(`/api/backoffice/invite-codes/${two.id}`, 'PATCH', { revoked: true })).status).toBe(409)
    expect((await call(`/api/backoffice/invite-codes/${two.id}`, 'DELETE')).status).toBe(409)
    expect((await call(`/api/backoffice/invite-codes/${one.id}`, 'DELETE')).status).toBe(204)
  })

  it('rejects a bad count', async () => {
    expect((await call('/api/backoffice/invite-codes', 'POST', { count: 500 })).status).toBe(400)
  })
})
