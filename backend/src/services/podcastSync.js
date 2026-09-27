// Compare speech energy in independent windows. The secondary audio is only a
// synchronization reference; it is never mixed into the finished podcast.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const execute = promisify(execFile);
const HZ = 100;
const unavailable = reason => ({ status: 'unavailable', reason });

function envelope(pcm) {
  const values = new Float32Array(Math.floor(pcm.length / 160)); // 80 samples / 10 ms at 8 kHz
  for (let i = 0; i < values.length; i++) {
    let energy = 0;
    for (let j = 0; j < 80; j++) { const s = pcm.readInt16LE((i * 80 + j) * 2) / 32768; energy += s * s; }
    values[i] = Math.log(Math.max(0.00001, Math.sqrt(energy / 80)));
  }
  return values;
}
function score(a, b, start, candidate, length, step = 1) {
  let x = 0, y = 0, xx = 0, yy = 0, xy = 0, n = 0;
  for (let i = 0; i < length; i += step) {
    const u = a[start + i], v = b[candidate + i];
    x += u; y += v; xx += u * u; yy += v * v; xy += u * v; n++;
  }
  const vx = xx - x * x / n, vy = yy - y * y / n;
  // Constant tones and silence provide no unique synchronization evidence.
  return vx / n < 0.015 || vy / n < 0.015 ? -1 : (xy - x * y / n) / Math.sqrt(vx * vy);
}
function correlate(primary, secondary, primaryStart = 0, secondaryStart = 0) {
  const from = Math.ceil(primaryStart * HZ), otherFrom = Math.ceil(secondaryStart * HZ);
  const available = Math.min(primary.length - from, secondary.length - otherFrom);
  if (available < 600) return unavailable('Auto-align needs at least 6 seconds of shared, audible conversation.');
  const length = Math.min(1200, Math.floor(available / 3));
  const matches = [];
  // Spread the evidence across the recording to detect drift or edits instead
  // of aligning one phrase and silently losing sync later in the episode.
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const start = from + Math.floor((primary.length - from - length) * fraction);
    const candidates = [];
    for (let candidate = otherFrom; candidate + length <= secondary.length; candidate += 4) {
      const value = score(primary, secondary, start, candidate, length, 4);
      candidates.push({ candidate, value });
    }
    candidates.sort((a, b) => b.value - a.value);
    const best = candidates[0];
    if (!best || best.value < 0.65) continue;
    const runner = candidates.find(c => Math.abs(c.candidate - best.candidate) > 75);
    if (runner && best.value - runner.value < 0.08) continue;
    let refined = { candidate: best.candidate, value: -1 };
    for (let candidate = Math.max(otherFrom, best.candidate - 6); candidate <= Math.min(secondary.length - length, best.candidate + 6); candidate++) {
      const value = score(primary, secondary, start, candidate, length);
      if (value > refined.value) refined = { candidate, value };
    }
    if (refined.value >= 0.65) matches.push({ offset: (refined.candidate - start) / HZ, confidence: refined.value, start });
  }
  if (matches.length < 2 || matches.at(-1).start - matches[0].start < length) return unavailable('No reliable shared audio match was found. Check both recordings contain the same conversation, or set start times manually.');
  const offsets = matches.map(m => m.offset).sort((a, b) => a - b);
  if (offsets.at(-1) - offsets[0] > 0.1) return unavailable('The audio timing changes across these recordings (drift or edited sections). A single start-time adjustment cannot reliably align them; use matching, uncut recordings or align manually.');
  return { status: 'aligned', offsetSec: offsets[Math.floor(offsets.length / 2)], confidence: Math.min(...matches.map(m => m.confidence)), matchedWindows: matches.length, precisionSec: 1 / HZ };
}

function compareInWorker(primary, secondary, primaryStart, secondaryStart, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    let settled = false;
    const worker = new Worker(__filename, { workerData: { primary, secondary, primaryStart, secondaryStart }, transferList: [primary.buffer, secondary.buffer] });
    const abort = () => finish(signal.reason || new Error('Alignment cancelled.'));
    const timer = setTimeout(() => finish(new Error('Audio alignment timed out.')), 90000);
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(result); }
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => finish(null, result)); worker.once('error', finish);
    worker.once('exit', code => { if (code !== 0) finish(new Error('Audio alignment stopped.')); });
  });
}
async function alignPodcastAudio(assets, primaryRole, signal) {
  const primary = assets.find(a => a.role === primaryRole), secondary = assets.find(a => a.role !== primaryRole);
  if (!primary?.hasAudio || !secondary?.hasAudio) return unavailable('Both videos need an audio track for auto-align. The secondary track remains muted in your podcast.');
  const decoded = [];
  for (const asset of [primary, secondary]) {
    const { stdout } = await execute(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', asset.path, '-t', String(asset.endSec), '-map', '0:a:0', '-vn', '-af', 'highpass=f=150,lowpass=f=3000', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { signal, encoding: 'buffer', timeout: 180000, maxBuffer: 21 * 1024 ** 2 });
    decoded.push(envelope(stdout));
  }
  const result = await compareInWorker(...decoded, primary.startSec, secondary.startSec, signal);
  if (result.status !== 'aligned') return result;
  // Source-secondary time = source-primary time + offset. Trim unmatched
  // leading footage from either side; respect the user's minimum start times.
  const primaryStart = Math.max(primary.startSec, secondary.startSec - result.offsetSec);
  const secondaryStart = primaryStart + result.offsetSec;
  const durationSec = Math.min(primary.endSec - primaryStart, secondary.endSec - secondaryStart);
  if (durationSec < 0.5) return unavailable('These start times leave no shared conversation to preview.');
  return { ...result, primaryAudioSource: primaryRole, secondaryRole: secondary.role, durationSec, starts: [{ id: primary.id, startSec: Math.round(primaryStart * 1000) / 1000 }, { id: secondary.id, startSec: Math.round(secondaryStart * 1000) / 1000 }] };
}
if (!isMainThread) parentPort.postMessage(correlate(workerData.primary, workerData.secondary, workerData.primaryStart, workerData.secondaryStart));
module.exports = { alignPodcastAudio, correlate, envelope };
