import { describe, expect, it } from 'vitest'
import { defaultFilters } from './filters'
import {
  allocateByWeights,
  getCaptionAnalysis,
  scaleRankRowsToTotal,
  type RankRow,
} from './captionPatterns'

describe('allocateByWeights', () => {
  it('sums exactly to the total', () => {
    expect(allocateByWeights([2, 1, 0], 293).reduce((s, n) => s + n, 0)).toBe(293)
    expect(allocateByWeights([1, 1, 1], 10).reduce((s, n) => s + n, 0)).toBe(10)
  })
})

describe('scaleRankRowsToTotal', () => {
  const rows: RankRow[] = [
    {
      id: 'video',
      rank: 1,
      label: 'Video',
      competitors: 5,
      posts: 9,
      sharePct: 90,
      previousPct: null,
      currentPct: null,
      changePp: null,
      state: 'inconclusive',
    },
    {
      id: 'carousel',
      rank: 2,
      label: 'Carousel',
      competitors: 1,
      posts: 1,
      sharePct: 10,
      previousPct: null,
      currentPct: null,
      changePp: null,
      state: 'inconclusive',
    },
  ]

  it('preserves mix while scaling posts to the target', () => {
    const scaled = scaleRankRowsToTotal(rows, 100, 19)
    expect(scaled.reduce((s, r) => s + r.posts, 0)).toBe(100)
    expect(scaled[0]?.label).toBe('Video')
    expect(scaled[0]?.posts).toBe(90)
    expect(scaled[1]?.posts).toBe(10)
  })
})

describe('getCaptionAnalysis pillar formats', () => {
  it('makes Discovery + Credibility + Trust format posts equal all-pillars captions', () => {
    const all = getCaptionAnalysis(defaultFilters)
    const sumPillar = (['discovery', 'credibility', 'trust'] as const).reduce((s, p) => {
      const part = getCaptionAnalysis({ ...defaultFilters, pillar: p })
      return s + part.formats.reduce((n, r) => n + r.posts, 0)
    }, 0)
    // Offline mock KPI captions follow pattern volume; formats-by-pillar are
    // carved from that same pool so the three pillars still recombine.
    expect(sumPillar).toBe(all.kpis.captions)
  })
})
