import mongoose from 'mongoose'
import { env } from '../config/env.ts'
import { User } from '../middleware/auth.ts'
import { CustomerPlannedPost, CustomerPostEditLog } from '../models/customerData.ts'

/*
 * A generated post as the customer sees it, for Customers › Activity ›
 * Generated posts. Every post keeps its full carousel document
 * (content.carouselHtml — one <article class="slide"> per frame, 1080px wide,
 * kept current by the editor and Theme Apply); the customer app shows a slide by
 * cropping that document, and so does the backoffice (client-side, in a
 * sandboxed iframe). Here the photos are given real URLs: the document stores
 * S3 keys (data-asset-key) and only sometimes a src.
 *
 * Not reproduced: the customer's Brand Kit colour-set / font overrides and logo
 * overlay, which the app layers on at view time.
 */

export interface PostPreview {
  id: string
  title: string
  format: string
  html: string
  slideCount: number
  /** canvas height for a 1080px-wide slide (1350 = 4:5, 1920 = 9:16) */
  height: number
}

const PROJECT_KEY = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+$/i

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null
}

function cdnFromDoc(html: string): string {
  const m = /src="(https:\/\/[^"/]+)\/projects\//i.exec(html)
  return m ? m[1] : ''
}

/* With no MEDIA_CDN_BASE_URL / CUSTOMER_API_URL configured, the CDN host is
 * learned from any stored carousel document that names one (many store photos
 * by key only — e.g. a fresh Theme Apply render — so the post's own document
 * can't be relied on). Remembered for the process once found. */
let learnedCdn = ''
async function cdnHost(...docs: string[]): Promise<string> {
  if (env.customerApiUrl || env.mediaCdnBaseUrl) return ''
  for (const d of docs) {
    const own = cdnFromDoc(d)
    if (own) return (learnedCdn = learnedCdn || own)
  }
  if (learnedCdn) return learnedCdn
  const hit = (await CustomerPlannedPost.findOne({ 'content.carouselHtml': { $regex: 'src="https://[^"/]+/projects/' } })
    .select('content.carouselHtml')
    .lean()) as { content?: { carouselHtml?: string } } | null
  learnedCdn = cdnFromDoc(String(hit?.content?.carouselHtml ?? ''))
  return learnedCdn
}

export function mediaUrlFor(key: string, docCdn = ''): string {
  const k = key.trim()
  if (!PROJECT_KEY.test(k)) return ''
  const path = k.split('/').map(encodeURIComponent).join('/')
  if (env.customerApiUrl) return `${env.customerApiUrl}/api/media/display?key=${encodeURIComponent(k)}&w=1080`
  const cdn = env.mediaCdnBaseUrl || docCdn
  return cdn ? `${cdn}/${path}` : ''
}

/** Give every keyed <img> a loadable src and its Photo Focus crop. */
export function resolveImages(html: string, cdn = ''): string {
  const docCdn = cdnFromDoc(html) || cdn
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    let out = tag
    const key = attr(tag, 'data-asset-key')
    const src = attr(tag, 'src')
    const url = key ? mediaUrlFor(key, docCdn) : ''
    if (url && (!src || !/^https?:/i.test(src) || env.customerApiUrl)) {
      out = src != null
        ? out.replace(/\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, `src="${url}"`)
        : out.replace(/^<img\b/i, `<img src="${url}"`)
    }
    // data-focus "x y w h" (%) = what the slide is about; centre the crop on it
    const focus = (attr(tag, 'data-focus') || '').trim().split(/\s+/).map(Number)
    if (focus.length === 4 && focus.every(Number.isFinite) && !/object-position/i.test(attr(tag, 'style') || '')) {
      const pos = `object-position:${(focus[0] + focus[2] / 2).toFixed(1)}% ${(focus[1] + focus[3] / 2).toFixed(1)}%`
      const style = attr(tag, 'style')
      out = style != null
        ? out.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i, (_m, _q, a, b) => `style="${(a ?? b ?? '').replace(/;?\s*$/, ';')}${pos}"`)
        : out.replace(/^<img\b/i, `<img style="${pos}"`)
    }
    return out
  })
}

export async function getPostPreview(
  customerId: string,
  postId: string,
  options: { includeAdmins?: boolean } = {},
): Promise<PostPreview | null> {
  if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(postId)) return null
  const user = (await User.findById(customerId).select('role').lean()) as { role?: string } | null
  if (!user || (user.role === 'admin' && !options.includeAdmins)) return null

  const post = (await CustomerPlannedPost.findOne({ _id: postId, user: customerId })
    .select('title format content.carouselHtml')
    .lean()) as { _id: unknown; title?: string; format?: string; content?: { carouselHtml?: string } } | null
  if (!post) return null

  const raw = String(post.content?.carouselHtml ?? '').trim()
  const isDoc = /<!doctype html/i.test(raw) || /<html[\s>]/i.test(raw)
  const html = isDoc ? resolveImages(raw, await cdnHost(raw)) : ''
  const format = String(post.format || 'Post')
  return {
    id: String(post._id),
    title: String(post.title ?? ''),
    format,
    html,
    slideCount: html ? (html.match(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/gi) || []).length : 0,
    height: /^(reel|story)/i.test(format) ? 1920 : 1350,
  }
}

/* ── Edit log: the changed slides, before and after ─────────────────────── */

export interface EditPreview {
  before: string
  after: string
  height: number
  /** 0-based slides whose words or markup differ (every slide when the count changed) */
  changed: number[]
}

const ARTICLE = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi

/** Slide markup in post slide order — data-index is the slide number (a Theme
 *  Apply slide sits in its own <section>, often last in the document). The
 *  client's slideDocument orders the same way. */
function slideMarkup(html: string): string[] {
  const out: { at: number; pos: number; html: string }[] = []
  for (const m of html.matchAll(ARTICLE)) {
    if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(m[1])) continue
    const n = Number((/\bdata-index\s*=\s*["']?(\d+)/i.exec(m[1]) || [])[1])
    out.push({ at: Number.isFinite(n) && n > 0 ? n : out.length + 1, pos: out.length, html: m[0] })
  }
  return out.sort((x, y) => x.at - y.at || x.pos - y.pos).map((x) => x.html)
}

export async function getEditPreview(
  customerId: string,
  editId: string,
  options: { includeAdmins?: boolean } = {},
): Promise<EditPreview | null> {
  if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(editId)) return null
  const user = (await User.findById(customerId).select('role').lean()) as { role?: string } | null
  if (!user || (user.role === 'admin' && !options.includeAdmins)) return null

  const log = (await CustomerPostEditLog.findOne({ _id: editId, user: customerId })
    .select('post hasDocs beforeHtml afterHtml')
    .lean()) as { post?: unknown; hasDocs?: boolean; beforeHtml?: string; afterHtml?: string } | null
  if (!log?.hasDocs) return null

  const before = String(log.beforeHtml ?? '')
  const after = String(log.afterHtml ?? '')
  const a = slideMarkup(before)
  const b = slideMarkup(after)
  const n = Math.max(a.length, b.length)
  const changed = a.length !== b.length
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: n }, (_, i) => i).filter((i) => a[i] !== b[i])

  const post = log.post
    ? ((await CustomerPlannedPost.findById(log.post).select('format').lean()) as { format?: string } | null)
    : null
  const cdn = await cdnHost(before, after)
  return {
    before: before ? resolveImages(before, cdn) : '',
    after: after ? resolveImages(after, cdn) : '',
    height: /^(reel|story)/i.test(String(post?.format ?? '')) ? 1920 : 1350,
    changed,
  }
}
