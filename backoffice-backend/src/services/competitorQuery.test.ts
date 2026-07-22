import { describe, expect, it } from 'vitest'
import { parseFollowerRange } from './competitorQuery.ts'

describe('parseFollowerRange', () => {
  it('parses every option the UI offers', () => {
    // The mock repository used a fixed 5-entry lookup while the dropdown
    // offers 9 options, so four of them silently matched nothing.
    expect(parseFollowerRange('Under 1K')).toEqual([0, 1000])
    expect(parseFollowerRange('1K – 3K')).toEqual([1000, 3000])
    expect(parseFollowerRange('3K – 5K')).toEqual([3000, 5000])
    expect(parseFollowerRange('5K – 10K')).toEqual([5000, 10000])
    expect(parseFollowerRange('5K – 20K')).toEqual([5000, 20000])
    expect(parseFollowerRange('10K – 15K')).toEqual([10000, 15000])
    expect(parseFollowerRange('15K – 20K')).toEqual([15000, 20000])
    expect(parseFollowerRange('20K – 50K')).toEqual([20000, 50000])
    expect(parseFollowerRange('Over 50K')).toEqual([50000, null])
  })

  it('handles hyphens and M suffixes', () => {
    expect(parseFollowerRange('1M - 2M')).toEqual([1_000_000, 2_000_000])
  })

  it('returns null for "all" and unparseable labels', () => {
    expect(parseFollowerRange('all')).toBeNull()
    expect(parseFollowerRange('')).toBeNull()
    expect(parseFollowerRange('nonsense')).toBeNull()
  })
})
