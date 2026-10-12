import { Router } from 'express'
import { z } from 'zod'
import { getCustomerDetail, listCustomers, setCustomerCohort } from '../services/customers.ts'
import type { AuthedRequest } from '../middleware/auth.ts'
import { getCustomerActivity } from '../services/customerActivity.ts'
import { DeletionError, deleteCustomer, getDeletionSummary } from '../services/customerDeletion.ts'
import { getEditPreview, getPostPreview } from '../services/postPreview.ts'
import { asyncHandler } from '../utils/asyncHandler.ts'

export const customerRoutes = Router()

customerRoutes.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
        includeAdmins: z.enum(['1', 'true']).optional(),
      })
      .safeParse(req.query)

    const data = q.success ? q.data : {}
    const result = await listCustomers({
      ...data,
      includeAdmins: Boolean(data.includeAdmins),
    })
    res.json(result)
  }),
)

customerRoutes.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const includeAdmins = req.query.includeAdmins === '1' || req.query.includeAdmins === 'true'
    const detail = await getCustomerDetail(String(req.params.id), { includeAdmins })
    if (!detail) return res.status(404).json({ message: 'Customer not found' })
    res.json(detail)
  }),
)

/** How the customer uses Bauhly: captures, generated posts, edit log (per handle). */
customerRoutes.get(
  '/customers/:id/activity',
  asyncHandler(async (req, res) => {
    const includeAdmins = req.query.includeAdmins === '1' || req.query.includeAdmins === 'true'
    const handle = typeof req.query.handle === 'string' ? req.query.handle : null
    const activity = await getCustomerActivity(String(req.params.id), { handle, includeAdmins })
    if (!activity) return res.status(404).json({ message: 'Customer not found' })
    res.json(activity)
  }),
)

/** One generated post's carousel document, photos resolved, for the preview. */
customerRoutes.get(
  '/customers/:id/posts/:postId/preview',
  asyncHandler(async (req, res) => {
    const includeAdmins = req.query.includeAdmins === '1' || req.query.includeAdmins === 'true'
    const preview = await getPostPreview(String(req.params.id), String(req.params.postId), { includeAdmins })
    if (!preview) return res.status(404).json({ message: 'Post not found' })
    res.json(preview)
  }),
)

/** One edit-log entry's carousel document before and after, for slide previews. */
customerRoutes.get(
  '/customers/:id/edits/:editId/preview',
  asyncHandler(async (req, res) => {
    const includeAdmins = req.query.includeAdmins === '1' || req.query.includeAdmins === 'true'
    const preview = await getEditPreview(String(req.params.id), String(req.params.editId), { includeAdmins })
    if (!preview) return res.status(404).json({ message: 'No preview stored for this edit' })
    res.json(preview)
  }),
)

/** What deleting this customer would remove (shown in the confirmation). */
customerRoutes.get(
  '/customers/:id/deletion',
  asyncHandler(async (req: AuthedRequest, res) => {
    try {
      res.json(await getDeletionSummary(String(req.params.id), req.admin?.id ?? ''))
    } catch (err) {
      if (err instanceof DeletionError) return res.status(err.status).json({ message: err.message })
      throw err
    }
  }),
)

/** Permanently delete a customer account and all of its data. Body: { confirmEmail }. */
customerRoutes.delete(
  '/customers/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z.object({ confirmEmail: z.string().trim().min(1) }).safeParse(req.body)
    if (!body.success) return res.status(400).json({ message: 'Type the customer’s email to confirm.' })
    try {
      res.json(await deleteCustomer(String(req.params.id), {
        adminId: req.admin?.id ?? '',
        adminEmail: req.admin?.email ?? '',
        confirmEmail: body.data.confirmEmail,
      }))
    } catch (err) {
      if (err instanceof DeletionError) return res.status(err.status).json({ message: err.message })
      throw err
    }
  }),
)

/** Assign a competitor cohort (Business Type + Location) to one Instagram handle. */
customerRoutes.patch(
  '/customers/:id/cohort',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        businessCategory: z.enum(['interior-designer', 'bauhly-competitor', 'other']),
        location: z.string().trim().min(1),
        instagramUsername: z.string().trim().min(1),
      })
      .safeParse(req.body)
    if (!body.success) {
      return res.status(400).json({
        message: 'Business type, location, and Instagram username are required.',
      })
    }

    const includeAdmins = req.query.includeAdmins === '1' || req.query.includeAdmins === 'true'
    const cohort = await setCustomerCohort(String(req.params.id), body.data, { includeAdmins })
    if (!cohort) {
      return res.status(404).json({
        message: 'Customer or Instagram account not found',
      })
    }
    res.json(cohort)
  }),
)
