import { Router } from 'express'
import { z } from 'zod'
import { getCustomerDetail, listCustomers, setCustomerCohort } from '../services/customers.ts'
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
