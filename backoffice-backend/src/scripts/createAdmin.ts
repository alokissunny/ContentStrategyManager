/*
 * Provisions a backoffice admin in the shared `users` collection.
 *
 *   npm run create:admin -- --email you@example.com --name "Your Name"
 *
 * The password is read from a hidden prompt, never from argv — arguments land
 * in shell history and `ps` output, and this account can read every customer's
 * intelligence.
 *
 * On an email that already exists the script promotes it to admin rather than
 * inserting a duplicate (`email` is unique), and only touches the password if
 * you ask it to. Re-running it is therefore safe.
 *
 * This is the one place the backoffice writes to `users` — the customer API
 * owns that schema, so we mirror its shape by hand (bcrypt cost 10, lowercased
 * email, role enum, timestamps) instead of importing its CommonJS model.
 */
import readline from 'node:readline'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.ts'
import { User } from '../middleware/auth.ts'

const BCRYPT_ROUNDS = 10
/* The customer schema allows 6, but this account is cross-customer admin. */
const MIN_PASSWORD_LENGTH = 12

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

/*
 * One interface for the whole run: readline pauses stdin on close, so building a
 * fresh one per question can hang waiting on input that never resumes.
 *
 * Masking works by muting readline's echo *after* the question has been written
 * — muting first would swallow the prompt text too and look like a freeze. Echo
 * only exists in terminal mode, so piped stdin (tests, CI) needs no masking and
 * must not request terminal mode, which would block on a non-TTY.
 */
class Prompter {
  readonly #rl: readline.Interface
  readonly #lines: AsyncIterator<string>
  #muted = false

  constructor() {
    const isTty = process.stdin.isTTY === true
    this.#rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTty,
    })
    // Consume lines through the async iterator rather than question() callbacks:
    // it queues input that arrives early and reports EOF as `done` instead of
    // throwing "readline was closed" when piped stdin ends.
    this.#lines = this.#rl[Symbol.asyncIterator]()

    if (isTty) {
      const internal = this.#rl as unknown as { _writeToOutput: (s: string) => void }
      const write = internal._writeToOutput.bind(this.#rl)
      internal._writeToOutput = (s) => {
        if (!this.#muted) write(s)
      }
    }
  }

  async ask(question: string, { hidden = false } = {}): Promise<string> {
    // Write the label ourselves, then mute, so masking never eats the prompt.
    process.stdout.write(question)
    this.#muted = hidden
    try {
      const { value, done } = await this.#lines.next()
      if (done) throw new Error('Input ended before the prompt was answered')
      return String(value).trim()
    } finally {
      this.#muted = false
      if (hidden) process.stdout.write('\n')
    }
  }

  close(): void {
    this.#rl.close()
  }
}

async function main(prompt: Prompter) {
  const email = (arg('--email') ?? (await prompt.ask('Admin email: '))).toLowerCase()
  if (!email.includes('@')) throw new Error(`"${email}" is not an email address`)

  await connectDb()

  const existing = await User.findOne({ email }).select('name email role')
  if (existing) {
    console.log(`Found existing user "${existing.name ?? email}" (role: ${existing.role ?? 'user'}).`)
  }

  const name = existing?.name ?? arg('--name') ?? (await prompt.ask('Full name: '))
  if (!name) throw new Error('A name is required')

  // An existing admin may just need a role fix, not a new password.
  const setPassword =
    !existing ||
    (await prompt.ask('Set a new password for this account? [y/N] ')).toLowerCase() === 'y'

  let hash: string | undefined
  if (setPassword) {
    const password = await prompt.ask('Password (hidden): ', { hidden: true })
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    if ((await prompt.ask('Confirm password (hidden): ', { hidden: true })) !== password) {
      throw new Error('Passwords did not match')
    }
    hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  }

  const now = new Date()
  await User.updateOne(
    { email },
    {
      $set: {
        name,
        role: 'admin',
        ...(hash ? { password: hash } : {}),
        updatedAt: now,
      },
      $setOnInsert: { email, authProvider: 'local', createdAt: now },
    },
    { upsert: true },
  )

  const saved = await User.findOne({ email }).select('name email role')
  console.log(
    `\n${existing ? 'Updated' : 'Created'} backoffice admin:\n` +
      `  name:  ${saved?.name}\n` +
      `  email: ${saved?.email}\n` +
      `  role:  ${saved?.role}\n` +
      `  db:    ${mongoose.connection.db?.databaseName}\n` +
      `\nSign in at the backoffice UI — only the bcrypt hash is stored, never the password.`,
  )
}

const prompt = new Prompter()
main(prompt)
  .catch((err) => {
    console.error(`\n[create:admin] ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  })
  .finally(async () => {
    // Leaving either open keeps the event loop alive and the script never exits.
    prompt.close()
    await disconnectDb()
  })
