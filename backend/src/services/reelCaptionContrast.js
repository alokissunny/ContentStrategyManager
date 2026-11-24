/*
 * Caption contrast (studio, 2026-11-23): every word on a talking reel must be readable.
 *
 * For each caption (and chapter title) the picture actually behind it is measured: the speaker's frame at
 * that moment, the insert's photo or clip frame, mapped through the same cover crop / focus / zoom the
 * composition uses, over the band where the caption sits. From the band's mean colour and how busy it is:
 *   - ink: white, or near-black when the band is very bright;
 *   - scrim: a soft dark (or light) glow behind the words when white/ink alone would fall under
 *     4.5:1 or the band is busy (leaves, tiles, window light);
 *   - key colour: the caption agent's Brand Kit role (accent / fg / ground) is kept only at ≥ 3:1
 *     (large text) against the band as the scrim leaves it — else lightened or darkened in its own hue
 *     until it passes, else the ink.
 * Drawing cards (explainers, ✓/✗ cards) are paper: dark ink, the brand colour darkened to pass.
 */
const sharp = require('sharp');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { getObjectBytes } = require('./s3Client');
const { toVisionImage } = require('./visionImage');

const run = promisify(execFile);
const W = 1080;
const H = 1920;
const WHITE = '#FFFFFF';
const INK = '#1D1D1F';
const PAPER = '#F6F5F2';

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbHex = (rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const relLum = (rgb) => {
  const ch = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/* a picture, small, as raw-able sharp input — cached per (key, second) */
const frameCache = new Map();
async function pictureOf({ key, kind, atSec, clipFile, ffmpegPath }) {
  const id = `${key}@${kind === 'video' ? Math.round(atSec * 2) / 2 : 0}`;
  if (!frameCache.has(id)) {
    frameCache.set(id, (async () => {
      if (kind === 'video') {
        const file = await clipFile(key);
        const { stdout } = await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, atSec)), '-i', file,
          '-frames:v', '1', '-vf', 'scale=360:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { encoding: 'buffer', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
        return stdout;
      }
      const { buffer, contentType } = await getObjectBytes(key);
      const vis = await toVisionImage(buffer, contentType, key);
      return sharp(vis.buffer).rotate().resize(540, 540, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    })().catch(() => null));
    if (frameCache.size > 400) frameCache.delete(frameCache.keys().next().value);
  }
  return frameCache.get(id);
}

/* the band [y0, y1] (fractions of the 9:16 frame, x 7–93 %) mapped back into the source picture through
   object-fit: cover + object-position + a zoom about the focus point (as SceneMedia draws it) */
async function bandStats(scene, y0, y1, helpers) {
  const buf = await pictureOf({ ...helpers, key: scene.key, kind: scene.kind, atSec: scene.atSec });
  if (!buf) return null;
  const meta = await sharp(buf).metadata();
  let sw = meta.width;
  let sh = meta.height;
  let cx0 = 0;
  let cy0 = 0;
  if (scene.crop) { // letterboxed clip: the picture inside the bands
    cx0 = scene.crop.x * sw; cy0 = scene.crop.y * sh; sw *= scene.crop.w; sh *= scene.crop.h;
  }
  const fx = scene.crop ? 0.5 : (scene.focusX ?? 50) / 100;
  const fy = scene.crop ? 0.5 : (scene.focusY ?? 50) / 100;
  const z = Math.max(1, scene.zoom || 1);
  const s = Math.max(W / sw, H / sh);
  const ox = (W - sw * s) * fx;
  const oy = (H - sh * s) * fy;
  // output point → before zoom (zoom about the focus point in output space) → source px
  const px = fx * W;
  const py = fy * H;
  const toSrc = (X, Y) => [cx0 + ((px + (X - px) / z) - ox) / s, cy0 + ((py + (Y - py) / z) - oy) / s];
  const [ax, ay] = toSrc(W * 0.07, H * y0);
  const [bx, by] = toSrc(W * 0.93, H * y1);
  const left = Math.max(0, Math.floor(Math.min(ax, bx)));
  const top = Math.max(0, Math.floor(Math.min(ay, by)));
  const width = Math.min(meta.width - left, Math.max(4, Math.ceil(Math.abs(bx - ax))));
  const height = Math.min(meta.height - top, Math.max(4, Math.ceil(Math.abs(by - ay))));
  if (width < 2 || height < 2) return null;
  const band = sharp(buf).extract({ left, top, width, height }).removeAlpha();
  if (process.env.REEL_CONTRAST_DUMP) await band.clone().toFile(`${process.env.REEL_CONTRAST_DUMP}/band-${Date.now()}-${Math.round(Math.random() * 1e4)}.png`);
  const st = await band.clone().stats();
  const rgb = st.channels.slice(0, 3).map((c) => c.mean);
  // busy = texture, not gradient: the share of the band (at caption scale) that differs from a blurred
  // copy of itself. A plain wall with soft light reads ≈ 0–0.1; window bars, tiles, worktops 0.3+
  const bw = 72;
  const bh = Math.max(8, Math.round((bw * height) / width));
  const grey = await band.clone().resize(bw, bh, { fit: 'fill' }).greyscale().toColourspace('b-w').raw().toBuffer();
  const soft = await sharp(grey, { raw: { width: bw, height: bh, channels: 1 } }).blur(2.5).extractChannel(0).raw().toBuffer();
  // the share of the band that is textured (one edge — a lamp, a door frame — is not a busy band)
  let textured = 0;
  for (let i = 0; i < grey.length; i += 1) if (Math.abs(grey[i] - soft[i]) > 10) textured += 1;
  const busy = textured / grey.length;
  return { rgb, lum: relLum(rgb), busy };
}

/* a brand colour moved in its own hue (toward white or black) until it reads ≥ min against bgLum */
function fitColour(hex, bgLum, min, towardWhite, maxSteps = 14) {
  let rgb = hexRgb(hex);
  if (!rgb) return null;
  for (let i = 0; i < maxSteps; i += 1) {
    if (ratio(relLum(rgb), bgLum) >= min) return rgbHex(rgb);
    rgb = rgb.map((c) => (towardWhite ? c + (255 - c) * 0.16 : c * 0.82));
  }
  return ratio(relLum(rgb), bgLum) >= min ? rgbHex(rgb) : null;
}

/* the key word in the brand colour: as text when it reads after a small nudge (≤ 3 steps, still the
   brand's colour); otherwise the true brand colour as a marker behind the word, with white or ink on it */
function brandKey(hex, bgLum, towardWhite) {
  if (!hexRgb(hex)) return {};
  const near = fitColour(hex, bgLum, 3, towardWhite, 3);
  if (near) return { keyColor: near };
  const l = relLum(hexRgb(hex));
  const on = ratio(1, l) >= ratio(relLum(hexRgb(INK)), l) ? WHITE : INK;
  return { keyColor: on, keyBg: String(hex).toUpperCase() };
}

/** what the words wear over a measured band (null band = unknown → white on a soft dark scrim) */
function inkFor(band, brandColour) {
  if (!band) {
    return { ink: WHITE, scrim: 'dark', ...(brandColour ? brandKey(brandColour, 0.08, true) : {}) };
  }
  const { lum, busy } = band;
  // white unless near-black clearly reads better (white is the reel's voice; dark ink on bright walls)
  const whiteC = ratio(1, lum);
  const inkC = ratio(relLum(hexRgb(INK)), lum);
  // dark ink only on a calm band (window frames, tiles and leaves read badly behind thin dark words)
  const darkInk = inkC >= 4.5 && inkC > whiteC * 1.4 && busy < 0.15;
  const ink = darkInk ? INK : WHITE;
  const plain = darkInk ? inkC : whiteC;
  // a shade only where the words would not read on their own: low contrast, or a textured band
  const scrim = plain < 4.5 || busy > 0.25 ? (darkInk ? 'light' : 'dark') : 'none';
  // what the scrim leaves behind the words (its centre)
  const effective = scrim === 'dark' ? lum * 0.4 : scrim === 'light' ? lum * 0.45 + 0.5 : lum;
  return { ink, scrim, ...(brandColour ? brandKey(brandColour, effective, !darkInk) : {}), bg: Math.round(lum * 100) / 100, busy: Math.round(busy * 100) / 100 };
}

const ON_CARD = (brandColour) => ({
  ink: INK, scrim: 'none', ...(brandColour ? brandKey(brandColour, relLum(hexRgb(PAPER)), false) : {}),
});

/**
 * captions: the timeline's caption cues ({fromFrame,toFrame,pos,keyColorRole?}); chapters likewise.
 * sceneAt(frame) → { key, kind, atSec, focusX, focusY, zoom, crop, card, split } or null.
 * palette: { accent, fg, ground }. Mutates the cues: ink, scrim, keyColor. Returns a summary.
 */
async function applyCaptionContrast({ captions, chapters = [], hook = null, sceneAt, palette = {}, helpers }) {
  const summary = { measured: 0, scrims: 0, darkInk: 0, brandKept: 0, brandAdjusted: 0, brandMarker: 0, brandDropped: 0 };
  await Promise.all(captions.map(async (cue) => {
    const mid = Math.round((cue.fromFrame + cue.toFrame) / 2);
    const sc = sceneAt(mid);
    const role = cue.keyColorRole;
    const wanted = role && role !== 'ink' ? palette[role] : null;
    delete cue.keyColorRole;
    let out;
    cue.onCard = Boolean(sc?.card); // decided once per caption (the renderer never flips it mid-caption)
    if (sc?.card) out = ON_CARD(wanted);
    else {
      // where TwoVoiceCaptions puts it: top 17 %, centre 50 %, lower 74 %
      const pos = cue.pos || 'top';
      const y = pos === 'top' ? 0.17 : pos === 'center' ? 0.5 : 0.74;
      const band = sc && !sc.split ? await bandStats(sc, y - 0.065, y + 0.065, helpers).catch(() => null) : null;
      if (band) summary.measured += 1;
      out = inkFor(band, wanted);
      if (band && process.env.REEL_CONTRAST_DEBUG) console.log('[contrast]', cue.fromFrame, pos, band.lum.toFixed(2), band.busy.toFixed(2), out.ink, out.scrim);
    }
    cue.ink = out.ink;
    if (out.scrim !== 'none') { cue.scrim = out.scrim; summary.scrims += 1; }
    if (out.ink === INK) summary.darkInk += 1;
    if (wanted) {
      if (out.keyBg) summary.brandMarker += 1;
      else if (!out.keyColor) summary.brandDropped += 1;
      else if (out.keyColor.toUpperCase() === String(wanted).toUpperCase()) summary.brandKept += 1;
      else summary.brandAdjusted += 1;
      if (out.keyColor) cue.keyColor = out.keyColor;
      if (out.keyBg) cue.keyBg = out.keyBg;
    }
  }));
  // the hook: the opening words at ~22 %
  if (hook?.text) {
    const sc = sceneAt(Math.round(hook.durationInFrames / 2));
    const band = sc && !sc.card && !sc.split ? await bandStats(sc, 0.15, 0.29, helpers).catch(() => null) : null;
    const out = inkFor(band, null);
    hook.ink = out.ink;
    if (out.scrim !== 'none') hook.scrim = out.scrim;
  }
  // chapter titles (fallback look) sit at ~62–70 %; in two-voice reels they are a label in the caption
  await Promise.all(chapters.map(async (ch) => {
    const sc = sceneAt(ch.fromFrame + Math.round(ch.durationInFrames / 2));
    if (sc?.card) { ch.ink = INK; return; }
    const band = sc && !sc.split ? await bandStats(sc, 0.58, 0.71, helpers).catch(() => null) : null;
    const out = inkFor(band, null);
    ch.ink = out.ink;
    if (out.scrim !== 'none') ch.scrim = out.scrim;
  }));
  return summary;
}

module.exports = { applyCaptionContrast, bandStats, inkFor, fitColour, brandKey, relLum, hexRgb, ratio };
