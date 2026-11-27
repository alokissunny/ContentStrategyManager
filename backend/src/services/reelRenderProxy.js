/**
 * Render copies of a reel's video clips for the Lambda render (backend/aws/REEL_RENDER_LAMBDA.md).
 *
 * Phone clips are often 4K HEVC (iPhone .mov, 60+ MB). On Remotion Lambda every chunk downloads the
 * whole clip and decodes it in software: in the 2026-11-27 spike a 64 MB 3840×2160 HEVC clip timed
 * every chunk out (240 s), while a 1080p H.264 copy of it rendered the reel in 21 s.
 *
 * `withRenderProxies(timeline)` swaps each clip in the cut for a copy of ONLY THE PART THE CUT PLAYS
 * (+ a margin): H.264, 8-bit, longest side ≤ 1920, a keyframe every second, faststart, stored next to
 * the original as `<name>.r1080-<from>-<to>.mp4` (deciseconds; immutable, reused by a re-render of the
 * same cut). The scenes' start times are shifted into the copy and srcW/srcH follow its size. HDR
 * (HLG / PQ) is tone mapped to SDR, as Remotion's toneMapped=true does. A clip that can't be copied
 * keeps its original URL.
 *
 * Memory (2026-11-27): the first version copied every clip of the capture as the reel started, two
 * at a time, whole, with ffmpeg's default threads — a 4K HEVC decode is ~700 MB that way (decoder
 * threads follow the HOST's CPUs, not the container's), and a capture with six 4K clips killed the
 * 2 GB worker twice. Now: only the clips and seconds the cut uses, one encode at a time per process,
 * 2 decoder / 1 filter / 2 encoder threads (~350 MB measured).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getMediaUrl, getObjectStream, headObject, uploadBytes } = require('./s3Client');

const run = promisify(execFile);
const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');
const MAX_SIDE = Number(process.env.REEL_PROXY_MAX_SIDE) || 1920;
const VIDEO_EXT = /\.(mov|mp4|m4v|webm|mkv|hevc|3gp)$/i;
const COPY_RE = /\.r1080(-\d+-\d+)?\.mp4$/;
const FPS = 30;

const keyOfUrl = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')); } catch { return ''; }
};
// range = { a, b } in seconds, or null for the whole clip
const proxyKeyOf = (key, range = null) => `${key.replace(/\.[^./]+$/, '')}.r1080${range ? `-${Math.round(range.a * 10)}-${Math.round(range.b * 10)}` : ''}.mp4`;

// codec, display size (rotation applied by ffmpeg's report), bit depth and transfer of a clip's 1st video
// stream — read from a LOCAL file: on the Render worker ffmpeg could not open the media URL itself
async function probe(file) {
  const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-threads', '1', '-i', file], { timeout: 60000 })
    .catch((e) => ({ stderr: String(e.stderr || '') }));
  const line = /Stream #[^\n]*Video: ([^\n]*)/.exec(stderr)?.[1] || '';
  const size = /, (\d{2,5})x(\d{2,5})/.exec(line);
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr);
  const deg = Math.abs(Number(rot?.[1] ?? rot?.[2] ?? 0)) % 180;
  let w = size ? Number(size[1]) : 0;
  let h = size ? Number(size[2]) : 0;
  if (deg === 90) [w, h] = [h, w];
  return {
    ok: Boolean(line),
    why: line ? '' : (stderr.trim().split('\n').pop() || 'no video stream').slice(0, 160),
    codec: (/^(\w+)/.exec(line)?.[1] || '').toLowerCase(),
    w, h,
    tenBit: /p10|p12/.test(line),
    hdr: /arib-std-b67|smpte2084/.test(line),
  };
}

// the copy's size: longest side down to MAX_SIDE, even numbers (ffmpeg's -2), never up
function fitSize(w, h) {
  if (!w || !h || Math.max(w, h) <= MAX_SIDE) return { w, h };
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  return w >= h ? { w: MAX_SIDE, h: even((h * MAX_SIDE) / w) } : { w: even((w * MAX_SIDE) / h), h: MAX_SIDE };
}

// already light enough to render as is
const renderReady = (p) => p.codec === 'h264' && !p.tenBit && !p.hdr && Math.max(p.w, p.h) <= MAX_SIDE;

// the original streamed to a temp file (no whole-clip Buffer)
async function download(key, file) {
  const { body } = await getObjectStream(key);
  await require('stream/promises').pipeline(body, fs.createWriteStream(file));
}

async function makeProxy(srcFile, outKey, info, range) {
  const file = path.join(os.tmpdir(), `reelproxy-${crypto.randomUUID()}.mp4`);
  const fit = `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'`;
  const tonemap = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
  const vf = [info.hdr ? tonemap : '', fit, 'format=yuv420p'].filter(Boolean).join(',');
  try {
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-threads', '2', // decoder threads: ffmpeg's default follows the host's CPUs (memory)
      ...(range ? ['-ss', range.a.toFixed(2), '-t', (range.b - range.a).toFixed(2)] : []),
      '-i', srcFile,
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-filter_threads', '1',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', file], { timeout: 10 * 60 * 1000 });
    const buf = await fs.promises.readFile(file);
    await uploadBytes(outKey, buf, 'video/mp4', { immutable: true });
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
  return fitSize(info.w, info.h);
}

// one encode at a time in this process: they share the 2 GB box with the reel pipeline
let encoding = Promise.resolve();
function encodeSlot(fn) {
  const turn = encoding.then(fn, fn);
  encoding = turn.catch(() => {});
  return turn;
}

// one copy per clip+range per process, however many renders ask for it
const pending = new Map();
// → { url, w?, h?, made, … } for the copy, or null when the original is fine to render as is
function proxyFor(key, range) {
  const id = proxyKeyOf(key, range);
  if (!pending.has(id)) {
    pending.set(id, (async () => {
      // made earlier: its size follows from the scene's srcW/srcH (fitSize), no download
      if (await headObject(id).catch(() => null)) return { url: await getMediaUrl(id), made: false };
      return encodeSlot(async () => {
        const src = path.join(os.tmpdir(), `reelproxy-src-${crypto.randomUUID()}`);
        try {
          await download(key, src);
          const info = await probe(src);
          if (!info.ok) throw new Error(`clip unreadable: ${key} (${info.why})`);
          if (renderReady(info)) return null;
          const t0 = Date.now();
          const size = await makeProxy(src, id, info, range);
          return {
            url: await getMediaUrl(id), ...size, made: true, ms: Date.now() - t0,
            from: `${info.codec} ${info.w}×${info.h}${info.hdr ? ' HDR' : ''}${range ? ` · ${range.a.toFixed(1)}–${range.b.toFixed(1)}s` : ''}`,
          };
        } finally {
          fs.promises.unlink(src).catch(() => {});
        }
      });
    })().catch((err) => { pending.delete(id); throw err; }));
  }
  return pending.get(id);
}

// Where a clip is used: scenes ({ src, sourceStartSec, durationInFrames, playbackRate }) and motion
// media ({ video, videoStart }, length not known → to the clip's end).
function clipUses(timeline) {
  const uses = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    for (const field of ['src', 'video']) {
      const url = node[field];
      const key = typeof url === 'string' ? keyOfUrl(url) : '';
      if (!key || !VIDEO_EXT.test(key) || COPY_RE.test(key)) continue;
      const startField = field === 'src' ? 'sourceStartSec' : 'videoStart';
      const start = Math.max(0, Number(node[startField]) || 0);
      const frames = Number(node.durationInFrames);
      // + the frames it plays under the next shot's transition (a few) — 15 is generous
      const end = field === 'src' && frames > 0 ? start + ((frames + 15) / FPS) * (Number(node.playbackRate) || 1) : Infinity;
      uses.push({ node, field, startField, key, start, end });
    }
    Object.values(node).forEach(walk);
  };
  walk(timeline);
  return uses;
}

/** → { timeline (a copy, clip URLs swapped), notes: [string] }. Never throws: a clip that fails keeps its URL. */
async function withRenderProxies(timeline) {
  const t = JSON.parse(JSON.stringify(timeline));
  const notes = [];
  const byKey = new Map();
  for (const u of clipUses(t)) byKey.set(u.key, [...(byKey.get(u.key) || []), u]);
  // one copy per clip: from just before its earliest use to just after its latest
  await Promise.all([...byKey.entries()].map(async ([key, uses]) => {
    const a = Math.max(0, Math.floor((Math.min(...uses.map((u) => u.start)) - 0.5) * 10) / 10);
    const last = Math.max(...uses.map((u) => u.end));
    const range = Number.isFinite(last) ? { a, b: Math.ceil((last + 0.5) * 10) / 10 } : (a > 0 ? { a, b: a + 600 } : null);
    try {
      const px = await proxyFor(key, range);
      if (!px) return;
      for (const u of uses) {
        u.node[u.field] = px.url;
        if (range) u.node[u.startField] = Math.max(0, Math.round((u.start - range.a) * 1000) / 1000);
        const size = px.w ? { w: px.w, h: px.h } : fitSize(u.node.srcW, u.node.srcH);
        if (u.node.srcW && size.w) { u.node.srcW = size.w; u.node.srcH = size.h; }
      }
      if (px.made) notes.push(`${path.basename(keyOfUrl(px.url))} from ${px.from} in ${Math.round(px.ms / 100) / 10}s`);
    } catch (err) {
      notes.push(`kept original (${err.message})`);
    }
  }));
  return { timeline: t, notes: [...new Set(notes)] };
}

module.exports = { withRenderProxies, proxyKeyOf, _clipUses: clipUses };
