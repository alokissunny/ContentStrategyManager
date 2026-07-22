import { ApifyClient } from 'apify-client'
import { env } from '../config/env.ts'

/*
 * Instagram collection via Apify.
 *
 * Ported from the customer API (backend/src/services/instagramScraper.js),
 * keeping two hard-won behaviours:
 *  - actor output field names vary by actor version, so read a few aliases
 *    defensively rather than trusting one exact schema;
 *  - the actor returns a row with an `error` field (e.g. `not_found`) for
 *    handles that don't exist or can't be read. That is NOT a profile — treat
 *    it as absence, otherwise you persist a real-looking account with zeroed
 *    stats.
 */

let client: ApifyClient | undefined

function getApifyClient(): ApifyClient {
  if (!process.env.APIFY_TOKEN) {
    throw new Error('APIFY_TOKEN is not set. Add it to backoffice-backend/.env to enable collection.')
  }
  if (!client) client = new ApifyClient({ token: process.env.APIFY_TOKEN })
  return client
}

type Raw = Record<string, unknown>

function firstDefined<T = unknown>(obj: Raw | undefined, keys: string[]): T | undefined {
  if (!obj) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (v !== undefined && v !== null) return v as T
  }
  return undefined
}

export interface ScrapedProfile {
  username: string
  displayName: string | null
  biography: string | null
  website: string | null
  category: string | null
  followerCount: number | null
  followingCount: number | null
  visiblePostCount: number | null
  verified: boolean | null
  profileImageUrl: string | null
  /** Fields the source did not return this run — feeds dataQuality. */
  missingFields: string[]
  warnings: string[]
}

const PROFILE_FIELDS: { key: keyof ScrapedProfile; aliases: string[] }[] = [
  { key: 'displayName', aliases: ['fullName', 'full_name'] },
  { key: 'biography', aliases: ['biography', 'bio'] },
  { key: 'website', aliases: ['externalUrl', 'external_url'] },
  { key: 'category', aliases: ['businessCategoryName', 'category', 'categoryName'] },
  { key: 'followerCount', aliases: ['followersCount', 'followers_count', 'followers'] },
  { key: 'followingCount', aliases: ['followsCount', 'followingCount', 'following'] },
  { key: 'visiblePostCount', aliases: ['postsCount', 'posts_count'] },
  { key: 'verified', aliases: ['verified', 'isVerified'] },
  { key: 'profileImageUrl', aliases: ['profilePicUrlHD', 'profilePicUrl', 'profile_pic_url'] },
]

/** Returns null when the handle does not resolve (not found / unreadable). */
export function normalizeProfile(raw: Raw | undefined, username: string): ScrapedProfile | null {
  if (!raw || raw.error) return null

  const missingFields: string[] = []
  const out: Record<string, unknown> = {
    username: (firstDefined<string>(raw, ['username', 'account']) ?? username).toLowerCase(),
  }

  for (const { key, aliases } of PROFILE_FIELDS) {
    const value = firstDefined(raw, aliases)
    if (value === undefined) {
      missingFields.push(key)
      out[key] = null
    } else {
      out[key] = key === 'verified' ? Boolean(value) : value
    }
  }

  return { ...(out as unknown as ScrapedProfile), missingFields, warnings: [] }
}

export interface ScrapedPost {
  platformPostId: string
  url: string | null
  publishedAt: Date | null
  caption: string | null
  hashtags: string[]
  mentions: string[]
  format: 'image' | 'carousel' | 'reel' | 'video' | 'unknown'
  carouselCount: number | null
  videoDurationSeconds: number | null
  likes: number | null
  comments: number | null
  views: number | null
  /** Account hides like counts — metrics are permanently null, not missing. */
  metricsHidden: boolean
  /**
   * The untouched actor item this was mapped from, carried through so
   * collection can persist it for the raw-JSON inspector. Not part of the
   * domain model — nothing should read fields off it to make decisions, or the
   * defensive alias handling above gets bypassed.
   */
  raw?: Record<string, unknown>
}

function toFormat(raw: Raw): ScrapedPost['format'] {
  const type = String(firstDefined(raw, ['type', 'productType']) ?? '')
  if (/clips|reel/i.test(type)) return 'reel'
  if (/sidecar|carousel|album/i.test(type)) return 'carousel'
  if (/video/i.test(type)) return 'video'
  if (/image|photo|graphimage/i.test(type)) return 'image'
  return 'unknown'
}

function extractTags(caption: string | null, pattern: RegExp): string[] {
  if (!caption) return []
  return [...new Set((caption.match(pattern) ?? []).map((t) => t.slice(1).toLowerCase()))]
}

export function normalizePost(raw: Raw): ScrapedPost | null {
  const platformPostId = String(firstDefined(raw, ['id', 'shortCode', 'pk']) ?? '')
  if (!platformPostId) return null

  const caption = (firstDefined<string>(raw, ['caption', 'text']) ?? null) || null
  const likes = firstDefined<number>(raw, ['likesCount', 'likes_count', 'likes'])
  const comments = firstDefined<number>(raw, ['commentsCount', 'comments_count', 'comments'])
  const rawTs = firstDefined<string | number>(raw, ['timestamp', 'takenAt', 'taken_at'])

  return {
    platformPostId,
    url: firstDefined<string>(raw, ['url', 'postUrl']) ?? null,
    publishedAt: rawTs ? new Date(rawTs) : null,
    caption,
    hashtags: extractTags(caption, /#[\p{L}0-9_]+/gu),
    mentions: extractTags(caption, /@[A-Za-z0-9._]+/g),
    format: toFormat(raw),
    carouselCount: firstDefined<number>(raw, ['childPosts'])
      ? (firstDefined<unknown[]>(raw, ['childPosts']) as unknown[]).length
      : null,
    videoDurationSeconds: firstDefined<number>(raw, ['videoDuration']) ?? null,
    // A negative count is Instagram's "hidden", not a real value.
    likes: typeof likes === 'number' && likes >= 0 ? likes : null,
    comments: typeof comments === 'number' && comments >= 0 ? comments : null,
    views: firstDefined<number>(raw, ['videoViewCount', 'videoPlayCount', 'views']) ?? null,
    metricsHidden: typeof likes === 'number' && likes < 0,
    raw,
  }
}

export async function scrapeProfile(username: string): Promise<ScrapedProfile | null> {
  const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || 'apify/instagram-profile-scraper'
  const run = await getApifyClient().actor(actorId).call({ usernames: [username] })
  const { items } = await getApifyClient().dataset(run.defaultDatasetId).listItems()
  return normalizeProfile(items[0] as Raw | undefined, username)
}

export async function scrapePosts(username: string, limit?: number): Promise<ScrapedPost[]> {
  const actorId = process.env.APIFY_INSTAGRAM_POST_ACTOR || 'apify/instagram-post-scraper'
  const resultsLimit = limit ?? env.collection.postsPerAccount
  const run = await getApifyClient().actor(actorId).call({ username: [username], resultsLimit })
  const { items } = await getApifyClient().dataset(run.defaultDatasetId).listItems()
  return (items as Raw[]).map(normalizePost).filter((p): p is ScrapedPost => p !== null)
}

/** Accepts a bare handle, @handle, or any instagram.com URL. */
export function parseInstagramInput(raw: string): string | null {
  const cleaned = (raw ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim()
    .toLowerCase()
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null
}
