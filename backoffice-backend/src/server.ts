import { createApp } from './app.ts'
import { connectDb } from './config/db.ts'
import { env } from './config/env.ts'
import { ensureCustomerCohortIndexes } from './utils/ensureCustomerCohortIndexes.ts'

async function start() {
  await connectDb()
  await ensureCustomerCohortIndexes()
  createApp().listen(env.port, () => {
    console.log(`[backoffice] API listening on http://localhost:${env.port}`)
  })
}

start().catch((err) => {
  console.error('[backoffice] failed to start:', err)
  process.exit(1)
})
