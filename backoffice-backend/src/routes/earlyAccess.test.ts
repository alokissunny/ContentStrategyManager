import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EarlyAccessRequest } from '../models/earlyAccess.ts'
import { earlyAccessRoutes } from './earlyAccess.ts'

let mongo: MongoMemoryServer
const app = express()
app.use(express.json())
app.use('/api/backoffice', earlyAccessRoutes)

async function call(path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
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
  await EarlyAccessRequest.deleteMany({})
})

describe('GET /early-access', () => {
  it('lists waitlist requests newest first', async () => {
    await EarlyAccessRequest.create({ name: 'Ana Ruiz', instagramHandle: 'ana.studio' })
    await EarlyAccessRequest.create({ name: 'Leo Haus', instagramHandle: 'leohaus' })

    const res = await call('/api/backoffice/early-access')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rows).toHaveLength(2)
    expect(res.body.rows[0]).toMatchObject({ name: 'Leo Haus', instagramHandle: 'leohaus' })
    expect(res.body.rows[1]).toMatchObject({ name: 'Ana Ruiz', instagramHandle: 'ana.studio' })
  })

  it('filters by name or Instagram handle', async () => {
    await EarlyAccessRequest.create({ name: 'Ana Ruiz', instagramHandle: 'ana.studio' })
    await EarlyAccessRequest.create({ name: 'Leo Haus', instagramHandle: 'leohaus' })

    const byName = await call('/api/backoffice/early-access?search=ruiz')
    expect(byName.body.total).toBe(1)
    expect(byName.body.rows[0].instagramHandle).toBe('ana.studio')

    const byHandle = await call('/api/backoffice/early-access?search=leohaus')
    expect(byHandle.body.total).toBe(1)
    expect(byHandle.body.rows[0].name).toBe('Leo Haus')
  })
})
