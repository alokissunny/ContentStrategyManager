import mongoose from 'mongoose'
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { User } from '../middleware/auth.ts'

/*
 * Delete a customer account and everything the customer app keeps for it.
 *
 * This is the backoffice's one write into the customer app's collections, so
 * the list is explicit rather than "every collection with a user field":
 *   by `user`   — the customer API's current models (backend/src/models)
 *   by `userId` — legacy collections from the earlier product
 *   planrunposts by their run (PlanRun ids of this user)
 * Media in S3 lives under projects/<userId>/ and reports/<userId>/ and is
 * removed first; if S3 is configured and that fails, nothing is deleted, so a
 * retry can finish the job. With S3 not configured the files are left and the
 * result says so.
 *
 * Guard rails: admins can't be deleted from here, nor can the signed-in admin,
 * and the caller must repeat the customer's email.
 */

const BY_USER = [
  'instagramprofiles',
  'projects',
  'plannedposts',
  'posteditlogs',
  'planruns',
  'weeklyroutes',
  'brandanalysisreports',
  'competitorsets',
  'metaconnections',
  'linkedinconnections',
  'linkedinpublications',
  'signals',
  'backoffice_customer_cohorts',
] as const

const BY_USER_ID = [
  'branddnas',
  'strategies',
  'instagramdatas',
  'apifysnapshots',
  'contentplans',
  'analytics',
  'competitorsuggestions',
] as const

const LABELS: Record<string, string> = {
  instagramprofiles: 'Instagram accounts',
  projects: 'Projects (captures)',
  plannedposts: 'Generated posts',
  posteditlogs: 'Edit logs',
  planruns: 'Plan runs',
  planrunposts: 'Plan run posts',
  weeklyroutes: 'Weekly plans (legacy)',
  brandanalysisreports: 'Brand reports',
  competitorsets: 'Competitor sets',
  metaconnections: 'Instagram connections',
  linkedinconnections: 'LinkedIn connections',
  linkedinpublications: 'LinkedIn publications',
  signals: 'Signals',
  backoffice_customer_cohorts: 'Cohort assignments',
  branddnas: 'Brand DNA (legacy)',
  strategies: 'Strategies (legacy)',
  instagramdatas: 'Instagram data (legacy)',
  apifysnapshots: 'Apify snapshots (legacy)',
  contentplans: 'Content plans (legacy)',
  analytics: 'Analytics (legacy)',
  competitorsuggestions: 'Competitor suggestions (legacy)',
}

export class DeletionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface DeletionSummary {
  id: string
  name: string
  email: string
  handles: string[]
  canDelete: boolean
  /** why it can't be deleted, when it can't */
  blockedReason: string | null
  items: { key: string; label: string; count: number }[]
  mediaWillBeDeleted: boolean
}

export interface DeletionResult {
  deleted: { key: string; label: string; count: number }[]
  mediaFilesDeleted: number
  mediaSkipped: boolean
}

type LeanUser = { _id: mongoose.Types.ObjectId; name?: string; email?: string; role?: string }

function db() {
  const d = mongoose.connection.db
  if (!d) throw new DeletionError(503, 'Database is not connected.')
  return d
}

function s3(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.S3_BUCKET_NAME
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return null
  return { client: new S3Client({ region: process.env.AWS_REGION || 'us-east-1' }), bucket }
}

async function loadUser(id: string): Promise<LeanUser> {
  if (!mongoose.isValidObjectId(id)) throw new DeletionError(404, 'Customer not found')
  const user = (await User.findById(id).select('name email role').lean()) as LeanUser | null
  if (!user) throw new DeletionError(404, 'Customer not found')
  return user
}

function blockedReason(user: LeanUser, adminId: string): string | null {
  if (String(user._id) === adminId) return 'You can’t delete the account you are signed in with.'
  if (user.role === 'admin') return 'Admin accounts can’t be deleted from the backoffice.'
  return null
}

async function counts(uid: mongoose.Types.ObjectId) {
  const d = db()
  const userIdMatch = { userId: { $in: [uid, String(uid)] } }
  const runIds = (await d.collection('planruns').find({ user: uid }).project({ _id: 1 }).toArray()).map((r) => r._id)
  const items = await Promise.all([
    ...BY_USER.map(async (c) => ({ key: c, count: await d.collection(c).countDocuments({ user: uid }) })),
    (async () => ({
      key: 'planrunposts',
      count: runIds.length ? await d.collection('planrunposts').countDocuments({ run: { $in: runIds } }) : 0,
    }))(),
    ...BY_USER_ID.map(async (c) => ({ key: c, count: await d.collection(c).countDocuments(userIdMatch) })),
  ])
  return { items: items.map((i) => ({ ...i, label: LABELS[i.key] ?? i.key })), runIds }
}

export async function getDeletionSummary(id: string, adminId: string): Promise<DeletionSummary> {
  const user = await loadUser(id)
  const { items } = await counts(user._id)
  const handles = (await db().collection('instagramprofiles').find({ user: user._id }).project({ username: 1 }).toArray())
    .map((p) => String(p.username ?? ''))
    .filter(Boolean)
  const reason = blockedReason(user, adminId)
  return {
    id: String(user._id),
    name: String(user.name ?? ''),
    email: String(user.email ?? ''),
    handles,
    canDelete: !reason,
    blockedReason: reason,
    items: items.filter((i) => i.count > 0),
    mediaWillBeDeleted: Boolean(s3()),
  }
}

async function deleteMedia(uid: string): Promise<number> {
  const store = s3()
  if (!store) return -1
  let removed = 0
  for (const prefix of [`projects/${uid}/`, `reports/${uid}/`]) {
    let token: string | undefined
    do {
      const page = await store.client.send(new ListObjectsV2Command({
        Bucket: store.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }))
      const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k))
      if (keys.length) {
        const out = await store.client.send(new DeleteObjectsCommand({
          Bucket: store.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }))
        if (out.Errors?.length) throw new Error(`${out.Errors.length} files could not be deleted`)
        removed += keys.length
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  }
  return removed
}

export async function deleteCustomer(
  id: string,
  input: { adminId: string; adminEmail: string; confirmEmail: string },
): Promise<DeletionResult> {
  const user = await loadUser(id)
  const reason = blockedReason(user, input.adminId)
  if (reason) throw new DeletionError(403, reason)
  const email = String(user.email ?? '').trim().toLowerCase()
  if (!email || input.confirmEmail.trim().toLowerCase() !== email) {
    throw new DeletionError(400, 'Type the customer’s email exactly to confirm.')
  }

  const uid = user._id
  let mediaFilesDeleted = 0
  try {
    mediaFilesDeleted = await deleteMedia(String(uid))
  } catch (err) {
    throw new DeletionError(502, `Could not delete the customer’s media files, so nothing was deleted. ${(err as Error).message}`)
  }

  const d = db()
  const { runIds } = await counts(uid)
  const deleted: DeletionResult['deleted'] = []
  const note = (key: string, count: number) => { if (count) deleted.push({ key, label: LABELS[key] ?? key, count }) }

  if (runIds.length) note('planrunposts', (await d.collection('planrunposts').deleteMany({ run: { $in: runIds } })).deletedCount)
  for (const c of BY_USER) note(c, (await d.collection(c).deleteMany({ user: uid })).deletedCount)
  for (const c of BY_USER_ID) note(c, (await d.collection(c).deleteMany({ userId: { $in: [uid, String(uid)] } })).deletedCount)
  await d.collection('users').deleteOne({ _id: uid })

  console.log(
    `[backoffice] customer ${uid} <${email}> deleted by ${input.adminEmail}: ` +
      `${deleted.map((x) => `${x.key}=${x.count}`).join(' ') || 'no data'}` +
      (mediaFilesDeleted >= 0 ? ` · ${mediaFilesDeleted} media files` : ' · media kept (S3 not configured)'),
  )
  return { deleted, mediaFilesDeleted: Math.max(mediaFilesDeleted, 0), mediaSkipped: mediaFilesDeleted < 0 }
}
