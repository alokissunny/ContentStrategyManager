import { describe, expect, it } from 'vitest'
import { normalizePost, normalizeProfile, parseInstagramInput } from './instagram.ts'

describe('normalizeProfile', () => {
  it('returns null for a not-found row rather than a zeroed profile', () => {
    // The actor returns a row with an `error` field for handles that don't
    // exist. Persisting that as a profile is the bug this guards.
    expect(normalizeProfile({ username: 'ghost', error: 'not_found' }, 'ghost')).toBeNull()
    expect(normalizeProfile(undefined, 'ghost')).toBeNull()
  })

  it('reads field aliases across actor versions', () => {
    const a = normalizeProfile({ username: 'x', followersCount: 100, fullName: 'X' }, 'x')
    const b = normalizeProfile({ username: 'x', followers: 100, full_name: 'X' }, 'x')
    expect(a?.followerCount).toBe(100)
    expect(b?.followerCount).toBe(100)
    expect(b?.displayName).toBe('X')
  })

  it('records absent fields as missing instead of failing', () => {
    const profile = normalizeProfile({ username: 'x' }, 'x')
    expect(profile).not.toBeNull()
    expect(profile!.followerCount).toBeNull()
    expect(profile!.missingFields).toContain('followerCount')
  })
})

describe('normalizePost', () => {
  it('maps actor types onto formats', () => {
    expect(normalizePost({ id: '1', type: 'Sidecar' })?.format).toBe('carousel')
    expect(normalizePost({ id: '2', productType: 'clips' })?.format).toBe('reel')
    expect(normalizePost({ id: '3', type: 'Image' })?.format).toBe('image')
    expect(normalizePost({ id: '4' })?.format).toBe('unknown')
  })

  it('treats a negative like count as hidden metrics, not a value', () => {
    const post = normalizePost({ id: '1', likesCount: -1, commentsCount: 4 })
    expect(post?.likes).toBeNull()
    expect(post?.metricsHidden).toBe(true)
    expect(post?.comments).toBe(4)
  })

  it('extracts hashtags and mentions from the caption', () => {
    const post = normalizePost({ id: '1', caption: 'Oak kitchen #InteriorDesign #oak with @studio.one' })
    expect(post?.hashtags).toEqual(['interiordesign', 'oak'])
    expect(post?.mentions).toEqual(['studio.one'])
  })

  it('drops rows with no usable post id', () => {
    expect(normalizePost({ caption: 'orphan' })).toBeNull()
  })
})

describe('parseInstagramInput', () => {
  it('accepts handles, @handles and URLs', () => {
    expect(parseInstagramInput('atelier.noor')).toBe('atelier.noor')
    expect(parseInstagramInput('@Atelier.Noor')).toBe('atelier.noor')
    expect(parseInstagramInput('https://www.instagram.com/atelier.noor/?hl=en')).toBe('atelier.noor')
  })

  it('rejects anything that is not a handle', () => {
    expect(parseInstagramInput('')).toBeNull()
    expect(parseInstagramInput('not a handle!')).toBeNull()
  })
})
