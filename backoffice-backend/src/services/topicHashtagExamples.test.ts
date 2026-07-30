import { describe, expect, it } from 'vitest'
import type { CondensedAccount } from './analysisCorpus.ts'
import { examplesForHashtag, examplesForTopic } from './topicHashtagExamples.ts'

function account(username: string, posts: { id: string; caption: string; hashtags: string[] }[]): CondensedAccount {
  return {
    username,
    displayName: username,
    role: 'peer-benchmark',
    followers: 10_000,
    location: { country: 'Spain', region: null, city: null },
    specialization: null,
    enrichment: null,
    window: {
      days: 30,
      postsCollected: posts.length,
      postsPerWeek: 1,
      formatMix: [],
      medianLikes: 10,
      medianComments: 1,
      topHashtags: [],
      postingDays: [],
    },
    exemplars: posts.map((p) => ({
      platformPostId: p.id,
      publishedAt: null,
      format: 'image',
      caption: p.caption,
      hashtags: p.hashtags,
      likes: 10,
      comments: 1,
      views: null,
      engagement: 11,
      engagementRate: 1,
    })),
  }
}

describe('topicHashtagExamples', () => {
  const accounts = [
    account('studio.one', [
      {
        id: '1',
        caption: 'This kitchen remodel kept the island and added oak cabinets.',
        hashtags: ['#cocinasmodernas', '#interiorismo'],
      },
      {
        id: '2',
        caption: 'Lighting temperature, in one photo set. #materialesnaturales',
        hashtags: ['#materialesnaturales'],
      },
    ]),
  ]

  it('finds hashtag examples from exemplar tags and captions', () => {
    const examples = examplesForHashtag('#cocinasmodernas', accounts)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples[0]!.caption).toMatch(/kitchen/i)
  })

  it('finds topic examples by caption token overlap', () => {
    const examples = examplesForTopic('Kitchen projects', accounts)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples[0]!.caption).toMatch(/kitchen/i)
  })
})
