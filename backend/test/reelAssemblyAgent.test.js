const { test } = require('node:test');
const assert = require('node:assert/strict');
let transcriptionCalls = 0;
function stub(relativePath, exports) {
  const id = require.resolve(relativePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../src/services/openaiClient', () => ({ audio: { transcriptions: {
  create: async () => { transcriptionCalls += 1; return { words: [], segments: [], text: '' }; },
} } }));
stub('../src/services/llmComplete', {
  completeText: async () => { throw new Error('test: agent unavailable'); },
  splitPromptTemplate: (text) => ({ system: '', userTemplate: text }),
});
const { assemblyContext, assemblyInstructions, runReelEditor } = require('../src/services/reelEditorAgent');
const assembly = { transition: 'fade', clips: [
  { index: 0, kind: 'image', start: 0, end: 4, sourceStart: 0, sourceEnd: 4 },
  { index: 1, kind: 'image', start: 3.5, end: 7.5, sourceStart: 0, sourceEnd: 4 },
] };
test('assembly context preserves order and overlapping final-media timestamps', () => {
  assert.deepEqual(assemblyContext(assembly, 7.5), assembly);
  assert.equal(assemblyContext(null, 10), null);
  assert.equal(assemblyContext({ clips: [{ kind: 'image', start: -1, end: 5 }] }, 10), null);
  assert.match(assemblyInstructions(assembly), /Never reorder sources/);
  assert.match(assemblyInstructions(assembly), /Transitions are already rendered/);
});
test('photo montage skips transcription, keeps duration, and supplies assembly to agents even during fallback', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test';
  try {
    const result = await runReelEditor({ buffer: Buffer.from('photo montage'), contentType: 'video/mp4', assembly, durationSec: 7.5, guidance: 'A day at the coast. Golden hour memories.' });
    assert.equal(transcriptionCalls, 0);
    assert.equal(result.spec.meta.durationSec, 7.5);
    assert.equal(result.transcript.wordCount, 0);
    assert.equal(result.spec.captions.cues.length, 2);
    assert.ok(result.spec.captions.cues.every((cue) => cue.start >= 0 && cue.end <= 7.5));
    assert.ok(result.notes.some((note) => note.includes('not a spoken transcript')));
    for (const name of ['Reel director', 'Reel animations']) {
      const entry = result.debug.agents.find((agent) => agent.source === name);
      assert.match(entry.finalPrompt, /Assembled source timeline/);
      assert.match(entry.finalPrompt, /3.5/);
    }
    await runReelEditor({ buffer: Buffer.from('video montage'), contentType: 'video/mp4', assembly: { ...assembly, clips: [{ ...assembly.clips[0], kind: 'video' }] }, durationSec: 4 });
    assert.equal(transcriptionCalls, 1);
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('half-second image assembly retains its measured duration', async () => {
  const result = await runReelEditor({ durationSec: 0.5, guidance: 'Summer memories. A second sentence. A third sentence.', assembly: { transition: 'cut', clips: [{ index: 0, kind: 'image', start: 0, end: 0.5, sourceStart: 0, sourceEnd: 0.5 }] } });
  assert.equal(result.spec.meta.durationSec, 0.5);
  assert.ok(result.spec.captions.cues.every((cue) => cue.end <= 0.5 && cue.end > cue.start));
});
