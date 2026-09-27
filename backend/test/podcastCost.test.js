const test = require('node:test');
const assert = require('node:assert/strict');
const { agentCost, transcriptionCost, podcastDebug } = require('../src/services/podcastCost');
test('podcast total combines cached token estimates and transcription, with stable IDs', () => {
  const speech = transcriptionCost({ model: 'whisper-1', seconds: 90, elapsedMs: 20 });
  assert.equal(speech.usage.estimatedCostUsd, .009);
  const llm = agentCost({ name: 'Caption editor', model: 'gpt-5.6-terra', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 100 }, elapsedMs: 10 });
  assert.equal(llm.usage.totalTokens, 1200);
  const job = { id: 'job-1', status: 'completed', costEntries: [speech, llm] };
  const entries = podcastDebug(job).agents;
  assert.equal(entries.length, 3);
  assert.ok(Math.abs(entries[2].usage.estimatedCostUsd - (.009 + llm.usage.estimatedCostUsd)) < .000001);
  assert.equal(entries[2].elapsedMs, 30);
  assert.deepEqual(podcastDebug(job).agents, entries);
  assert.match(entries[2].note, /excludes.*rendering, storage and transfer/);
});
test('missing usage and unsuccessful or unknown-model transcription stay explicitly unknown', () => {
  const entries = [agentCost({name:'Failed',model:'test'}), transcriptionCost({model:'whisper-1',seconds:30,failed:true}), transcriptionCost({model:'unpriced',seconds:30})];
  assert.ok(entries.every(e => e.costUnknown));
  const summary = podcastDebug({id:'partial',status:'failed',costEntries:entries}).agents.at(-1);
  assert.match(summary.note, /3 call\(s\) have unavailable costs/);
});
