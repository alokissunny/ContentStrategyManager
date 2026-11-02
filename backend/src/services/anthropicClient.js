const Anthropic = require('@anthropic-ai/sdk');
const { hardenClient } = require('../utils/limitFetch');

let client;

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to backend/.env to enable brand analysis.');
  }
  if (!client) {
    // ANTHROPIC_MAX_CONCURRENCY / ANTHROPIC_MAX_RETRIES (utils/limitFetch)
    client = hardenClient(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), 'anthropic');
  }
  return client;
}

module.exports = getAnthropicClient;
