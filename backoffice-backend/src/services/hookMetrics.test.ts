import { describe, expect, it } from 'vitest'
import {
  aggregateHookMetrics,
  applyComputedHookMetrics,
  buildCaptionLookup,
  buildEngagementRateLookup,
  buildPostAccountLookup,
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
    const captions = buildCaptionLookup(accounts)
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
    // Two unique accounts (a, b) use the hook; totalAccounts = 2 → 100%.
    const metrics = aggregateHookMetrics(memos, lookup, 2, captions)
    expect(metrics).toHaveLength(1)
    expect(metrics[0]!.useRate).toBe(100)
    expect(metrics[0]!.accountCount).toBe(2)
    // median of [1, 3, 5] = 3
    expect(metrics[0]!.medianEngagement).toBe(3)
    expect(metrics[0]!.exampleCaptions.length).toBeGreaterThan(0)
    expect(metrics[0]!.exampleCaptions[0]).toEqual({ competitor: 'a', caption: 'hello' })
  })

  it('recomputes use rate from merged accounts and borrows Claude trend/label', () => {
    const computed = [
      {
        hookType: 'Question hook',
        structure: 'Ask',
        pillar: 'discovery' as const,
        useRate: 24,
        medianEngagement: 2.8,
        accountCount: 6,
        postCount: 5,
        accounts: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
        engagementRates: [2.8],
        exampleCaptions: [{ competitor: 'Studio One', caption: 'Would you keep this wall?' }],
      },
    ]
    const merged = applyComputedHookMetrics(
      [
        {
          hookType: 'Direct question hook',
          structure: 'Would you keep this wall?',
          useRate: 0,
          medianEngagement: 0,
          trend: 'up',
          pillar: 'discovery',
        },
      ],
      computed,
      25, // 6 / 25 = 24%
    )
    expect(merged[0]!.useRate).toBe(24)
    expect(merged[0]!.medianEngagement).toBe(2.8)
    expect(merged[0]!.accountCount).toBe(6)
    expect(merged[0]!.trend).toBe('up')
    // "Direct question hook" shares the "question" token → adopts Claude's label.
    expect(merged[0]!.hookType).toBe('Direct question hook')
    expect(merged[0]!.exampleCaptions).toEqual([
      { competitor: 'Studio One', caption: 'Would you keep this wall?' },
    ])
  })

  it('unions fragmented batch hooks so a real hook clears the threshold', () => {
    // The same logical "question" hook is named three ways across batches, each
    // used by 3 distinct accounts. Per-fragment that is 3/90 = 3.3% (below 5%),
    // but unioned it is 9/90 = 10% and must survive.
    const frag = (hookType: string, accounts: string[]) => ({
      hookType,
      structure: 'Ask',
      pillar: 'discovery' as const,
      useRate: 0,
      medianEngagement: 1,
      accountCount: accounts.length,
      postCount: accounts.length,
      accounts,
      engagementRates: [1],
      exampleCaptions: [],
    })
    const computed = [
      frag('Direct question hook', ['a', 'b', 'c']),
      frag('Rhetorical question opener', ['d', 'e', 'f']),
      frag('Question hook', ['g', 'h', 'i']),
    ]
    const merged = applyComputedHookMetrics([], computed, 90)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.accountCount).toBe(9)
    expect(merged[0]!.useRate).toBe(10)
  })

  it('counts accounts by post owner when the memo omits usernames', () => {
    const accounts = [
      account('a', [{ id: '1', er: 2 }]),
      account('b', [{ id: '2', er: 4 }]),
      account('c', [{ id: '3', er: 6 }]),
    ]
    const lookup = buildEngagementRateLookup(accounts)
    const captions = buildCaptionLookup(accounts)
    const postAccounts = buildPostAccountLookup(accounts)
    // Memo hook posts carry only platformPostId — no username echoed back.
    const memos = [
      {
        hooks: [
          {
            hookType: 'Question hook',
            structure: 'Ask a choice',
            pillar: 'discovery',
            posts: [
              { platformPostId: '1' },
              { platformPostId: '2' },
              { platformPostId: '3' },
            ],
          },
        ],
      },
    ]
    const metrics = aggregateHookMetrics(memos, lookup, 3, captions, postAccounts)
    expect(metrics).toHaveLength(1)
    // Resolved to 3 distinct owners → 100%, not 0.
    expect(metrics[0]!.accountCount).toBe(3)
    expect(metrics[0]!.useRate).toBe(100)
  })

  it('drops merged hooks below the unique-account recommendation threshold', () => {
    // A hook used by only 2 of 100 accounts (2%) is under the 5% floor even after
    // merging, so it must not be surfaced.
    const computed = [
      {
        hookType: 'Niche hook',
        structure: 'Rare opener',
        pillar: 'discovery' as const,
        useRate: 2,
        medianEngagement: 1,
        accountCount: 2,
        postCount: 2,
        accounts: ['a', 'b'],
        engagementRates: [1],
        exampleCaptions: [],
      },
    ]
    expect(applyComputedHookMetrics([], computed, 100)).toHaveLength(0)
  })
})
