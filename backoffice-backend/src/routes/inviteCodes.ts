import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import type { AuthedRequest } from '../middleware/auth.ts'
import {
  deleteInviteCode,
  generateInviteCodes,
  listInviteCodes,
  setInviteRevoked,
  updateInviteNote,
} from '../services/inviteCodes.ts'
import { asyncHandler } from '../utils/asyncHandler.ts'

export const inviteCodeRoutes = Router()

const validId = (id: string) => mongoose.isValidObjectId(id)

inviteCodeRoutes.get(
  '/invite-codes',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        status: z.enum(['all', 'unused', 'used', 'revoked']).optional(),
        search: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .safeParse(req.query)
    res.json(await listInviteCodes(q.success ? q.data : {}))
  }),
)

inviteCodeRoutes.post(
  '/invite-codes',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({ count: z.coerce.number().int().min(1).max(100).default(1), note: z.string().max(200).optional() })
      .safeParse(req.body ?? {})
    if (!body.success) return res.status(400).json({ message: 'Count must be between 1 and 100.' })
    const out = await generateInviteCodes({ ...body.data, createdBy: req.admin?.email })
    res.status(201).json(out)
  }),
)

inviteCodeRoutes.patch(
  '/invite-codes/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id)
    if (!validId(id)) return res.status(404).json({ message: 'Invitation code not found' })
    const body = z.object({ revoked: z.boolean().optional(), note: z.string().max(200).optional() }).safeParse(req.body ?? {})
    if (!body.success) return res.status(400).json({ message: 'Invalid update' })
    let row = null
    if (typeof body.data.note === 'string') row = await updateInviteNote(id, body.data.note)
    if (typeof body.data.revoked === 'boolean') {
      row = await setInviteRevoked(id, body.data.revoked)
      if (!row) return res.status(409).json({ message: 'A used code cannot be revoked or restored.' })
    }
    if (!row) return res.status(404).json({ message: 'Invitation code not found' })
    res.json(row)
  }),
)

inviteCodeRoutes.delete(
  '/invite-codes/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id)
    if (!validId(id) || !(await deleteInviteCode(id))) {
      return res.status(409).json({ message: 'Only an unused code can be deleted.' })
    }
    res.status(204).end()
  }),
)
