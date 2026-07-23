import { describe, expect, it } from 'vitest'
import { stratifyIntoBatches, type CondensedAccount } from './analysisCorpus.ts'

function stub(username: string, followers: number | null): CondensedAccount {
  return {
    username,
    displayName: username,
    role: 'peer-benchmark',
    followers,
    location: { country: 'Spain', region: null, city: null },
    specialization: null,
    enrichment: null,
    window: {
      days: 30,
      postsCollected: 4,
      postsPerWeek: 1,
      formatMix: [],
      medianLikes: 10,
      medianComments: 1,
      topHashtags: [],
      postingDays: [],
    },
    exemplars: [],
  }
}

describe('stratifyIntoBatches', () => {
  it('spreads follower tiers across batches instead of dumping largest first', () => {
    const accounts = [
      stub('big1', 80_000),
      stub('big2', 70_000),
      stub('mid1', 12_000),
      stub('mid2', 11_000),
      stub('small1', 800),
      stub('small2', 700),
    ]
    const batches = stratifyIntoBatches(accounts, 2)
    expect(batches).toHaveLength(3)
    // First batch should not be two oversized accounts only.
    const firstFollowers = batches[0]!.map((a) => a.followers ?? 0)
    expect(Math.max(...firstFollowers) - Math.min(...firstFollowers)).toBeGreaterThan(5_000)
  })

  it('covers every account exactly once', () => {
    const accounts = Array.from({ length: 53 }, (_, i) => stub(`u${i}`, (i % 5) * 8_000 + 500))
    const batches = stratifyIntoBatches(accounts, 25)
    const flat = batches.flat().map((a) => a.username)
    expect(flat).toHaveLength(53)
    expect(new Set(flat).size).toBe(53)
  })
})
