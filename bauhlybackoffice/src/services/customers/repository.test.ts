import { describe, expect, it } from 'vitest'
import { customer } from '../../types'
import { mockCustomers, mockFunnel } from './mockData'
import { defaultCustomerQuery, listCustomersSync } from './repository'

describe('customer mock dataset', () => {
  it('has 54 schema-valid customers', () => {
    expect(mockCustomers).toHaveLength(54)
    for (const c of mockCustomers) {
      const result = customer.safeParse(c)
      expect(result.success, `${c.id}: ${JSON.stringify(result.error?.issues?.[0])}`).toBe(true)
    }
  })

  it('funnel counts are monotonically decreasing', () => {
    for (let i = 1; i < mockFunnel.length; i++) {
      expect(mockFunnel[i].count).toBeLessThanOrEqual(mockFunnel[i - 1].count)
    }
  })
})

describe('listCustomersSync', () => {
  it('paginates and reports stats', () => {
    const r = listCustomersSync(defaultCustomerQuery)
    expect(r.rows).toHaveLength(8)
    expect(r.stats.total).toBe(54)
    expect(r.stats.onboardingCompletion).toBe(Math.round((31 / 54) * 100))
  })

  it('filters by status and onboarding completion', () => {
    const atRisk = listCustomersSync({ ...defaultCustomerQuery, status: 'declining' })
    expect(atRisk.total).toBeGreaterThan(0)
    expect(atRisk.rows.every((r) => r.status === 'declining')).toBe(true)

    const completed = listCustomersSync({ ...defaultCustomerQuery, onboarding: 'completed' })
    const inProgress = listCustomersSync({ ...defaultCustomerQuery, onboarding: 'in-progress' })
    expect(completed.total + inProgress.total).toBe(54)
  })

  it('searches by name', () => {
    const r = listCustomersSync({ ...defaultCustomerQuery, search: 'atelier dawn' })
    expect(r.total).toBe(1)
    expect(r.rows[0].name).toBe('Atelier Dawn')
  })
})

describe('filters drive every reported figure', () => {
  it('summary stats describe the filtered set, not the whole base', () => {
    const all = listCustomersSync(defaultCustomerQuery)
    const churned = listCustomersSync({ ...defaultCustomerQuery, lifecycle: 'churned' })

    expect(churned.stats.total).toBe(churned.total)
    expect(churned.stats.total).toBeLessThan(all.stats.total)
    // Content adoption and the journey funnel scale with the cohort too.
    expect(churned.adoption.delivered).toBeLessThan(all.adoption.delivered)
    expect(churned.funnel[0].count).toBeLessThan(all.funnel[0].count)
  })

  it('status mix counts only the filtered customers', () => {
    const atRisk = listCustomersSync({ ...defaultCustomerQuery, lifecycle: 'at-risk' })
    const mixTotal = atRisk.overallTrend.statusMix.reduce((sum, s) => sum + s.count, 0)
    expect(mixTotal).toBe(atRisk.total)
  })
})

describe('cohort metrics are computed from the cohort, not scaled from a global', () => {
  it('a declining cohort reports declines', () => {
    const r = listCustomersSync({ ...defaultCustomerQuery, status: 'declining' })
    expect(r.rows.length).toBeGreaterThan(0)
    for (const m of r.overallTrend.metrics) {
      expect(m.deltaPp, `${m.label} should not be positive for a declining cohort`).toBeLessThanOrEqual(0)
    }
  })

  it('an improving cohort reports gains', () => {
    const r = listCustomersSync({ ...defaultCustomerQuery, status: 'improving' })
    expect(r.rows.length).toBeGreaterThan(0)
    for (const m of r.overallTrend.metrics) {
      expect(m.deltaPp, `${m.label} should not be negative for an improving cohort`).toBeGreaterThanOrEqual(0)
    }
  })

  it('different cohorts produce different funnel shapes', () => {
    const shape = (q: Parameters<typeof listCustomersSync>[0]) => {
      const f = listCustomersSync(q).funnel
      const top = f[0].count || 1
      return f.map((s) => Math.round((s.count / top) * 100)).join('-')
    }
    const onboarding = shape({ ...defaultCustomerQuery, lifecycle: 'onboarding' })
    const active = shape({ ...defaultCustomerQuery, lifecycle: 'active' })
    expect(onboarding).not.toBe(active)
  })

  it('funnel counts never exceed the cohort size and never increase down the funnel', () => {
    const r = listCustomersSync({ ...defaultCustomerQuery, lifecycle: 'at-risk' })
    for (let i = 0; i < r.funnel.length; i++) {
      expect(r.funnel[i].count).toBeLessThanOrEqual(r.total)
      if (i > 0) expect(r.funnel[i].count).toBeLessThanOrEqual(r.funnel[i - 1].count)
    }
  })
})
