/*
 * Offline dev harness: boots the API against an ephemeral in-memory MongoDB
 * seeded with an admin user and a small competitor register.
 *
 * Nothing here touches a real database — the instance is discarded on exit, so
 * this is safe to run alongside (or without) the shared dev Mongo. Useful for
 * working on the UI without infrastructure, and for end-to-end checks.
 *
 *   npm run dev:memory
 */
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../app.ts'
import { env } from '../config/env.ts'
import { CompetitorAccount } from '../models/CompetitorAccount.ts'
import { AccountSnapshot, Post, PostMetricSnapshot } from '../models/snapshots.ts'
import { User } from '../middleware/auth.ts'

const DEV_ADMIN = { email: 'admin@bauhly.dev', password: 'backoffice-dev-1234' }

const SEED = [
  { username: 'haus.casa', displayName: 'Haus Casa', country: 'Spain', city: 'Valencia', followers: 88_600, status: 'included-in-benchmarks' },
  { username: 'surcraft139', displayName: 'Sur Craft', country: 'Germany', city: 'München', followers: 88_400, status: 'watchlist-only' },
  { username: 'ateliercasa102', displayName: 'Atelier Casa', country: 'Spain', city: 'Valencia', followers: 42_100, status: 'approved' },
  { username: 'piedraliving', displayName: 'Piedra Living', country: 'Netherlands', city: 'Rotterdam', followers: 18_400, status: 'included-in-benchmarks' },
  { username: 'nordic.form', displayName: 'Nordic Form', country: 'Denmark', city: 'Copenhagen', followers: 7_900, status: 'approved' },
  { username: 'quiet.rooms', displayName: 'Quiet Rooms', country: 'Spain', city: 'Madrid', followers: 3_200, status: 'awaiting-review' },
] as const

const daysAgo = (n: number) => new Date(Date.now() - n * 864e5)

async function seed() {
  await User.create({
    name: 'Dev Admin',
    email: DEV_ADMIN.email,
    password: await bcrypt.hash(DEV_ADMIN.password, 10),
    role: 'admin',
  })

  for (const s of SEED) {
    const account = await CompetitorAccount.create({
      username: s.username,
      displayName: s.displayName,
      location: { country: s.country, region: null, city: s.city },
      niche: 'interior-design',
      role: 'peer-benchmark',
      approvalStatus: s.status,
      latestFollowerCount: s.followers,
      lastSuccessfulCollectionAt: daysAgo(2),
      dataQuality: 'complete',
      addedAt: daysAgo(60),
    })

    // Two profile readings so observed follower change is real, not invented.
    await AccountSnapshot.create({
      accountId: account._id,
      username: s.username,
      followerCount: Math.round(s.followers * 0.97),
      collectedAt: daysAgo(28),
      collectionSource: 'mock',
    })
    await AccountSnapshot.create({
      accountId: account._id,
      username: s.username,
      followerCount: s.followers,
      collectedAt: daysAgo(2),
      collectionSource: 'mock',
    })

    for (let i = 0; i < 6; i += 1) {
      const post = await Post.create({
        accountId: account._id,
        platformPostId: `${s.username}-p${i}`,
        format: i % 3 === 0 ? 'reel' : i % 3 === 1 ? 'carousel' : 'image',
        publishedAt: daysAgo(i * 4 + 1),
        caption: 'Seeded post for offline development',
      })
      await PostMetricSnapshot.create({
        postId: post._id,
        accountId: account._id,
        likes: Math.round(s.followers * 0.02),
        comments: Math.round(s.followers * 0.001),
        collectedAt: daysAgo(1),
      })
    }
  }
}

async function main() {
  const mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
  await seed()

  createApp().listen(env.port, () => {
    console.log(`[backoffice:dev] in-memory API on http://localhost:${env.port}`)
    console.log(`[backoffice:dev] sign in with ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`)
    console.log('[backoffice:dev] data is ephemeral — it disappears when this process stops')
  })

  const shutdown = async () => {
    await mongoose.disconnect()
    await mongo.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[backoffice:dev] failed to start:', err)
  process.exit(1)
})
