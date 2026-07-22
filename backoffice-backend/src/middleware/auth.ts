import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { env } from '../config/env.ts'

/*
 * Internal-only auth. This tool holds cross-customer intelligence, so every
 * route requires a valid token AND role === 'admin'.
 *
 * Users live in the shared database (same collection the customer API uses), so
 * there is no separate account store to keep in sync — we just refuse anyone
 * who isn't an admin.
 */

// Minimal read-only view of the shared `users` collection; the customer API
// owns the real schema, so we deliberately don't redefine or write to it.
const userSchema = new mongoose.Schema(
  { name: String, email: String, password: String, role: String },
  { collection: 'users', strict: false },
)
export const User = (mongoose.models.BackofficeUser ??
  mongoose.model('BackofficeUser', userSchema)) as mongoose.Model<{
  _id: mongoose.Types.ObjectId
  name?: string
  email?: string
  password?: string
  role?: string
}>

export interface AuthedRequest extends Request {
  admin?: { id: string; name: string; email: string }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret(), {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Not authorised' })

  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(token, env.jwtSecret()) as jwt.JwtPayload
  } catch {
    return res.status(401).json({ message: 'Session expired. Sign in again.' })
  }

  const user = await User.findById(payload.sub).select('name email role')
  if (!user) return res.status(401).json({ message: 'Not authorised' })
  if (user.role !== 'admin') {
    return res.status(403).json({ message: 'Backoffice access is limited to admin accounts.' })
  }

  req.admin = { id: String(user._id), name: user.name ?? '', email: user.email ?? '' }
  next()
}
