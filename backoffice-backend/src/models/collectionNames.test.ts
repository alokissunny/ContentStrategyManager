import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * The backoffice shares a database with the customer API, so collection names
 * are part of the contract, not an implementation detail.
 *
 * `Post` defaulting to `posts` collided with the customer app's collection,
 * which carries a UNIQUE, NON-SPARSE index on `instagramId`. Backoffice posts
 * have no such field, so every one of them looked like `instagramId: null` and
 * only the first could ever be written — the rest died with E11000, surfacing
 * as accounts stuck on dataQuality 'partial' with zero posts.
 */

const { AccountSnapshot, Post, PostMetricSnapshot, CollectionRun, RawPostPayload } = await import('./snapshots.ts')

let mongo: MongoMemoryServer

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  await mongoose.connect(mongo.getUri())
}, 120_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongo.stop()
})

describe('collection names', () => {
  it('keeps competitor posts out of the customer app\'s `posts` collection', () => {
    expect(Post.collection.collectionName).toBe('competitor_posts')
    expect(Post.collection.collectionName).not.toBe('posts')
  })

  it('pins every backoffice collection name explicitly', () => {
    expect(AccountSnapshot.collection.collectionName).toBe('accountsnapshots')
    expect(PostMetricSnapshot.collection.collectionName).toBe('postmetricsnapshots')
    expect(CollectionRun.collection.collectionName).toBe('collectionruns')
    expect(RawPostPayload.collection.collectionName).toBe('rawpostpayloads')
  })

  it('writes many posts even when the customer app\'s unique index exists', async () => {
    // Recreate the exact index that exists on the shared Atlas database.
    await mongoose.connection.db!
      .collection('posts')
      .createIndex({ instagramId: 1 }, { unique: true, name: 'instagramId_1' })

    const accountId = new mongoose.Types.ObjectId()
    for (const platformPostId of ['P1', 'P2', 'P3', 'P4']) {
      await Post.findOneAndUpdate(
        { accountId, platformPostId },
        {
          $set: { url: `https://example/${platformPostId}`, format: 'image' },
          $setOnInsert: { accountId, platformPostId, firstCollectedAt: new Date() },
        },
        { new: true, upsert: true },
      )
    }

    // Before the fix this was 1: the first insert took the single `null` slot
    // on instagramId and every later one raised a duplicate key error.
    expect(await Post.countDocuments({ accountId })).toBe(4)
    expect(await mongoose.connection.db!.collection('posts').countDocuments()).toBe(0)
  })
})
