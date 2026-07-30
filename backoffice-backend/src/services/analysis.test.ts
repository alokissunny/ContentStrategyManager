import { describe, expect, it } from 'vitest'
import { buildCaptionAnalysis, extractJson } from './analysis.ts'
import type { CondensedAccount, CorpusStats } from './analysisCorpus.ts'

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] })
  })

  it('parses JSON inside a ```json fence', () => {
    expect(extractJson('here you go:\n```json\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('salvages an array truncated mid-element (max_tokens cut-off)', () => {
    // Mirrors the map-memo failure: a valid object element, then a partial one.
    const truncated = '{"themes":[{"theme":"A","pillar":"discovery"},{"theme":"Comment-to-unlock'
    const parsed = extractJson(truncated) as { themes: { theme: string }[] }
    expect(parsed.themes).toHaveLength(1)
    expect(parsed.themes[0]!.theme).toBe('A')
  })

  it('salvages a truncated captionPatterns array and keeps completed entries', () => {
    const truncated =
      '{"captionPatterns":[' +
      '{"name":"Educational Misconception","pillar":"discovery","structure":[{"step":"Misconception","detail":"x"}]},' +
      '{"name":"Client Stories","pillar":"trust"' // cut off here
    const parsed = extractJson(truncated) as { captionPatterns: { name: string }[] }
    expect(parsed.captionPatterns.length).toBeGreaterThanOrEqual(1)
    expect(parsed.captionPatterns[0]!.name).toBe('Educational Misconception')
  })

  it('throws only when nothing at all can be recovered', () => {
    expect(() => extractJson('not json, no braces here')).toThrow()
  })
})

describe('buildCaptionAnalysis per-pillar formats', () => {
  const exemplar = (platformPostId: string, format: string) => ({
    platformPostId,
    publishedAt: '2026-07-15T10:30:00.000Z',
    format,
    caption: `caption ${platformPostId}`,
    hashtags: [],
    likes: 1,
    comments: 1,
    views: null,
    engagement: 2,
    engagementRate: 1,
  })
  const account = {
    username: 'studio.one',
    displayName: 'Studio One',
    exemplars: [exemplar('p1', 'reel'), exemplar('p2', 'carousel'), exemplar('p3', 'reel')],
    window: { formatMix: [], postingDays: [] },
  } as unknown as CondensedAccount

  const corpus = {
    accountsWithPosts: 1,
    totalPosts: 3,
    formatMix: [
      { format: 'carousel', sharePct: 33.3, posts: 1 },
      { format: 'reel', sharePct: 66.7, posts: 2 },
    ],
    postingDays: [],
  } as unknown as CorpusStats

  // Discovery captions used the reels (p1, p3); Credibility used the carousel (p2).
  const batchMemos = [
    {
      captionPatterns: [
        { name: 'Hook thing', pillar: 'discovery', posts: ['p1', 'p3'] },
        { name: 'Decision thing', pillar: 'credibility', posts: ['p2'] },
      ],
    },
  ]

  it('ranks each pillar by its own posts, not the global list', () => {
    const ca = buildCaptionAnalysis(
      {
        patterns: [
          { name: 'Hook thing', pillar: 'discovery', sharePct: 66.7, captions: 2 },
          { name: 'Decision thing', pillar: 'credibility', sharePct: 33.3, captions: 1 },
        ],
      },
      corpus,
      [account],
      30,
      'last-30',
      batchMemos,
    ) as {
      formatsByPillar: Record<string, { label: string; posts: number }[]>
      kpis: { captions: number }
    }
    expect(ca.formatsByPillar.discovery[0]?.label).toBe('Reel')
    expect(ca.formatsByPillar.credibility[0]?.label).toBe('Carousel')
  })

  it('scales pillar format posts so the three pillars sum to the corpus total', () => {
    const ca = buildCaptionAnalysis(
      {
        patterns: [
          { name: 'Hook thing', pillar: 'discovery', sharePct: 66.7, captions: 2 },
          { name: 'Decision thing', pillar: 'credibility', sharePct: 33.3, captions: 1 },
        ],
      },
      corpus,
      [account],
      30,
      'last-30',
      batchMemos,
    ) as {
      formatsByPillar: Record<string, { posts: number }[]>
      kpis: { captions: number }
    }
    const sumPillar = (['discovery', 'credibility', 'trust'] as const).reduce(
      (s, p) => s + (ca.formatsByPillar[p] ?? []).reduce((n, r) => n + r.posts, 0),
      0,
    )
    expect(sumPillar).toBe(ca.kpis.captions)
    expect(ca.kpis.captions).toBe(3)
  })
})
