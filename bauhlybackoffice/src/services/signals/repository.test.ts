import { describe, expect, it } from 'vitest'
import { signal } from '../../types'
import { computeDashboard } from '../intelligence/repository'
import { mockCustomers } from '../customers/mockData'
import { computeSignals, defaultSignalsQuery, segmentPresets } from './repository'
import { postsByPattern } from './mockPosts'

describe('signal shape', () => {
  it('every signal validates against the schema', () => {
    const signals = computeSignals(defaultSignalsQuery)
    expect(signals.length).toBeGreaterThan(0)
    for (const s of signals) {
      const result = signal.safeParse(s)
      expect(result.success, `${s.id}: ${JSON.stringify(result.error?.issues?.[0])}`).toBe(true)
    }
  })

  it('every signal names where its number came from', () => {
    for (const s of computeSignals(defaultSignalsQuery)) {
      expect(s.derivedFrom.length).toBeGreaterThan(0)
    }
  })
})

describe('ranking', () => {
  it('never puts an exploratory signal above a strong one', () => {
    const signals = computeSignals(defaultSignalsQuery)
    const rankOf = { strong: 3, moderate: 2, exploratory: 1 } as const
    const firstExploratory = signals.findIndex((s) => s.strength === 'exploratory')
    if (firstExploratory === -1) return
    const strongAfter = signals
      .slice(firstExploratory)
      .find((s) => rankOf[s.strength as keyof typeof rankOf] > 1 && s.tone === signals[firstExploratory].tone)
    expect(strongAfter, 'a better-evidenced signal of the same tone sorted below a weaker one').toBeUndefined()
  })

  it('leads with signals that need a person before ones that merely could be acted on', () => {
    const signals = computeSignals(defaultSignalsQuery)
    const lastAlert = signals.map((s) => s.tone).lastIndexOf('alert')
    const firstOpportunity = signals.map((s) => s.tone).indexOf('opportunity')
    if (lastAlert === -1 || firstOpportunity === -1) return
    expect(lastAlert).toBeLessThan(firstOpportunity)
  })

  it('is deterministic — the same query returns the same order', () => {
    const a = computeSignals(defaultSignalsQuery).map((s) => s.id)
    const b = computeSignals(defaultSignalsQuery).map((s) => s.id)
    expect(a).toEqual(b)
  })
})

describe('signals cannot contradict the panels they summarise', () => {
  it('reports the same current value as pattern movement', () => {
    const q = { ...defaultSignalsQuery, window: 'this-month' as const }
    const dash = computeDashboard(q.segment)
    const byPattern = new Map(dash.movements.map((m) => [m.pattern, m]))

    const patternSignals = computeSignals(q).filter((s) => s.kind === 'pattern')
    expect(patternSignals.length).toBeGreaterThan(0)

    for (const s of patternSignals) {
      const nowValue = s.evidence.find((e) => e.label === 'Now')?.value
      const pattern = [...byPattern.keys()].find((p) => s.headline.startsWith(p))
      expect(pattern, `could not match signal to a movement: ${s.headline}`).toBeDefined()
      expect(nowValue).toBe(`${byPattern.get(pattern as string)?.currentValue}% of posts`)
    }
  })

  it('never claims a customer is publishing when they have gone quiet', () => {
    for (const s of computeSignals(defaultSignalsQuery)) {
      if (!s.headline.includes('publishing but still declining')) continue
      const lastActive = s.evidence.find((e) => e.label === 'Last active')?.value ?? ''
      const days = lastActive === 'today' ? 0 : Number.parseInt(lastActive, 10)
      expect(days, `${s.headline} contradicts its own evidence`).toBeLessThan(12)
    }
  })

  it('only reports customers from the selected market', () => {
    const nl = segmentPresets.find((p) => p.id === 'nl')!
    const signals = computeSignals({ ...defaultSignalsQuery, segment: nl.filters })
    const dutch = new Set(
      mockCustomers.filter((c) => c.location.country === 'Netherlands').map((c) => c.name),
    )
    for (const s of signals.filter((x) => x.kind === 'customer')) {
      const named = [...dutch].some((name) => s.headline.startsWith(name))
      expect(named, `${s.headline} is not a Netherlands customer`).toBe(true)
    }
  })
})

describe('thresholds', () => {
  it('reports the figure that qualified the signal, not a different one', () => {
    for (const window of ['this-week', 'this-month'] as const) {
      const signals = computeSignals({ ...defaultSignalsQuery, window })
      const scale = window === 'this-week' ? 7 / 30 : 1
      for (const s of signals.filter((x) => x.kind === 'pattern')) {
        const change = s.evidence.find((e) => e.label === 'Change')?.value ?? '0pp'
        const pp = Math.abs(Number.parseFloat(change))
        expect(pp, `${s.headline} is below the bar it supposedly cleared`).toBeGreaterThanOrEqual(
          4 * scale - 0.05,
        )
      }
    }
  })

  it('a demand gap is only reported where competitors are not already answering it', () => {
    const dash = computeDashboard(defaultSignalsQuery.segment)
    const supply = new Map(dash.topics.map((t) => [t.topic, t.sharePct]))
    for (const s of computeSignals(defaultSignalsQuery).filter((x) => x.kind === 'demand-gap')) {
      const topic = s.headline.match(/“(.+)”/)?.[1]
      expect(topic).toBeDefined()
      expect(supply.get(topic as string) ?? 0).toBeLessThan(8)
    }
  })
})

describe('example posts', () => {
  it('are keyed to patterns that actually exist', () => {
    const dash = computeDashboard(defaultSignalsQuery.segment)
    const known = new Set(dash.movements.map((m) => m.pattern))
    for (const key of Object.keys(postsByPattern)) {
      expect(known.has(key), `no movement named "${key}" — its posts would never show`).toBe(true)
    }
  })

  it('carry a caption and a link back to the source', () => {
    for (const posts of Object.values(postsByPattern)) {
      for (const p of posts) {
        expect(p.captionExcerpt.length).toBeGreaterThan(10)
        expect(p.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//)
      }
    }
  })
})
