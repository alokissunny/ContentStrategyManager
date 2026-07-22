import { describe, expect, it } from 'vitest'
import { recommendationOutcome } from '../../types'
import { mockCustomers } from '../customers/mockData'
import {
  MIN_FOLLOWED_FOR_RATE,
  getAllTrackRecords,
  getOutcomes,
  getTrackRecord,
  summariseOutcomes,
} from './repository'

describe('outcome records', () => {
  it('validate against the schema for every customer', () => {
    for (const c of mockCustomers) {
      for (const o of getOutcomes(c.id)) {
        const result = recommendationOutcome.safeParse(o)
        expect(result.success, `${o.id}: ${JSON.stringify(result.error?.issues?.[0])}`).toBe(true)
      }
    }
  })

  it('are deterministic', () => {
    const a = getOutcomes('cust-4').map((o) => `${o.contentType}:${o.verdict}`)
    const b = getOutcomes('cust-4').map((o) => `${o.contentType}:${o.verdict}`)
    expect(a).toEqual(b)
  })

  it('returns nothing for an unknown customer', () => {
    expect(getOutcomes('does-not-exist')).toEqual([])
  })
})

describe('a recommendation that was never followed has no result', () => {
  it('reports no metric rather than a zero', () => {
    for (const c of mockCustomers) {
      for (const o of getOutcomes(c.id)) {
        if (o.adherence === 'not-followed' || o.adherence === 'pending') {
          expect(o.metricChangePct, `${o.id} invented a result`).toBeNull()
          expect(['not-evaluable', 'too-early']).toContain(o.verdict)
        }
      }
    }
  })

  it('counts it against adherence but not against success', () => {
    const outcomes = getOutcomes('cust-4')
    const summary = summariseOutcomes(outcomes)
    const notFollowed = outcomes.filter((o) => o.adherence === 'not-followed').length
    expect(summary.recommended).toBeGreaterThanOrEqual(summary.followed + notFollowed)
    // Success is measured only against what was actually followed.
    if (summary.successPct != null) {
      expect(summary.improvedAfter).toBeLessThanOrEqual(summary.followed)
    }
  })
})

describe('causality guards', () => {
  it('never uses causal language in a verdict', () => {
    const verdicts = new Set(mockCustomers.flatMap((c) => getOutcomes(c.id)).map((o) => o.verdict))
    for (const v of verdicts) {
      expect(v).not.toMatch(/because|caused|due-to/)
    }
  })

  it('attaches confounders to every measured result', () => {
    for (const c of mockCustomers.slice(0, 10)) {
      for (const o of getOutcomes(c.id)) {
        if (o.metricChangePct != null) {
          expect(o.confounders.length, `${o.id} reports a result with nothing caveated`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('thin evidence is refused, not rounded', () => {
  it('withholds a success rate below the minimum followed count', () => {
    for (const c of mockCustomers) {
      const s = summariseOutcomes(getOutcomes(c.id))
      if (s.followed < MIN_FOLLOWED_FOR_RATE) {
        expect(s.successPct, `${c.id} reported a rate on ${s.followed} follows`).toBeNull()
        expect(s.reportable).toBe(false)
      }
    }
  })

  it('withholds a median on a play too few customers ran', () => {
    for (const r of getAllTrackRecords()) {
      if (r.followed < MIN_FOLLOWED_FOR_RATE) {
        expect(r.medianChangePct).toBeNull()
        expect(r.reportable).toBe(false)
      }
    }
  })
})

describe('track records', () => {
  it('never count more follows than recommendations', () => {
    for (const r of getAllTrackRecords()) {
      expect(r.followed).toBeLessThanOrEqual(r.recommended)
      expect(r.improvedAfter + r.declinedAfter).toBeLessThanOrEqual(r.followed)
    }
  })

  it('returns null for a play nobody was ever recommended', () => {
    expect(getTrackRecord('Not A Real Play')).toBeNull()
  })

  it('cover every play the playbook can recommend', () => {
    const records = getAllTrackRecords()
    expect(records.length).toBe(12)
  })
})
