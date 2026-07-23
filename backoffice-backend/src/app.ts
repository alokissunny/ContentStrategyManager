import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import morgan from 'morgan'
import { env } from './config/env.ts'
import { requireAdmin } from './middleware/auth.ts'
import { authRoutes } from './routes/auth.ts'
import { competitorRoutes } from './routes/competitors.ts'
import { customerRoutes } from './routes/customers.ts'

/*
 * Internal tool, so the browser origin is restricted — but in development Vite
 * hops to the next free port (5190 → 5191 → …) whenever one is taken, and
 * pinning a single origin turns that into a confusing CORS failure. So:
 *
 *   development: any localhost / 127.0.0.1 origin, whatever the port
 *   production:  only the origins listed in CLIENT_URL (comma-separated)
 *
 * Auth is a bearer token, not a cookie, so a permissive dev origin doesn't
 * expose an authenticated session to another local app.
 */
function corsOrigin(): cors.CorsOptions['origin'] {
  const allowed = env.clientUrls
  const isProduction = process.env.NODE_ENV === 'production'

  return (origin, callback) => {
    // Non-browser callers (curl, server-to-server) send no Origin header.
    if (!origin) return callback(null, true)
    if (allowed.includes(origin)) return callback(null, true)
    if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true)
    }
    const error = new Error(`Origin ${origin} is not allowed by the backoffice CORS policy`)
    error.name = CORS_ERROR
    callback(error)
  }
}

const CORS_ERROR = 'CorsOriginError'

export function createApp() {
  const app = express()

  // JSON APIs + browser fetch: Express ETags yield 304 with an empty body, and
  // fetch treats 304 as !ok — which made customer detail (and the weekly plan)
  // silently fail on re-select. Prefer always returning a body.
  app.set('etag', false)

  app.use(cors({ origin: corsOrigin() }))
  app.use(express.json())
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

  app.use('/api/backoffice', authRoutes)
  // Everything past this point is admin-only.
  app.use('/api/backoffice', requireAdmin, competitorRoutes)
  app.use('/api/backoffice', requireAdmin, customerRoutes)

  app.use((_req, res) => res.status(404).json({ message: 'Not found' }))

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // A disallowed browser origin is a client error, not a server fault — don't
    // report it as a 500 or bury it in the error log as one.
    if (err.name === CORS_ERROR) {
      console.warn('[backoffice] blocked CORS origin:', err.message)
      return res.status(403).json({ message: err.message })
    }
    console.error('[backoffice]', err)
    res.status(500).json({ message: err.message || 'Server error' })
  })

  return app
}
