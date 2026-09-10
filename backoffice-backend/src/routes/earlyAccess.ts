import { Router } from 'express'
import { z } from 'zod'
import { listEarlyAccessRequests } from '../services/earlyAccess.ts'
import { asyncHandler } from '../utils/asyncHandler.ts'

export const earlyAccessRoutes = Router()

earlyAccessRoutes.get(
  '/early-access',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        search: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .safeParse(req.query)

    const data = q.success ? q.data : {}
    res.json(await listEarlyAccessRequests(data))
  }),
)
