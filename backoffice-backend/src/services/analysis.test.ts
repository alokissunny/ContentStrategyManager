import { describe, expect, it } from 'vitest'
import { extractJson } from './analysis.ts'

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
