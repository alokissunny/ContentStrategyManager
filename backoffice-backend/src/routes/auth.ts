import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { User, requireAdmin, signToken, type AuthedRequest } from '../middleware/auth.ts'
import { asyncHandler } from '../utils/asyncHandler.ts'

export const authRoutes = Router()

const credentials = z.object({ email: z.string().min(1), password: z.string().min(1) })

authRoutes.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ message: 'Email and password are required' })

    const user = await User.findOne({ email: parsed.data.email.toLowerCase() }).select('name email role password')
    // Same response for "no such user" and "wrong password" so the endpoint
    // can't be used to enumerate which internal emails exist.
    const invalid = { message: 'Invalid email or password' }
    if (!user?.password) return res.status(401).json(invalid)
    if (!(await bcrypt.compare(parsed.data.password, user.password))) return res.status(401).json(invalid)

    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'Backoffice access is limited to admin accounts.' })
    }

    res.json({
      token: signToken(String(user._id)),
      user: { id: String(user._id), name: user.name ?? '', email: user.email ?? '', role: 'admin' },
    })
  }),
)

authRoutes.get(
  '/auth/me',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ user: { ...req.admin, role: 'admin' } })
  }),
)
