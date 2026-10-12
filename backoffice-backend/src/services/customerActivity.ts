import mongoose from 'mongoose'
import { User } from '../middleware/auth.ts'
import {
  CustomerPlannedPost,
  CustomerPostEditLog,
  CustomerProject,
} from '../models/customerData.ts'

/*
 * How a customer is using Bauhly, per Instagram handle — read straight from the
 * customer app's collections (never written):
 *   captures — every capture filed in their projects, with the conversation
 *   posts    — every post generated onto their calendar
 *   edits    — what they changed afterwards (posteditlogs, written by the
 *              customer API's postEditLog middleware; empty before it shipped)
 */

const LIMIT = 200

export type CaptureStatus = 'excluded' | 'used' | 'unclear' | 'needs-info' | 'ready'

export interface CaptureLog {
  id: string
  projectId: string
  projectName: string
  createdAt: string | null
  type: string
  sessionId: string
  title: string
  text: string
  status: CaptureStatus
  photos: number
  videos: number
  questions: string[]
  missingPiece: string
  turns: { role: string; text: string }[]
  usedInPlanAt: string | null
  usedInPosts: number
}

export interface GeneratedPostLog {
  id: string
  date: string
  title: string
  format: string
  pillar: string
  generatedAt: string | null
  model: string
  slides: { role: string; title: string }[]
  caption: string
  hashtags: string[]
  seenAt: string | null
  published: boolean
  scheduledAt: string | null
  savedForReview: boolean
  costUsd: number
  edits: number
  lastEditedAt: string | null
}

export interface EditLog {
  id: string
  at: string | null
  firstAt: string | null
  action: string
  label: string
  count: number
  postId: string | null
  postTitle: string
  postDate: string
  /** before/after carousel documents are stored — see getEditPreview */
  hasPreview: boolean
  changes: { field: string; before: string; after: string }[]
}

export interface CustomerActivity {
  handle: string | null
  captures: CaptureLog[]
  posts: GeneratedPostLog[]
  edits: EditLog[]
  totals: { captures: number; posts: number; edits: number }
}

type Doc = Record<string, unknown>

const iso = (d: unknown): string | null => {
  if (!d) return null
  const t = new Date(d as string)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}
const str = (v: unknown) => (v == null ? '' : String(v))
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function captureStatus(c: Doc): CaptureStatus {
  if (c.excluded) return 'excluded'
  if (c.usedInPlanAt) return 'used'
  const u = (c.understanding ?? {}) as Doc
  const words = str(c.sessionSummary || c.text || u.summary).trim()
  if (!words) return 'unclear'
  if (!c.gapsAnswered && (arr(c.clarifyQuestions).length || str(u.missingPiece).trim())) return 'needs-info'
  return 'ready'
}

function serializeCapture(c: Doc, project: Doc): CaptureLog {
  const atts = arr(c.attachments) as Doc[]
  const u = (c.understanding ?? {}) as Doc
  return {
    id: str(c._id),
    projectId: str(project._id),
    projectName: str(project.name),
    createdAt: iso(c.createdAt),
    type: str(c.type || 'note'),
    sessionId: str(c.sessionId),
    title: str(c.sessionTitle),
    text: str(c.sessionSummary || c.text || u.summary),
    status: captureStatus(c),
    photos: atts.filter((a) => a.type !== 'video').length,
    videos: atts.filter((a) => a.type === 'video').length,
    questions: arr(c.clarifyQuestions).map(str),
    missingPiece: c.gapsAnswered ? '' : str(u.missingPiece),
    turns: (arr(c.conversationTurns) as Doc[]).map((t) => ({ role: str(t.role || 'user'), text: str(t.text) })),
    usedInPlanAt: iso(c.usedInPlanAt),
    usedInPosts: arr(c.usedInPosts).length,
  }
}

/** Returns null when the customer does not exist (or is an admin and admins are hidden). */
export async function getCustomerActivity(
  id: string,
  options: { handle?: string | null; includeAdmins?: boolean } = {},
): Promise<CustomerActivity | null> {
  if (!mongoose.isValidObjectId(id)) return null
  const user = (await User.findById(id).select('role').lean()) as { role?: string } | null
  if (!user || (user.role === 'admin' && !options.includeAdmins)) return null

  const handle = options.handle ? options.handle.replace(/^@/, '').trim().toLowerCase() : null
  const userId = new mongoose.Types.ObjectId(id)
  // projects made before a handle was connected have none — they belong to every handle
  const projectFilter = handle
    ? { user: userId, instagramUsername: { $in: [handle, null, ''] } }
    : { user: userId }
  const scoped = handle ? { user: userId, instagramUsername: handle } : { user: userId }

  const [projects, posts, edits, postTotal, editTotal] = await Promise.all([
    CustomerProject.find(projectFilter)
      .select('name instagramUsername captures')
      .lean() as Promise<Doc[]>,
    CustomerPlannedPost.find(scoped)
      .select('date title format pillar generatedAt createdAt model seenAt published scheduledAt savedForReview usage content.caption content.hashtags content.slides.role content.slides.title')
      .sort({ generatedAt: -1, createdAt: -1 })
      .limit(LIMIT)
      .lean() as Promise<Doc[]>,
    CustomerPostEditLog.find(scoped).select('-beforeHtml -afterHtml').sort({ at: -1 }).limit(LIMIT).lean() as Promise<Doc[]>,
    CustomerPlannedPost.countDocuments(scoped),
    CustomerPostEditLog.countDocuments(scoped),
  ])

  const captures = projects
    .flatMap((p) => (arr(p.captures) as Doc[]).map((c) => serializeCapture(c, p)))
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))

  const editsByPost = new Map<string, { n: number; last: string | null }>()
  for (const e of edits) {
    const k = str(e.post)
    if (!k) continue
    const was = editsByPost.get(k)
    editsByPost.set(k, { n: (was?.n ?? 0) + Number(e.count || 1), last: was?.last ?? iso(e.at) })
  }

  return {
    handle,
    captures: captures.slice(0, LIMIT),
    posts: posts.map((p) => {
      const c = (p.content ?? {}) as Doc
      const usage = (p.usage ?? {}) as Doc
      const ed = editsByPost.get(str(p._id))
      return {
        id: str(p._id),
        date: str(p.date),
        title: str(p.title),
        format: str(p.format || 'Post'),
        pillar: str(p.pillar),
        generatedAt: iso(p.generatedAt || p.createdAt),
        model: str(p.model || usage.model),
        slides: (arr(c.slides) as Doc[]).map((s) => ({ role: str(s.role), title: str(s.title) })),
        caption: str(c.caption),
        hashtags: arr(c.hashtags).map(str),
        seenAt: iso(p.seenAt),
        published: Boolean(p.published),
        scheduledAt: iso(p.scheduledAt),
        savedForReview: Boolean(p.savedForReview),
        costUsd: Number(usage.estimatedCostUsd || 0),
        edits: ed?.n ?? 0,
        lastEditedAt: ed?.last ?? null,
      }
    }),
    edits: edits.map((e) => ({
      id: str(e._id),
      at: iso(e.at),
      firstAt: iso(e.firstAt),
      action: str(e.action || 'edit'),
      label: str(e.label),
      count: Number(e.count || 1),
      postId: e.post ? str(e.post) : null,
      postTitle: str(e.postTitle),
      postDate: str(e.postDate),
      hasPreview: Boolean(e.hasDocs),
      changes: (arr(e.changes) as Doc[]).map((c) => ({
        field: str(c.field),
        before: str(c.before),
        after: str(c.after),
      })),
    })),
    totals: { captures: captures.length, posts: postTotal, edits: editTotal },
  }
}
