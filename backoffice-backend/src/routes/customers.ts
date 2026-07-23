import { Router } from 'express'
import { z } from 'zod'
import { getCustomerDetail, listCustomers } from '../services/customers.ts'
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
      })
      .safeParse(req.query)

    const result = await listCustomers(q.success ? q.data : {})
    res.json(result)
  }),
)

customerRoutes.get(
  '/customers/:id',
  asyncHandler(async (req, res) => {
    const detail = await getCustomerDetail(String(req.params.id))
    if (!detail) return res.status(404).json({ message: 'Customer not found' })
    res.json(detail)
  }),
)
