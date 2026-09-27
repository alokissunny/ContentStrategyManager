const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCaptions, planDecorations } = require('../src/services/podcastDecoration');
const transcript = { words: [{ word: 'Never', start: 0, end: 0.4 }, { word: 'invent', start: 0.4, end: 0.8 }, { word: 'speech.', start: 0.8, end: 1.2 }, { word: 'Keep', start: 14, end: 14.4 }, { word: 'context.', start: 14.4, end: 15 }] };
test('captions preserve speech, clip duration, split silence and reject invalid timestamps', () => {
  assert.deepEqual(buildCaptions(transcript, 14.8), [{ start: 0, end: 1.2, text: 'Never invent speech.' }, { start: 14, end: 14.8, text: 'Keep context.' }]);
  assert.deepEqual(buildCaptions({ words: [{ word: 'bad', start: NaN, end: 3 }] }, 4), []);
  assert.equal(buildCaptions({ segments: [{ start: 0, end: 2, text: 'Exact segment words.' }] }, 2)[0].text, 'Exact segment words.');
});
test('three independent agents only select grounded quotes with valid indices', async () => {
  const responses = [{ emphasisIndices: [0, 999] }, { captionIndices: [0, 0, 999, 1] }, { approved: true, warnings: [] }];
  const stages = [];
  const result = await planDecorations({ transcript, durationSec: 20 }, { completeToolCall: async () => ({ parsed: responses.shift() }), onStage: s => stages.push(s) });
  assert.equal(stages.length, 3);
  assert.equal(result.agents.length, 3);
  assert.deepEqual(result.overlays.map(o => o.text), ['Never invent speech.', 'Keep context.']);
});
test('critic rejection and provider failure retain captions but remove overlays', async () => {
  const responses = [{ emphasisIndices: [0] }, { captionIndices: [0] }, { approved: false, warnings: ['Incomplete thought'] }];
  const rejected = await planDecorations({ transcript, durationSec: 20 }, { completeToolCall: async () => ({ parsed: responses.shift() }) });
  assert.equal(rejected.agents.at(-1).status, 'rejected');
  assert.equal(rejected.overlays.length, 0);
  assert.equal(rejected.captions.length, 2);
  const failed = await planDecorations({ transcript, durationSec: 20 }, { completeToolCall: async () => { throw new Error('Offline'); } });
  assert.equal(failed.captions.length, 2);
  assert.equal(failed.overlays.length, 0);
  assert.equal(failed.agents[0].status, 'fallback');
});
test('no speech skips editorial API calls', async () => {
  const result = await planDecorations({ transcript: {}, durationSec: 20 }, { completeToolCall: async () => assert.fail('No call expected') });
  assert.equal(result.captions.length, 0);
  assert.equal(result.agents.length, 0);
  assert.equal(result.warnings.length, 1);
});
