import { describe, expect, it } from 'vitest'
import {
  aggregateHookMetrics,
  applyComputedHookMetrics,
  buildEngagementRateLookup,
} from './hookMetrics.ts'
import type { CondensedAccount } from './analysisCorpus.ts'

function account(username: string, posts: { id: string; er: number }[]): CondensedAccount {
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
      caption: 'hello',
      hashtags: [],
      likes: 100,
      comments: 10,
      views: null,
      engagement: 110,
      engagementRate: p.er,
    })),
  }
}

describe('hookMetrics', () => {
  it('pools median ER across posts from every competitor for a hook', () => {
    const accounts = [
      account('a', [
        { id: '1', er: 1 },
        { id: '2', er: 3 },
      ]),
      account('b', [{ id: '3', er: 5 }]),
    ]
    const lookup = buildEngagementRateLookup(accounts)
    const memos = [
      {
        hooks: [
          {
            hookType: 'Question hook',
            structure: 'Ask a choice',
            pillar: 'discovery',
            posts: [
              { username: 'a', platformPostId: '1', engagementRate: 1 },
              { username: 'a', platformPostId: '2' }, // ER from lookup
              { username: 'b', platformPostId: '3', engagementRate: 5 },
            ],
          },
        ],
      },
    ]
    const metrics = aggregateHookMetrics(memos, lookup, 3)
    expect(metrics).toHaveLength(1)
    expect(metrics[0]!.useRate).toBe(100)
    // median of [1, 3, 5] = 3
    expect(metrics[0]!.medianEngagement).toBe(3)
  })

  it('overwrites zero Claude hook rates with computed metrics', () => {
    const computed = [
      {
        hookType: 'Question hook',
        structure: 'Ask',
        pillar: 'discovery' as const,
        useRate: 24,
        medianEngagement: 2.8,
        postCount: 5,
      },
    ]
    const merged = applyComputedHookMetrics(
      [
        {
          hookType: 'Question hook',
          structure: 'Would you keep this wall?',
          useRate: 0,
          medianEngagement: 0,
          trend: 'up',
          pillar: 'discovery',
        },
      ],
      computed,
    )
    expect(merged[0]!.useRate).toBe(24)
    expect(merged[0]!.medianEngagement).toBe(2.8)
    expect(merged[0]!.trend).toBe('up')
  })
})
