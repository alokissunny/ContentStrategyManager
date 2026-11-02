const OpenAI = require('openai');
const { hardenClient } = require('../utils/limitFetch');

let client;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to backend/.env to enable OpenAI competitor discovery.');
  }
  if (!client) {
    // OPENAI_MAX_CONCURRENCY / OPENAI_MAX_RETRIES (utils/limitFetch)
    client = hardenClient(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), 'openai');
  }
  return client;
}

module.exports = getOpenAIClient;
