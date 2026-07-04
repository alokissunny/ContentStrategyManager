const Anthropic = require('@anthropic-ai/sdk');

let client;

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to backend/.env to enable brand analysis.');
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

module.exports = getAnthropicClient;
