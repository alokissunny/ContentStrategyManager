const { test } = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeMixPlan, planReelMix, inspectAssets } = require('../src/services/reelMixerAgent');
const sources = [
  { assetIndex: 0, kind: 'video', startSec: 5, endSec: 25, durationSec: 20, frames: [{ t: 10, data: 'face-image', mediaType: 'image/jpeg' }], transcript: { text: 'The walnut grain is beautiful.', segments: [{ start: 12, end: 16, text: 'The walnut grain is beautiful.' }] } },
  { assetIndex: 1, kind: 'image', startSec: 0, endSec: 4, durationSec: 4, frames: [{ t: 0, data: 'walnut-image', mediaType: 'image/jpeg' }], transcript: { text: '', segments: [] } },
  { assetIndex: 2, kind: 'video', startSec: 2, endSec: 8, durationSec: 6, frames: [{ t: 3, data: 'irrelevant-image', mediaType: 'image/jpeg' }], transcript: { text: '', segments: [] } },
];
const valid = () => ({ sequence: [{ assetIndex: 0, startSec: 5, endSec: 25, durationSec: 20 }], transition: 'none', overlays: [{ assetIndex: 1, startSec: 0, atSec: 7, durationSec: 4, mode: 'pip', position: 'top-right', transition: 'fade', reason: 'Show the walnut detail at the spoken walnut grain sentence (source 12s, reel 7s), keeping the speaker visible.' }], summary: 'Keep the explanation flowing; show walnut grain when discussed.', omitted: [{ assetIndex: 2, reason: 'Unrelated scene does not illustrate the furniture story.' }] });

test('mixer uses actual sampled images and absolute transcripts to request contextual PiP, not concatenation', async () => {
  const result = await planReelMix({ assets: [], guidance: 'Explain the wood' }, {
    inspectAssets: async () => sources,
    completeToolCall: async options => {
      assert.equal(options.kind, 'reelMixer');
      assert.equal(options.timeoutMs, 120000);
      assert.match(options.userParts[0].text, /walnut grain/);
      assert.match(options.userParts[0].text, /"start":12/);
      assert.deepEqual(options.userParts.filter(p => p.type === 'image').map(p => p.data), ['face-image', 'walnut-image', 'irrelevant-image']);
      return { parsed: valid(), usage: { input_tokens: 20, output_tokens: 10 } };
    },
  });
  assert.equal(result.plan.sequence.length, 1);
  assert.equal(result.plan.overlays[0].atSec, 7);
  assert.match(result.plan.overlays[0].reason, /walnut/);
  assert.equal(result.plan.omitted[0].assetIndex, 2);
  assert.equal(result.debug.agents[0].usage.totalTokens, 30);
});

test('invalid schema or unavailable provider conservatively retains first video with honest omissions', async () => {
  for (const provider of [async () => { throw new Error('offline'); }, async () => ({ parsed: { ...valid(), sequence: [] } })]) {
    const { plan, notes } = await planReelMix({ assets: [] }, { inspectAssets: async () => sources, completeToolCall: provider });
    assert.equal(plan.sequence.length, 1);
    assert.equal(plan.sequence[0].startSec, 5);
    assert.equal(plan.sequence[0].endSec, 25);
    assert.deepEqual(plan.overlays, []);
    assert.deepEqual(plan.omitted.map(a => a.assetIndex), [1, 2]);
    assert.match(notes.join(' '), /unavailable/);
  }
});

test('photos-only fallback uses one photo, never pretends to establish a story', async () => {
  const images = [0, 1].map(assetIndex => ({ ...sources[1], assetIndex }));
  const { plan } = await planReelMix({ assets: [] }, { inspectAssets: async () => images, completeToolCall: async () => { throw new Error('offline'); } });
  assert.equal(plan.sequence.length, 1);
  assert.equal(plan.omitted.length, 1);
});

test('rejects untrusted references, trim overflow, inconsistent durations, invalid enums and overlapping overlays', () => {
  const cases = [
    p => { p.sequence[0].assetIndex = 8; },
    p => { p.sequence[0].startSec = 4; p.sequence[0].endSec = 24; },
    p => { p.sequence[0].endSec = 24; },
    p => { p.overlays[0].durationSec = 5; },
    p => { p.overlays[0].atSec = 18; },
    p => { p.overlays[0].mode = 'unknown'; },
    p => { p.overlays[0].position = 'center'; },
    p => { p.overlays[0].transition = 'slide'; },
    p => { p.overlays[0].atSec = NaN; },
    p => { p.overlays.push({ ...p.overlays[0], atSec: 8 }); },
    p => { p.omitted = []; },
    p => { p.omitted.push({ assetIndex: 0, reason: 'contradiction' }); },
    p => { p.transition = 'wipe'; },
    p => { p.sequence = Array.from({ length: 13 }, () => ({ ...p.sequence[0] })); },
    p => { p.overlays = Array.from({ length: 13 }, () => ({ ...p.overlays[0] })); },
    p => { p.overlays[0].startSec = 0.1; p.overlays[0].durationSec = 3; },
  ];
  for (const mutate of cases) { const plan = valid(); mutate(plan); assert.throws(() => normalizeMixPlan(plan, sources)); }
});

test('accounts for frame-exact base transition overlap when bounding overlay timing', () => {
  const plan = valid();
  plan.sequence.push({ assetIndex: 2, startSec: 2, endSec: 8, durationSec: 6 });
  plan.omitted = [];
  plan.transition = 'fade';
  plan.overlays[0].atSec = 22;
  assert.throws(() => normalizeMixPlan(plan, sources), /overlay/);
  plan.overlays[0].atSec = 21;
  assert.equal(normalizeMixPlan(plan, sources).overlays[0].atSec, 21);
});

test('inspects real trimmed media and shifts extracted speech timestamps back to source time', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'mixer-test-'));
  const ffmpeg = require('ffmpeg-static');
  const run = promisify(execFile);
  try {
    const file = path.join(folder, 'source.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=red:s=160x120:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-threads', '1', file]);
    const assets = [{ kind: 'video', contentType: 'video/mp4', buffer: await fs.readFile(file), startSec: 1, endSec: 2.5 }];
    let calls = 0;
    const output = await inspectAssets(assets, { transcribe: async (buffer, type) => {
      calls++;
      assert.equal(type, 'audio/mp4');
      assert.ok(buffer.length < 25000000);
      return { text: 'hello', segments: [{ start: 0.2, end: 0.8, text: 'hello' }], words: [{ start: 0.2, end: 0.8, text: 'hello' }] };
    } });
    assert.equal(calls, 1);
    assert.equal(output[0].frames.length, 3);
    assert.ok(output[0].frames.every(frame => frame.t >= 1 && frame.t < 2.5 && frame.data.length > 100));
    assert.equal(output[0].transcript.segments[0].start, 1.2);
    assert.equal(output[0].transcript.words[0].end, 1.8);
    await assert.rejects(inspectAssets([{ ...assets[0], endSec: 50 }]), /invalid duration/);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('aligns video trims inward to renderer frames without changing photo source offsets', () => {
  const plan = valid();
  plan.sequence[0] = { assetIndex: 0, startSec: 5.01, endSec: 24.99, durationSec: 19.98 };
  const result = normalizeMixPlan(plan, sources);
  assert.equal(result.sequence[0].startSec, 151 / 30);
  assert.equal(result.sequence[0].endSec, 749 / 30);
  assert.equal(result.sequence[0].durationSec, 598 / 30);
  assert.equal(result.overlays[0].startSec, 0);
});
