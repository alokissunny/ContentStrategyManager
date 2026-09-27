// Bounded single-process job runner. Deployments with multiple API instances must
// use sticky routing; jobs deliberately expire and do not pretend to be durable.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { validateInput, normalizePlan, planPodcast } = require('./podcastPlan');
const { probePodcast, renderPodcast } = require('./podcastRender');
const s3 = require('./s3Client');
const { agentCost, transcriptionCost, podcastDebug } = require('./podcastCost');
const execute = promisify(execFile);
const jobs = new Map(); let active = 0;
const TTL = 2 * 60 * 60 * 1000;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
function check(job) { if (job.abort.signal.aborted) throw fail('Podcast generation cancelled.', 409); }
async function download(key, target, maxBytes, signal) {
  const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', responseChecksumValidation: 'WHEN_REQUIRED' });
  let handle; let body;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }), { abortSignal: signal });
    body = response.Body;
    if (response.ContentLength > maxBytes) throw fail('Source exceeds the file size limit.');
    handle = await fs.open(target, 'w'); let bytes = 0;
    for await (const chunk of body) { if (signal.aborted) throw fail('Cancelled.'); bytes += chunk.length; if (bytes > maxBytes) throw fail('Source exceeds the file size limit.'); await handle.write(chunk); }
    return bytes;
  } finally { body?.destroy?.(); await handle?.close(); client.destroy(); }
}
function visible(job) {
  return { debug: podcastDebug(job), jobId: job.id, status: job.status, stage: job.stage, progress: job.progress, plan: job.plan, result: job.result, error: job.error, alignment: job.alignment, syncOnly: job.input.syncOnly, warnings: job.warnings, agents: job.agents, expiresAt: new Date(job.createdAt + TTL).toISOString() };
}
function get(id, owner) { const j = jobs.get(id); if (!j || j.owner !== String(owner)) throw fail('Podcast job not found or expired.', 404); return j; }
async function clean(job) { if (job.folder) await fs.rm(job.folder, { recursive: true, force: true }); job.folder = null; }
async function run(job, work) {
  active += 1;
  try { check(job); await work(); check(job); }
  catch (e) { job.status = job.abort.signal.aborted ? 'cancelled' : 'failed'; job.stage = job.status; job.error = job.status === 'cancelled' ? undefined : (e.statusCode === 400 ? e.message : 'Podcast processing failed. Check the recordings and try again.'); console.warn('[podcast]', e.message); await clean(job); }
  finally { active -= 1; job.running = false; }
}
async function analyze(job) {
  job.status = 'analyzing'; job.stage = 'Inspecting source recordings';
  job.folder = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast-job-'));
  let total = 0;
  for (const [i, asset] of job.input.assets.entries()) {
    check(job); asset.path = path.join(job.folder, `source-${i}.${asset.key.split('.').pop()}`);
    total += await download(asset.key, asset.path, Math.min(250 * 1024 ** 2, 750 * 1024 ** 2 - total), job.abort.signal);
    const probe = await probePodcast(asset.path, job.abort.signal);
    if (probe.durationSec > 1200 || probe.durationSec <= 0) throw fail('Each recording must be no longer than 20 minutes.');
    asset.endSec ??= probe.durationSec;
    if (asset.endSec > probe.durationSec + 0.05 || asset.endSec - asset.startSec < 0.5) throw fail('A trim lies outside the actual recording.');
    asset.endSec = Math.min(asset.endSec, probe.durationSec); Object.assign(asset, probe);
    asset.transcript = { segments: [], text: '' };
    job.progress = Math.round((i + 1) / job.input.assets.length * 20);
  }
  if (job.input.autoSync || job.input.syncOnly) {
    job.stage = 'Matching secondary audio to primary audio';
    job.alignment = await require('./podcastSync').alignPodcastAudio(job.input.assets, job.input.primaryAudioSource, job.abort.signal);
    check(job);
    if (job.alignment.status === 'aligned') {
      for (const start of job.alignment.starts) job.input.assets.find(a => a.id === start.id).startSec = start.startSec;
      job.agents.push({ name: 'Audio synchronization', status: 'completed' });
    }
    if (job.input.syncOnly) {
      job.status = 'aligned'; job.stage = job.alignment.status === 'aligned' ? 'Audio alignment ready' : 'Manual alignment needed'; job.progress = 100;
      await clean(job); return;
    }
    if (job.alignment.status !== 'aligned') throw fail(`${job.alignment.reason} Adjust the start times and turn off automatic lip sync to generate manually.`);
  }
  for (const [i, asset] of job.input.assets.entries()) {
    check(job);
    if (!job.input.edits && asset.hasAudio && (job.input.workflow !== 'simple' || asset.role === job.input.primaryAudioSource)) {
      job.stage = `Transcribing ${asset.name}`;
      const audio = path.join(job.folder, `speech-${i}.m4a`);
      await execute(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-nostdin', '-hide_banner', '-y', '-protocol_whitelist', 'file,pipe', '-ss', String(asset.startSec), '-i', asset.path, '-t', String(asset.endSec - asset.startSec), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audio], { signal: job.abort.signal, timeout: 180000, maxBuffer: 1024 ** 2 });
      check(job);
      const speechStarted = Date.now();
      const transcript = await require('./reelEditorAgent').transcribeWords(await fs.readFile(audio), 'audio/mp4');
      job.costEntries.push(transcriptionCost({ model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1', seconds: asset.endSec - asset.startSec, elapsedMs: Date.now() - speechStarted, failed: Boolean(transcript.note) }));
      check(job);
      asset.transcript = { text: transcript.text, words: (transcript.words || []).map(w => ({ ...w, start: w.start + asset.startSec, end: w.end + asset.startSec })), segments: (transcript.segments || []).map(s => ({ ...s, start: s.start + asset.startSec, end: s.end + asset.startSec })) };
      if (transcript.note) job.warnings.push(`${asset.name}: ${transcript.failureReason || 'Speech analysis failed. Check the server transcription log, then retry the episode plan.'}`);
      else if (!asset.transcript.segments.length) job.warnings.push(`${asset.name}: no timestamped speech was detected. Check that the recording contains audible voices.`);
      await fs.rm(audio, { force: true });
    } else if (job.input.mode === 'segments') job.warnings.push(`${asset.name} has no audio; separate-segment output will contain silence for this source.`);
    job.progress = Math.round((i + 1) / job.input.assets.length * 40);
  }
  if (job.input.workflow === 'simple') {
    const primary = job.input.assets.find(a => a.role === job.input.primaryAudioSource);
    if (!primary.hasAudio) throw fail('The selected primary audio recording has no audio. Choose the other source.');
    const durationSec = Math.min(...job.input.assets.map(a => a.endSec - a.startSec));
    for (const asset of job.input.assets) asset.endSec = asset.startSec + durationSec;
    const transcript = { text: primary.transcript.text, words: (primary.transcript.words || []).map(w => ({ ...w, start: w.start - primary.startSec, end: w.end - primary.startSec })), segments: primary.transcript.segments.map(s => ({ ...s, start: s.start - primary.startSec, end: s.end - primary.startSec })) };
    const decoration = job.input.edits ? { ...require('./podcastEdits').validatePodcastEdits(job.input.edits, durationSec), agents: [{ name: 'Saved podcast edits', status: 'completed' }], warnings: [] } : await require('./podcastDecoration').planDecorations({ transcript, durationSec, guidance: job.input.guidance, brand: job.input.brand }, { onStage: name => { check(job); job.stage = name; }, onUsage: usage => job.costEntries.push(agentCost(usage)) });
    check(job);
    const host = job.input.assets[0];
    job.plan = { title: job.input.edits?.title || 'Podcast', summary: `Host left, guest right. ${job.alignment?.status === 'aligned' ? 'Start times matched using the shared audio.' : 'Both start at your selected times.'} Only the selected primary audio is used.`, durationSec, segments: [{ id: 'episode', assetId: host.id, sourceStart: host.startSec, sourceEnd: host.endSec, start: 0, end: durationSec, speaker: host.name, reason: 'Continuous side-by-side conversation.' }], captions: decoration.captions, overlays: decoration.overlays, warnings: [...job.warnings, ...decoration.warnings] };
    job.agents.push(...decoration.agents); job.warnings = job.plan.warnings;
    job.status = 'review'; job.stage = 'Preparing final render'; job.progress = 50;
    return;
  }
  if (job.input.mode === 'conversation' && !job.input.assets[0].hasAudio) throw fail('The first uploaded file must contain audio for both host and guest.');
  job.stage = 'Transcript editor → episode director → continuity critic';
  const planned = await planPodcast(job.input, { onStage: name => { check(job); job.stage = name; }, onUsage: usage => job.costEntries.push(agentCost(usage)) }); check(job);
  job.plan = planned.plan; job.agents = planned.agents;
  job.warnings.push(...planned.plan.warnings); job.plan.warnings = [...job.warnings];
  job.status = 'review'; job.stage = 'Ready for editorial review'; job.progress = 50;
}
function create(body, owner) {
  const input = validateInput(body, owner);
  if (!s3.isS3Configured()) throw fail('Media storage is not configured.', 503);
  if (active >= 2 || [...jobs.values()].filter(j => ['queued', 'analyzing', 'review', 'rendering'].includes(j.status)).length >= 8 || [...jobs.values()].filter(j => j.owner === String(owner) && ['queued', 'analyzing', 'review', 'rendering'].includes(j.status)).length >= 2) throw fail('Podcast workers are busy. Complete or cancel an existing job, then try again.', 429);
  const job = { id: crypto.randomUUID(), owner: String(owner), input, status: 'queued', stage: 'Queued', progress: 0, createdAt: Date.now(), abort: new AbortController(), agents: [], warnings: [], costEntries: [], running: true };
  jobs.set(job.id, job); void run(job, () => analyze(job)); return visible(job);
}
function render(id, owner, body = {}) {
  const job = get(id, owner);
  if (job.status !== 'review') throw fail('This episode is not ready to render.', 409);
  if (active >= 2) throw fail('Podcast renderer is busy. Try again shortly.', 429);
  const plan = { ...normalizePlan(job.input.workflow === 'simple' ? job.plan : body.plan || job.plan, job.input.assets, job.input.mode), captions: job.plan.captions || [], overlays: job.plan.overlays || [] };
  const layout = body.layout || job.input.layout;
  if (!['side-by-side', 'camera-cuts'].includes(layout)) throw fail('Choose a valid podcast layout.');
  job.input.layout = layout;
  const brandingKey = body.brandingKey;
  if (brandingKey != null && (typeof brandingKey !== 'string' || !/^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.png$/i.test(brandingKey) || !brandingKey.startsWith(`projects/${owner}/`))) throw fail('Branding must be an uploaded PNG belonging to this account.');
  if (job.input.brand && !brandingKey) job.warnings.push('This export does not include Brand Kit visuals.');
  job.plan = plan; job.status = 'rendering'; job.stage = 'Audio finishing and video assembly'; job.running = true;
  void run(job, async () => {
    let brandingPath;
    if (brandingKey) { brandingPath = path.join(job.folder, 'branding.png'); await download(brandingKey, brandingPath, 10 * 1024 ** 2, job.abort.signal); }
    const master = job.input.workflow === 'simple' ? job.input.assets.find(a => a.role === job.input.primaryAudioSource) : job.input.assets[0];
    const output = await renderPodcast({ assets: job.input.assets, plan, simple: job.input.workflow === 'simple', layout: job.input.workflow === 'simple' ? 'side-by-side' : job.input.layout, mode: job.input.mode, masterAssetId: master.id, masterStartSec: master.startSec, aspectRatio: job.input.aspectRatio, cleanAudio: job.input.cleanAudio, brandingPath, signal: job.abort.signal, onProgress: progress => { job.progress = 50 + Math.round(Math.min(100, Math.max(0, progress)) * 0.45); } });
    check(job); job.stage = 'Uploading finished MP4'; job.progress = 96;
    const key = `projects/${owner}/${crypto.randomUUID()}-podcast.mp4`;
    try {
      await s3.uploadBytes(key, output.buffer, 'video/mp4'); check(job);
      job.result = { key, url: await s3.getPresignedDownloadUrl(key), durationSec: output.durationSec, contentType: 'video/mp4' }; check(job);
    } catch (error) { await s3.deleteObjects([key]); throw error; }
    job.agents.push({ name: 'Audio engineer', status: 'completed' }, { name: 'Render validator', status: 'completed' });
    job.status = 'completed'; job.stage = 'Finished MP4 ready'; job.progress = 100; await clean(job);
  });
  return visible(job);
}
async function cancel(id, owner) { const job = get(id, owner); if (job.status === 'completed') return visible(job); job.abort.abort(); job.status = 'cancelled'; job.stage = 'Cancelled'; if (!job.running) await clean(job); return visible(job); }
const timer = setInterval(() => {
  for (const [id, job] of jobs) if (Date.now() - job.createdAt > TTL) { job.abort.abort(); if (!job.running) void clean(job); jobs.delete(id); }
}, 60000); timer.unref();
async function refreshStatus(id, owner) { const job = get(id, owner); if (job.status === 'completed' && job.result) job.result.url = await s3.getPresignedDownloadUrl(job.result.key); return visible(job); }
module.exports = { create, render, cancel, refreshStatus, status: (id, owner) => visible(get(id, owner)), download };
