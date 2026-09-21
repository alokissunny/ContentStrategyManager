const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { completeToolCall } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { transcribeWords } = require('./reelEditorAgent');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const execute = promisify(execFile);
const FPS = 30;
const OVERLAP = 11 / FPS;
const FORMATS = { 'video/mp4': 'mov', 'video/quicktime': 'mov', 'video/webm': 'matroska', 'image/jpeg': 'image2', 'image/png': 'image2', 'image/webp': 'image2' };
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
const text = (value, limit = 800) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = value => typeof value === 'number' && Number.isFinite(value);
const ceilFrame = value => Math.ceil(value * FPS - 0.000001) / FPS;
const floorFrame = value => Math.floor(value * FPS + 0.000001) / FPS;
const enumSchema = values => ({ type: 'string', enum: values });
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const TOOL = {
  name: 'plan_reel_mix', description: 'Choose a content-grounded base story, relevant timed cutaways and picture-in-picture, and explain omissions.',
  input_schema: objectSchema({
    sequence: { type: 'array', items: objectSchema({ assetIndex: { type: 'integer' }, startSec: { type: 'number' }, endSec: { type: 'number' }, durationSec: { type: 'number' } }) },
    transition: enumSchema(['none', 'fade', 'slide']),
    overlays: { type: 'array', items: objectSchema({ assetIndex: { type: 'integer' }, atSec: { type: 'number' }, durationSec: { type: 'number' }, startSec: { type: 'number' }, mode: enumSchema(['pip', 'cutaway']), position: enumSchema(['top-right', 'top-left', 'bottom-right', 'bottom-left']), transition: enumSchema(['none', 'fade']), reason: { type: 'string' } }) },
    summary: { type: 'string' },
    omitted: { type: 'array', items: objectSchema({ assetIndex: { type: 'integer' }, reason: { type: 'string' } }) },
  }),
};

// Validate the entire model plan before allowing any expensive rendering. Invalid
// plans fall back as a unit: dropping individual entries can change story timing.
function normalizeMixPlan(raw, assets) {
  if (!raw || !Array.isArray(raw.sequence) || !raw.sequence.length || raw.sequence.length > 12 || !Array.isArray(raw.overlays) || raw.overlays.length > 12 || !Array.isArray(raw.omitted) || !['none', 'fade', 'slide'].includes(raw.transition) || !text(raw.summary)) throw new Error('Mixer returned an invalid plan.');
  const reference = index => {
    if (!Number.isInteger(index) || index < 0 || index >= assets.length) throw new Error('Mixer referenced an unknown asset.');
    return assets[index];
  };
  const range = (entry, sequence) => {
    const asset = reference(entry.assetIndex);
    if (!number(entry.startSec) || !number(entry.durationSec) || entry.durationSec < 0.5) throw new Error('Mixer returned an invalid source duration.');
    const start = entry.startSec;
    const normalizedStart = asset.kind === 'image' ? 0 : ceilFrame(start);
    const normalizedEnd = floorFrame(start + entry.durationSec);
    const duration = Math.round((normalizedEnd - normalizedStart) * FPS) / FPS;
    if (duration < 0.5) throw new Error('Mixer source duration is too short after frame alignment.');
    const lower = asset.kind === 'image' ? 0 : asset.startSec;
    const upper = asset.kind === 'image' ? asset.durationSec : asset.endSec;
    if (start < lower - 0.000001 || start + entry.durationSec > upper + 0.000001 || (asset.kind === 'image' && start !== 0)) throw new Error('Mixer source range exceeds the selected trim.');
    if (sequence && (!number(entry.endSec) || Math.abs(entry.endSec - start - entry.durationSec) > 0.001)) throw new Error('Mixer returned inconsistent source times.');
    return { assetIndex: entry.assetIndex, startSec: normalizedStart, durationSec: duration, ...(sequence ? { endSec: normalizedEnd } : {}) };
  };
  const sequence = raw.sequence.map(entry => range(entry, true));
  const duration = sequence.reduce((sum, entry) => sum + entry.durationSec, 0) - (raw.transition === 'none' ? 0 : (sequence.length - 1) * OVERLAP);
  if (duration < 0.5 || duration > 180 + 0.000001) throw new Error('Mixer output exceeds the reel duration limit.');
  const overlays = raw.overlays.map(entry => {
    const source = range(entry, false);
    if (!number(entry.atSec) || entry.atSec < 0 || entry.atSec + entry.durationSec > duration + 0.000001 || !['pip', 'cutaway'].includes(entry.mode) || !['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(entry.position) || !['none', 'fade'].includes(entry.transition) || !text(entry.reason)) throw new Error('Mixer returned an invalid overlay.');
    return { ...source, atSec: floorFrame(entry.atSec), mode: entry.mode, position: entry.position, transition: entry.transition, reason: text(entry.reason) };
  }).sort((a, b) => a.atSec - b.atSec);
  for (let i = 1; i < overlays.length; i++) if (overlays[i].atSec < overlays[i - 1].atSec + overlays[i - 1].durationSec - 0.000001) throw new Error('Mixer overlays overlap.');
  // A photo may illustrate narration, but cannot accidentally replace all base
  // narration when the source set contains a video.
  if (assets.some(asset => asset.kind === 'video') && !sequence.some(entry => assets[entry.assetIndex].kind === 'video')) throw new Error('Mixer removed the narrative video.');
  const used = new Set([...sequence, ...overlays].map(entry => entry.assetIndex));
  const omittedIds = new Set();
  const omitted = raw.omitted.map(entry => {
    reference(entry.assetIndex);
    if (used.has(entry.assetIndex) || omittedIds.has(entry.assetIndex) || !text(entry.reason)) throw new Error('Mixer returned inconsistent omissions.');
    omittedIds.add(entry.assetIndex);
    return { assetIndex: entry.assetIndex, reason: text(entry.reason) };
  });
  if (used.size + omittedIds.size !== assets.length) throw new Error('Mixer did not explain all unused assets.');
  return { sequence, transition: raw.transition, overlays, summary: text(raw.summary, 1600), omitted };
}

async function inspectAssets(assets, { transcribe = transcribeWords } = {}) {
  if (!Array.isArray(assets) || !assets.length || assets.length > 12) throw invalid('Choose between 1 and 12 videos or photos.');
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-mixer-'));
  const run = args => execute(ffmpeg, ['-nostdin', '-hide_banner', '-y', '-threads', '1', '-filter_threads', '1', ...args], { timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  try {
    const inspected = [];
    for (const [assetIndex, asset] of assets.entries()) {
      if (!FORMATS[asset.contentType] || !['image', 'video'].includes(asset.kind) || !asset.contentType.startsWith(`${asset.kind}/`) || !Buffer.isBuffer(asset.buffer) || !asset.buffer.length) throw invalid(`Clip ${assetIndex + 1}: unsupported or empty media.`);
      const file = path.join(folder, `source-${assetIndex}`);
      await fs.writeFile(file, asset.buffer);
      const input = ['-protocol_whitelist', 'file,pipe', '-f', FORMATS[asset.contentType], '-i', file];
      let probe;
      try { probe = await run([...input, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']); } catch { throw invalid(`Clip ${assetIndex + 1}: this media could not be decoded.`); }
      const match = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const realDuration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
      const startSec = asset.kind === 'image' ? 0 : asset.startSec ?? 0;
      const endSec = asset.kind === 'image' ? asset.durationSec ?? 3 : asset.endSec ?? realDuration;
      if (!number(startSec) || !number(endSec) || startSec < 0 || endSec - startSec < 0.5 || endSec - startSec > 180 || (asset.kind === 'video' && (!realDuration || endSec > realDuration + 0.05)) || (asset.kind === 'image' && endSec > 10)) throw invalid(`Clip ${assetIndex + 1}: invalid duration or trim range.`);
      const boundedEnd = asset.kind === 'video' ? Math.min(endSec, realDuration) : endSec;
      const durationSec = floorFrame(boundedEnd - startSec);
      const frames = [];
      const sampleTimes = asset.kind === 'image' ? [0] : [0.1, 0.5, 0.9].map(ratio => startSec + durationSec * ratio);
      for (const [index, t] of sampleTimes.entries()) {
        const target = path.join(folder, `frame-${assetIndex}-${index}.jpg`);
        await run([...(asset.kind === 'video' ? ['-ss', String(t)] : []), ...input, '-frames:v', '1', '-vf', 'scale=512:512:force_original_aspect_ratio=decrease', '-q:v', '4', target]);
        frames.push({ t, data: (await fs.readFile(target)).toString('base64'), mediaType: 'image/jpeg' });
      }
      let transcript = { text: '', segments: [], words: [] };
      if (asset.kind === 'video' && /Stream #\d+:\d+.*Audio:/.test(probe.stderr)) {
        const audio = path.join(folder, `audio-${assetIndex}.mp4`);
        await run(['-ss', String(startSec), ...input, '-map', '0:a:0', '-vn', '-t', String(durationSec), '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audio]);
        transcript = await transcribe(await fs.readFile(audio), 'audio/mp4');
        // Whisper times refer to extracted audio; all prompt times use original source.
        transcript = { ...transcript, segments: (transcript.segments || []).map(s => ({ ...s, start: s.start + startSec, end: s.end + startSec })), words: (transcript.words || []).map(w => ({ ...w, start: w.start + startSec, end: w.end + startSec })) };
      }
      inspected.push({ assetIndex, kind: asset.kind, startSec, endSec: startSec + durationSec, durationSec, frames, transcript });
    }
    return inspected;
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

function fallbackPlan(assets) {
  const found = assets.findIndex(asset => asset.kind === 'video');
  const assetIndex = found < 0 ? 0 : found;
  const asset = assets[assetIndex];
  return { sequence: [{ assetIndex, startSec: asset.startSec, endSec: asset.endSec, durationSec: asset.durationSec }], transition: 'none', overlays: [], summary: 'Automatic editorial mixing was unavailable. Kept the first video (or first photo) unchanged; supporting media was not added without evaluating relevance.', omitted: assets.filter(a => a.assetIndex !== assetIndex).map(a => ({ assetIndex: a.assetIndex, reason: 'Not used because the mixer could not reliably evaluate its relevance and timing.' })) };
}

async function planReelMix({ assets, guidance = '' }, dependencies = {}) {
  const debug = []; const notes = [];
  const inspected = await (dependencies.inspectAssets || inspectAssets)(assets);
  for (const asset of inspected) if (asset.transcript?.note) notes.push(`Source ${asset.assetIndex + 1}: ${asset.transcript.note}`);
  const model = resolvePlanAgentLlm('reelMixer').model;
  const system = await fs.readFile(path.join(__dirname, '../../prompts/reel-mixer.md'), 'utf8');
  const metadata = inspected.map(({ frames, ...asset }) => asset);
  const user = `Creator guidance: ${text(guidance, 1600)}\nSources with original-source speech timestamps:\n${JSON.stringify(metadata)}`;
  const userParts = [{ type: 'text', text: user }];
  for (const asset of inspected) for (const frame of asset.frames) {
    userParts.push({ type: 'text', text: `Source assetIndex=${asset.assetIndex}, frame at original source ${frame.t.toFixed(3)} seconds:` });
    userParts.push({ type: 'image', mediaType: frame.mediaType, data: frame.data });
  }
  const startedAt = Date.now(); let plan; let usage = {}; let note = '';
  try {
    const done = await (dependencies.completeToolCall || completeToolCall)({ model, system, userParts, tool: TOOL, kind: 'reelMixer', timeoutMs: 120000, maxTokens: 4500, retryHint: 'Return a valid plan_reel_mix call with source ranges inside the supplied trims and non-overlapping overlays on the final base timeline.' });
    usage = done.usage || {};
    plan = normalizeMixPlan(done.parsed, inspected);
  } catch (error) {
    plan = fallbackPlan(inspected);
    note = `Mixer unavailable: ${error.message}`;
    notes.push(plan.summary);
  }
  const inputTokens = Number(usage.input_tokens) || 0; const outputTokens = Number(usage.output_tokens) || 0;
  debug.push({ source: 'Reel mixer', model, systemPrompt: system, finalPrompt: user + `\n[${userParts.filter(p => p.type === 'image').length} sampled source frames]`, output: JSON.stringify(plan), elapsedMs: Date.now() - startedAt, note, usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens, Number(usage.cached_tokens) || 0) } });
  return { plan, debug: { source: 'Reel mixer', agents: debug }, notes };
}

module.exports = { planReelMix, normalizeMixPlan, inspectAssets, fallbackPlan };
