/**
 * Render copies of a reel's video clips for the Lambda render (backend/aws/REEL_RENDER_LAMBDA.md).
 *
 * Phone clips are often 4K HEVC (iPhone .mov, 60+ MB). On Remotion Lambda every chunk downloads the
 * whole clip and decodes it in software: in the 2026-11-27 spike a 64 MB 3840×2160 HEVC clip timed
 * every chunk out (240 s), while a 1080p H.264 copy of it rendered the reel in 21 s.
 *
 * `withRenderProxies(timeline)` swaps each clip URL in the timeline for a copy that is H.264, 8-bit,
 * longest side ≤ 1920, a keyframe every second and faststart. The copy is stored next to the original
 * as `<name>.r1080.mp4` (immutable, made once per clip, reused by every later render), and the
 * scene's srcW/srcH follow the copy so the punch-in cap stays honest. HDR (HLG / PQ) clips are tone
 * mapped to SDR, as Remotion's toneMapped=true does. A clip that can't be copied keeps its original URL.
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

const keyOfUrl = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')); } catch { return ''; }
};
const proxyKeyOf = (key) => `${key.replace(/\.[^./]+$/, '')}.r1080.mp4`;

// codec, display size (rotation applied by ffmpeg's report), bit depth and transfer of a clip's 1st video
// stream — read from a LOCAL file: on the Render worker ffmpeg could not open the media URL itself
// (2026-11-27: every clip "unreadable"), as the rest of the reel pipeline already assumes
async function probe(file) {
  const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file], { timeout: 60000 })
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

async function makeProxy(srcFile, outKey, info) {
  const file = path.join(os.tmpdir(), `reelproxy-${crypto.randomUUID()}.mp4`);
  const fit = `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'`;
  const tonemap = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
  const vf = [info.hdr ? tonemap : '', fit, 'format=yuv420p'].filter(Boolean).join(',');
  try {
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', srcFile,
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', '30', '-pix_fmt', 'yuv420p', '-threads', '2',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', file], { timeout: 10 * 60 * 1000 });
    const buf = await fs.promises.readFile(file);
    await uploadBytes(outKey, buf, 'video/mp4', { immutable: true });
  } finally {
    fs.promises.unlink(file).catch(() => {});
  }
  return fitSize(info.w, info.h);
}

// one copy per clip per process, however many scenes/renders ask for it
const pending = new Map();
// at most 2 copies encode at once in this process: they share the box with the reel pipeline
let encoding = 0;
const waiters = [];
async function encodeSlot(fn) {
  while (encoding >= 2) await new Promise((r) => waiters.push(r));
  encoding += 1;
  try { return await fn(); } finally { encoding -= 1; waiters.shift()?.(); }
}
const proxyFor = (url) => proxyForKey(keyOfUrl(url));
// → { url, w?, h?, made, … } for the copy, or null when the original is fine to render as is
async function proxyForKey(key) {
  if (!key || !VIDEO_EXT.test(key) || /\.r1080\.mp4$/.test(key)) return null;
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      const outKey = proxyKeyOf(key);
      // made earlier: its size follows from the scene's srcW/srcH (fitSize), no download
      if (await headObject(outKey).catch(() => null)) return { url: await getMediaUrl(outKey), made: false };
      const src = path.join(os.tmpdir(), `reelproxy-src-${crypto.randomUUID()}`);
      try {
        await download(key, src);
        const info = await probe(src);
        if (!info.ok) throw new Error(`clip unreadable: ${key} (${info.why})`);
        if (renderReady(info)) return null;
        const t0 = Date.now();
        const size = await encodeSlot(() => makeProxy(src, outKey, info));
        return { url: await getMediaUrl(outKey), ...size, made: true, ms: Date.now() - t0, from: `${info.codec} ${info.w}×${info.h}${info.hdr ? ' HDR' : ''}` };
      } finally {
        fs.promises.unlink(src).catch(() => {});
      }
    })().catch((err) => { pending.delete(key); throw err; }));
  }
  return pending.get(key);
}

/** → { timeline (a copy, clip URLs swapped), notes: [string] }. Never throws: a clip that fails keeps its URL. */
async function withRenderProxies(timeline) {
  const t = JSON.parse(JSON.stringify(timeline));
  const notes = [];
  const swaps = [];
  // every clip URL anywhere in the timeline (scenes, cutaways, motion media…): objects whose `src` is a video
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.src === 'string' && VIDEO_EXT.test(keyOfUrl(node.src))) swaps.push(node);
    Object.values(node).forEach(walk);
  };
  walk(t);
  await Promise.all(swaps.map(async (node) => {
    try {
      const px = await proxyFor(node.src);
      if (!px) return;
      node.src = px.url;
      const size = px.w ? { w: px.w, h: px.h } : fitSize(node.srcW, node.srcH);
      if (node.srcW && size.w) { node.srcW = size.w; node.srcH = size.h; }
      if (px.made) notes.push(`${path.basename(keyOfUrl(px.url))} from ${px.from} in ${Math.round(px.ms / 100) / 10}s`);
    } catch (err) {
      notes.push(`kept original (${err.message})`);
    }
  }));
  return { timeline: t, notes: [...new Set(notes)] };
}

/** Start the copies for these clip keys now (fire and forget): the reel worker calls it as soon as it
 *  knows the clips, so the encode runs while the AI steps wait on their APIs and the render finds
 *  the copy ready. Errors are swallowed here; withRenderProxies retries and falls back. */
function warmClipCopies(keys) {
  for (const key of new Set(keys.filter(Boolean))) proxyForKey(key).catch(() => {});
}

module.exports = { withRenderProxies, warmClipCopies, proxyKeyOf };
