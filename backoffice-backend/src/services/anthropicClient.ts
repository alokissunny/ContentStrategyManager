import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.ts'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!env.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to backoffice-backend/.env to enable analysis.')
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.anthropic.apiKey })
  }
  return client
}
