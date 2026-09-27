const test = require('node:test');
const assert = require('node:assert/strict');
const clientPath = require.resolve('../src/services/openaiClient');
let failure;
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: () => ({ audio: { transcriptions: { create: async () => { throw failure; } } } }) };
const { transcribeWords } = require('../src/services/reelEditorAgent');
test('speech failures expose safe actionable reasons, including quota and connection errors', async () => {
  const savedKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.match((await transcribeWords(Buffer.from('audio'), 'audio/mp4')).failureReason, /not configured/);
    process.env.OPENAI_API_KEY = 'test-only';
    for (const [error, pattern] of [[{ status: 401 }, /API key/], [{ status: 429, code: 'insufficient_quota' }, /quota/], [{ status: 429 }, /rate limited/], [{ status: 400 }, /audio or transcription settings/], [{ name: 'APIConnectionError' }, /connect/]]) {
      failure = Object.assign(new Error('Private provider detail'), error);
      const result = await transcribeWords(Buffer.from('audio'), 'audio/mp4');
      assert.match(result.failureReason, pattern);
      assert.doesNotMatch(result.failureReason, /Private provider detail/);
      assert.deepEqual(result.segments, []);
    }
  } finally { if (savedKey == null) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});
