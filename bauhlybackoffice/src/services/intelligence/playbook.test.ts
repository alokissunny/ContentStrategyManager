import { describe, expect, it } from 'vitest'
import { defaultSegment, getPlaybook, segmentOptions, type PillarKey } from './playbook'

describe('playbook plan', () => {
  it('runs seven days', async () => {
    const p = await getPlaybook(defaultSegment)
    expect(p.plan).toHaveLength(7)
  })

  it('never reports two adoption figures for the same play', async () => {
    for (const gap of segmentOptions.gap) {
      for (const followerRange of segmentOptions.followerRange) {
        const p = await getPlaybook({ ...defaultSegment, followerRange, gap: gap.value as PillarKey })
        const seen = new Map<string, number>()
        for (const day of p.plan) {
          const prior = seen.get(day.contentType)
          if (prior != null) {
            expect(day.adoptionPct, `${day.contentType} reports two figures`).toBe(prior)
          }
          seen.set(day.contentType, day.adoptionPct)
        }
      }
    }
  })

  it('describes what a high performer is, and keeps them a minority', async () => {
    const p = await getPlaybook(defaultSegment)
    expect(p.evidence.highPerformerDefinition).toMatch(/engagement rate/i)
    expect(p.evidence.highPerformers).toBeLessThan(p.evidence.comparisonAccounts / 2)
  })
})
