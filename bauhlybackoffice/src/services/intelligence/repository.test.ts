import { describe, expect, it } from 'vitest'
import { finding, patternMovement } from '../../types'
import { defaultFilters } from './filters'
import { mockFindings, mockMovements } from './mockData'
import { computeDashboard } from './repository'

describe('mock dataset', () => {
  it('validates every mock finding against the Phase 2 schema', () => {
    for (const f of mockFindings) {
      const result = finding.safeParse(f)
      expect(result.success, `finding ${f.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })

  it('validates every mock pattern movement against the Phase 2 schema', () => {
    for (const m of mockMovements) {
      const result = patternMovement.safeParse(m)
      expect(result.success, `movement ${m.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })
})

describe('computeDashboard', () => {
  it('returns the full dataset under default filters', () => {
    const data = computeDashboard(defaultFilters)
    expect(data.summary.accountsAnalyzed).toBe(27)
    expect(data.findings).toHaveLength(5)
    expect(data.summary.recommendationReady).toBe(3)
  })

  it('filters findings by authority pillar', () => {
    const data = computeDashboard({ ...defaultFilters, pillar: 'credibility' })
    expect(data.findings.length).toBeGreaterThan(0)
    expect(data.findings.every((f) => f.authorityPillar === 'credibility')).toBe(true)
    expect(data.hooks.every((h) => h.pillar === 'credibility')).toBe(true)
  })

  it('filters findings by evidence threshold', () => {
    const strong = computeDashboard({ ...defaultFilters, evidenceThreshold: 'strong' })
    expect(strong.findings.every((f) => f.evidenceStrength === 'strong')).toBe(true)

    const reviewed = computeDashboard({ ...defaultFilters, evidenceThreshold: 'human-reviewed' })
    expect(reviewed.findings.every((f) => f.humanReviewed)).toBe(true)
  })

  it('downgrades recommendation-ready when the sample falls below target', () => {
    const data = computeDashboard({ ...defaultFilters, comparisonGroup: 'emerging' })
    expect(data.summary.accountsAnalyzed).toBeLessThan(20)
    expect(data.summary.recommendationReady).toBe(0)
    expect(data.findings.every((f) => !f.recommendationReady)).toBe(true)
  })

  it('reflects the scaled sample in every finding shown', () => {
    const data = computeDashboard({ ...defaultFilters, comparisonGroup: 'high-performing-comparable' })
    for (const f of data.findings) {
      expect(f.sample.accountsAnalyzed).toBe(data.summary.accountsAnalyzed)
    }
  })
})

describe('findings follow the follower range', () => {
  it('returns a different set for small and large accounts', () => {
    const small = computeDashboard({ ...defaultFilters, followerRangeLabel: 'Under 1K' })
    const large = computeDashboard({ ...defaultFilters, followerRangeLabel: 'Over 50K' })

    const smallIds = small.findings.map((f) => f.id)
    const largeIds = large.findings.map((f) => f.id)

    expect(smallIds).not.toEqual(largeIds)
    // Size-specific findings appear only in their own band.
    expect(smallIds).toContain('find-fixed-rhythm')
    expect(largeIds).not.toContain('find-fixed-rhythm')
    expect(largeIds).toContain('find-reels-reach')
    expect(smallIds).not.toContain('find-reels-reach')
  })

  it('keeps every returned finding schema-valid', () => {
    for (const label of ['Under 1K', '5K – 20K', 'Over 50K']) {
      for (const f of computeDashboard({ ...defaultFilters, followerRangeLabel: label }).findings) {
        expect(finding.safeParse(f).success, `${label}/${f.id}`).toBe(true)
      }
    }
  })
})

describe('one number per fact', () => {
  it('pattern movement reports the same topic share as the topics panel', () => {
    const d = computeDashboard(defaultFilters)
    const byTopic = new Map(d.topics.map((t) => [t.topic, t]))
    let compared = 0
    for (const m of d.movements) {
      const t = byTopic.get(m.pattern)
      if (!t) continue
      compared++
      expect(m.currentValue, `${m.pattern} disagrees across surfaces`).toBeCloseTo(t.sharePct, 0)
    }
    expect(compared, 'expected at least one topic to appear in both surfaces').toBeGreaterThan(0)
  })

  it('high performers are a minority of the comparable group', () => {
    const d = computeDashboard(defaultFilters)
    const { highPerformers, comparison } = d.hashtagBasis
    expect(highPerformers).toBeLessThan(comparison)
  })
})
