/*
 * Reel format directors — one editor per recommended-reel format (ReelPlanner
 * / services/ideaReelPlan.js), chosen in captureReelAgent.runCaptureReel when a
 * reel carries a story plan:
 *
 *   talking_head_broll   ┐ the DIALOGUE engine: an LLM edit decision list over
 *   talking_head         │ the studio's spoken takes (phrase ids from Whisper
 *   faceless_voiceover   ┘ word timings) + B-roll cutaways; code cuts dead air,
 *                          builds ONE continuous dialogue track (ffmpeg), lays
 *                          muted picture over it (speaker in sync, or B-roll as
 *                          L-cuts), alternates punch-in framing, word-timed
 *                          captions, slam hook, chapter labels, a quiet music
 *                          bed and an end card on the best finished shot.
 *   faceless_text          the story told in on-screen lines over footage, cut
 *                          to an original track (directReel + a text-led style).
 *   music_led              the existing Bauhly Reel Director (default teaser).
 *   motion_graphics        the same director with MOTION_GRAPHICS_LOOK: an
 *                          explainer — a line on every shot, labels / arrows /
 *                          circles / wipes on most photos, 15–30 s
 *                          (prompts/reel-formats/motion-graphics.md).
 *
 * Prompts: prompts/reel-formats/*.md (dialogue-base + one file per format).
 * Why (2026-11-18): a Talking head + B-roll reel came out as four takes played
 * back to back with captions — no cutaways, no music, no trimming.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { completeToolCall } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { uploadBytes, getMediaUrl } = require('./s3Client');

const run = promisify(execFile);
const DIR = path.join(__dirname, '..', '..', 'prompts', 'reel-formats');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

const DIALOGUE_FORMATS = new Set(['talking_head_broll', 'talking_head', 'faceless_voiceover']);
const FORMAT_FILE = {
  talking_head_broll: 'talking-head-broll.md',
  talking_head: 'talking-head.md',
  faceless_voiceover: 'faceless-voiceover.md',
};
const ZOOM = { wide: 1, medium: 1.14, close: 1.3 };
const MOTIONS = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'none'];
const GRAPHICS = ['none', 'label', 'arrow', 'circle', 'spotlight'];
const GAP_SPLIT = 0.3; // a pause longer than this inside a beat is cut out (jump cut) — tighter since editor v2 (2026-11-21)
const LEAD = 0.07; // breath before the first word of a piece
const TAIL = 0.1; // after the last word
const MAX_SPOKEN = 58; // seconds — Instagram's sweet spot is well under a minute
const END_SEC = 3.0; // the end card's hold: long enough to read the CTA and the handle
// editor v2 (studio's review of a reel, 2026-11-21): inserts hold long enough to read, the speaker
// never flashes on screen between two inserts, the hook reads before the first word
const MIN_IMAGE_SEC = 2.0;
const MIN_VIDEO_SEC = 1.5;
const BRIDGE_SEC = 1.5; // a speaker gap shorter than this between two inserts is covered by the first
const HOOK_LEAD_MAX = 0.9; // the title reads over the opening frame before the first spoken word
const REFRAME_SEC = 6; // a long stretch on the speaker changes framing once, at a beat boundary

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
const normWord = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

const agent = () => require('./captureReelAgent');

// ── phrases: a spoken take broken where the speaker breathes or ends a clause ──
function phrasesOf(asset) {
  const ws = (asset.words || []).filter((w) => w.end > w.start || w.text);
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  ws.forEach((w, i) => {
    cur.push(w);
    const next = ws[i + 1];
    const gap = next ? next.start - w.end : 99;
    const stop = /[.?!;:,]$/.test(w.text);
    // a long phrase splits only where the speaker breathes (a ≥ 0.12 s gap) — never mid-flow, so a beat
    // that ends on a phrase never ends in the middle of a run of words
    if (gap >= 0.28 || (stop && cur.length >= 3) || (cur.length >= 12 && gap >= 0.12) || cur.length >= 20) flush();
  });
  flush();
  return out.map((p, i) => ({
    id: `${asset.id}.p${i}`,
    index: i,
    words: p,
    text: p.map((w) => w.text).join(' '),
    start: p[0].start,
    end: p[p.length - 1].end,
  }));
}

// ── the edit decision tool ─────────────────────────────────────────────────
const o = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const EDIT_TOOL = {
  name: 'edit_talking_reel',
  description: 'The edit of a talking reel: ordered beats over the spoken takes, B-roll cutaways, hook, end card.',
  input_schema: o({
    concept: { type: 'string' },
    hook: o({ text: { type: 'string' }, emphasis: { type: 'string' } }),
    beats: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: o({
        clip: { type: 'string' },
        from: { type: 'integer' },
        to: { type: 'integer' },
        show: { type: 'string', enum: ['speaker', 'broll'] },
        zoom: { type: 'string', enum: ['wide', 'medium', 'close'] },
        brollFrom: { type: 'string', enum: ['start', 'middle'] },
        broll: {
          type: 'array',
          maxItems: 3,
          items: o({
            assetId: { type: 'string' },
            startSec: { type: 'number' },
            motion: { type: 'string', enum: MOTIONS },
            focusX: { type: 'number' },
            focusY: { type: 'number' },
          }),
        },
        // a chapter title (2–4 words) on the beat where a new point starts, else ""
        label: { type: 'string' },
        // how B-roll shares the frame: full screen, or split (B-roll on top, the speaker below)
        layout: { type: 'string', enum: ['full', 'split'] },
      }),
    },
    endAssetId: { type: 'string' },
    cta: o({ line: { type: 'string' }, sub: { type: 'string' } }),
    music: o({ mood: { type: 'string' }, genre: { type: 'string' }, bpm: { type: 'number' } }),
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  }),
};

function materialForPrompt(material, phrasesByClip) {
  return material.assets.map((a) => {
    const base = {
      id: a.id,
      type: a.kind === 'image' ? 'photo' : 'clip',
      ...(a.take ? { take: a.take } : {}),
      ...(a.pool ? { pool: a.pool } : {}),
      summary: a.summary,
      ...(a.kind === 'image' && a.subjects?.length ? { subjects: a.subjects } : {}),
      ...(a.kind === 'video' ? { durationSec: Math.round(a.durationSec * 10) / 10 } : {}),
    };
    const ph = phrasesByClip.get(a.id);
    if (ph?.length) {
      base.phrases = ph.map((p) => ({ id: p.id, sec: Math.round((p.end - p.start) * 10) / 10, words: p.text }));
    } else if (a.kind === 'video') {
      base.stills = (a.stills || []).slice(0, 4).map((s) => ({ t: s.t, summary: s.summary }));
    }
    return base;
  });
}

async function callEditor({ format, story, material, phrasesByClip, brand, handle, extra = '' }) {
  const system = `${read('dialogue-base.md')}\n\n${read(FORMAT_FILE[format])}`;
  // the photos the reel planner picked for each sequence (plan v6 assetKeys), as material ids
  const idOfKey = new Map(material.assets.map((a) => [a.key, a.id]));
  const picksOf = (s) => (s.assetKeys || []).map((k) => idOfKey.get(k)).filter(Boolean);
  const user = [
    `STUDIO: ${handle ? `@${handle}` : '(no handle)'}`,
    `BRAND: ${JSON.stringify(brand || {})}`,
    `STORY PLAN:\n${JSON.stringify({
      title: story.title, format: story.format,
      sequences: story.sequences.map((s, i) => ({ n: i + 1, title: s.title, role: s.role, shot: s.shot, say: s.say, onScreenText: s.onScreenText, brollToShow: s.broll || '', brollAssets: picksOf(s), seconds: s.targetSec })),
    }, null, 2)}`,
    `MATERIAL (TAKES with phrases, B-ROLL):\n${JSON.stringify(materialForPrompt(material, phrasesByClip), null, 2)}`,
    extra,
  ].filter(Boolean).join('\n\n');
  const images = await agent()._visionParts(material.assets);
  // the cut agent runs on Claude Sonnet 5.5 (studio, 2026-11-23); its own setting, since
  // captureReel's model is shared with the other reel directors
  const model = process.env.REEL_EDIT_MODEL || 'claude-sonnet-5-5';
  const started = Date.now();
  const res = await completeToolCall({
    model,
    system,
    userParts: [...images, { type: 'text', text: user }],
    tool: EDIT_TOOL,
    maxTokens: 12000,
    kind: 'captureReel',
    timeoutMs: 240000,
    retryHint: 'Return ONLY the JSON object for edit_talking_reel, matching the schema exactly.',
  });
  const u = res.usage || {};
  const costUsd = estimatePlanCostUsd(res.model, num(u.input_tokens), num(u.output_tokens), num(u.cached_tokens));
  return {
    raw: res.parsed,
    model: res.model,
    debug: {
      source: `Capture reel — ${format} editor`,
      model: res.model,
      prompt: `${system}\n\n---\n\n${user}\n\n[${images.filter((x) => x.type === 'image').length} image(s) attached]`,
      output: JSON.stringify(res.parsed, null, 2),
      elapsedMs: Date.now() - started,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd,
    },
  };
}

// ── every recorded take is used (studio, 2026-11-21: "it didn't use all my talking recordings") ──
// A take the studio recorded for a sequence (take.role speaking) that the editor left out
// goes back in, whole, in story order — dropping someone's recorded line is never the editor's call.
function includeEveryTake(raw, material, phrasesByClip) {
  if (!raw || !Array.isArray(raw.beats)) return { raw, added: [] };
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const used = new Set(raw.beats.map((b) => str(b?.clip, 12)));
  const missing = material.assets
    .filter((a) => a.take?.role === 'speaking' && phrasesByClip.get(a.id)?.length && !used.has(a.id))
    .sort((x, y) => x.take.sequence - y.take.sequence);
  if (!missing.length) return { raw, added: [] };
  const seqOf = (b) => byId.get(str(b?.clip, 12))?.take?.sequence ?? 99;
  const beats = [...raw.beats];
  missing.forEach((a) => {
    const ph = phrasesByClip.get(a.id);
    const beat = {
      clip: a.id, from: 0, to: ph.length - 1, show: 'speaker', zoom: 'medium', brollFrom: 'middle',
      broll: [], label: '', emphasis: [], layout: 'full',
    };
    const at = beats.findIndex((b) => seqOf(b) > a.take.sequence);
    if (at < 0) beats.push(beat); else beats.splice(at, 0, beat);
  });
  return { raw: { ...raw, beats }, added: missing.map((a) => a.id) };
}

// ── validate the edit into pieces on an output clock ──────────────────────
function cutEdit({ raw, format, material, phrasesByClip, fps }) {
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const frames = (s) => Math.max(0, Math.round(s * fps));
  const used = new Set();
  const warnings = [];
  const isFace = (a) => a?.take?.role === 'speaking' || (a?.kind === 'video' && phrasesByClip.get(a.id)?.length);
  // what may be cut away to: photos, B-roll takes, library media, clips without speech
  const brollOk = (a) => a && !(a.take?.role === 'speaking') && !(phrasesByClip.get(a.id)?.length && !a.take);
  const pool = material.assets.filter(brollOk);

  const beats = [];
  let spoken = 0;
  for (const b of Array.isArray(raw?.beats) ? raw.beats : []) {
    const clip = byId.get(str(b?.clip, 12));
    const ph = clip ? phrasesByClip.get(clip.id) : null;
    if (!ph?.length) continue;
    let from = clampN(Math.round(num(b.from)), 0, ph.length - 1);
    let to = clampN(Math.round(num(b.to, from)), 0, ph.length - 1);
    if (to < from) [from, to] = [to, from];
    const chosen = ph.slice(from, to + 1).filter((p) => !used.has(p.id));
    if (!chosen.length) continue;
    // finish the sentence (2026-11-23): a beat that stops mid-sentence takes the short rest of it —
    // the next phrase of the same take, said straight on, that ends the sentence
    for (let k = 0; k < 2; k += 1) {
      const tail = chosen[chosen.length - 1];
      const lastWord = tail.words[tail.words.length - 1]?.text || '';
      const next = ph[tail.index + 1];
      if (/[.?!…]["”']?$/.test(lastWord) || !next || used.has(next.id)) break;
      if (next.start - tail.end > 0.5 || next.words.length > 8) break;
      chosen.push(next);
      if (/[.?!…]["”']?$/.test(next.words[next.words.length - 1]?.text || '')) break;
    }
    chosen.forEach((p) => used.add(p.id));
    // pieces = contiguous runs of words: a new piece at a long pause, or where
    // a phrase in between was dropped (already used / skipped by the editor)
    const pieces = [];
    let cur = [];
    let prevIndex = -2;
    chosen.forEach((p) => {
      p.words.forEach((w, wi) => {
        const last = cur[cur.length - 1];
        const jump = wi === 0 && p.index !== prevIndex + 1;
        if (last && (jump || w.start - last.end > GAP_SPLIT)) { pieces.push(cur); cur = []; }
        cur.push(w);
      });
      prevIndex = p.index;
    });
    if (cur.length) pieces.push(cur);
    const cut = pieces.map((pw) => {
      const start = Math.max(0, pw[0].start - LEAD);
      const end = Math.min(clip.durationSec - 0.02, pw[pw.length - 1].end + TAIL);
      const len = frames(end - start);
      return len >= 4 ? { clip, start, frames: len, words: pw } : null;
    }).filter(Boolean);
    if (!cut.length) continue;
    const beatSec = cut.reduce((n, c) => n + c.frames / fps, 0);
    if (spoken + beatSec > MAX_SPOKEN && beats.length >= 2) { warnings.push('trimmed to under a minute'); break; }
    spoken += beatSec;
    const broll = (Array.isArray(b.broll) ? b.broll : []).map((x) => {
      const a = byId.get(str(x?.assetId, 12));
      if (!brollOk(a)) return null;
      return {
        asset: a,
        startSec: a.kind === 'video' ? clampN(num(x.startSec), 0, Math.max(0, a.durationSec - 0.5)) : 0,
        motion: MOTIONS.includes(x.motion) ? x.motion : (a.kind === 'video' ? 'none' : 'push-in'),
        focusX: Math.round(clampN(num(x.focusX, 50), 0, 100)),
        focusY: Math.round(clampN(num(x.focusY, 45), 0, 100)),
        graphic: a.kind === 'image' && GRAPHICS.includes(x.graphic?.type) && x.graphic.type !== 'none' ? {
          type: x.graphic.type,
          text: words(str(x.graphic.text, 40)).slice(0, 4).join(' '),
          x: clampN(num(x.graphic.x, 50), 4, 96),
          y: clampN(num(x.graphic.y, 50), 4, 96),
        } : null,
      };
    }).filter(Boolean).slice(0, 3);
    let show = b.show === 'broll' ? 'broll' : 'speaker';
    // a face never shows in a faceless reel; a speaker shot with no B-roll is filled from the pool
    if (format === 'faceless_voiceover' && show === 'speaker' && isFace(clip) && !/room|space|kitchen|bath|interior|floor|wall|ceiling/i.test(`${clip.summary} ${clip.description}`)) {
      show = 'broll';
    }
    beats.push({
      cut,
      show,
      zoom: ZOOM[b.zoom] || 1,
      brollFrom: b.brollFrom === 'start' ? 'start' : 'middle',
      broll,
      label: GENERIC_LABEL.test(str(b.label, 32)) ? '' : str(b.label, 32).split(' ').slice(0, 4).join(' '),
      // a key phrase ("existing floor") lights each of its words
      emphasis: [...new Set((Array.isArray(b.emphasis) ? b.emphasis : []).slice(0, 2).flatMap((w) => words(w).slice(0, 3).map(normWord)).filter(Boolean))],
      layout: b.layout === 'split' ? 'split' : 'full',
    });
  }
  if (!beats.length) throw new Error('The editor returned no usable spoken beats.');

  // the hook is a face (talking formats): no cutaway in its first 1.5 s
  if (format !== 'faceless_voiceover') {
    beats[0].show = 'speaker';
    beats[0].brollFrom = 'middle';
    beats[0].label = '';
  }
  return { beats, pool, warnings, byId };
}

/* Fill any beat that must show B-roll but got none, and lift B-roll coverage
   for Talking head + B-roll to the format's floor, from the unused pool. */
function ensureBroll({ beats, pool, format, fps }) {
  if (!pool.length || format === 'talking_head') return;
  const usage = new Map(pool.map((a) => [a.id, 0]));
  beats.forEach((b) => b.broll.forEach((x) => usage.set(x.asset.id, (usage.get(x.asset.id) || 0) + 1)));
  const nextAsset = (avoid) => pool.slice().sort((a, b) => (usage.get(a.id) - usage.get(b.id)) || (a.pool === 'library') - (b.pool === 'library'))
    .find((a) => a.id !== avoid) || pool[0];
  const take = (avoid) => {
    const a = nextAsset(avoid);
    usage.set(a.id, (usage.get(a.id) || 0) + 1);
    return { asset: a, startSec: 0, motion: a.kind === 'video' ? 'none' : ['push-in', 'pan-left', 'pull-out', 'pan-right'][usage.get(a.id) % 4], focusX: 50, focusY: 45 };
  };
  const secOf = (b) => b.cut.reduce((n, c) => n + c.frames / fps, 0);
  beats.forEach((b) => {
    if (b.show === 'broll' && !b.broll.length) {
      const n = Math.max(1, Math.min(3, Math.round(secOf(b) / 2.5)));
      for (let i = 0; i < n; i += 1) b.broll.push(take(b.broll[i - 1]?.asset.id));
    }
  });
  if (format !== 'talking_head_broll') return;
  const total = beats.reduce((n, b) => n + secOf(b), 0);
  const covered = () => beats.reduce((n, b, i) => {
    if (!b.broll.length) return n;
    const s = secOf(b);
    return n + (b.show === 'broll' || b.brollFrom === 'start' ? s : Math.max(0, s - Math.max(1.2, s * 0.4)) - (i === 0 ? 0.3 : 0));
  }, 0);
  // longest speaker-only beats after the hook get a cutaway on their second half
  const candidates = beats.map((b, i) => ({ b, i, s: secOf(b) }))
    .filter(({ b, i, s }) => i > 0 && b.show === 'speaker' && !b.broll.length && s >= 2.2)
    .sort((x, y) => y.s - x.s);
  for (const { b, s } of candidates) {
    if (covered() / total >= 0.45) break;
    b.brollFrom = 'middle';
    const n = s > 6 ? 2 : 1;
    for (let k = 0; k < n; k += 1) b.broll.push(take(b.broll[k - 1]?.asset.id));
  }
  // the hook beat itself may cut away only after 1.5 s, and only if long
  if (covered() / total < 0.3 && beats[0] && !beats[0].broll.length && secOf(beats[0]) > 4) beats[0].broll.push(take());
}

// ── each picture once (editor v2): a repeated insert swaps to an unused picture, else goes ───────
function onceEach(beats, pool) {
  const used = new Set();
  beats.forEach((b) => {
    b.broll = b.broll.map((x) => {
      if (!used.has(x.asset.id)) { used.add(x.asset.id); x.__kept = true; return x; }
      const alt = pool.find((a) => !used.has(a.id) && a.kind === x.asset.kind && !beats.some((bb) => bb.broll.some((y) => y.asset.id === a.id)));
      if (!alt) return null;
      used.add(alt.id);
      return { ...x, asset: alt, startSec: 0, __kept: true };
    }).filter(Boolean);
  });
  beats.forEach((b) => b.broll.forEach((x) => { delete x.__kept; }));
}

// ── editor v2 review: what the cut rules measure on a draft ─────────────────────────────────────
const beatSec = (b, fps) => b.cut.reduce((n, c) => n + c.frames / fps, 0);
function reviewIssues(cut, { fps, format }) {
  const out = [];
  const beats = cut.beats;
  const total = beats.reduce((n, b) => n + beatSec(b, fps), 0);
  if (total > 32) out.push(`The spoken track runs ${total.toFixed(1)} s; aim for 20–28 s. Cut repeated phrasing, restarts and filler inside takes (never a whole recorded line).`);
  if (format === 'faceless_voiceover') return out;
  beats.forEach((b, i) => {
    const s = beatSec(b, fps);
    const insert = b.broll.length ? (b.show === 'broll' || b.brollFrom === 'start' ? s : s * 0.6) / b.broll.length : 0;
    if (b.broll.length && insert < MIN_IMAGE_SEC) out.push(`Beat ${i + 1}: each insert gets ~${insert.toFixed(1)} s — too short to read. Give an insert ≥ ${MIN_IMAGE_SEC} s (fewer items, or a longer stretch of speech under it).`);
    const prev = beats[i - 1];
    const next = beats[i + 1];
    if (!b.broll.length && prev?.broll.length && next?.broll.length && s < BRIDGE_SEC) out.push(`Beat ${i + 1}: the speaker is back for only ${s.toFixed(1)} s between two inserts — merge it into the inserts around it or hold the speaker longer.`);
  });
  let run = 0;
  beats.forEach((b, i) => {
    run = b.broll.length ? 0 : run + beatSec(b, fps);
    if (run > 8 && !b.broll.length && (i === beats.length - 1 || beats[i + 1].broll.length)) { out.push(`Beats up to ${i + 1}: ${run.toFixed(1)} s on the speaker with no insert — cut to the thing being described.`); run = 0; }
  });
  const used = beats.flatMap((b) => b.broll.map((x) => x.asset.id));
  const twice = [...new Set(used.filter((id, k) => used.indexOf(id) !== k))];
  if (twice.length) out.push(`Inserts ${twice.join(', ')} are used more than once — use each picture once.`);
  return out;
}
function draftOf(cut, fps) {
  return cut.beats.map((b, i) => ({
    n: i + 1,
    clip: b.cut[0].clip.id,
    seconds: Math.round(beatSec(b, fps) * 10) / 10,
    said: b.cut.flatMap((c) => c.words.map((w) => w.text)).join(' '),
    show: b.show,
    broll: b.broll.map((x) => x.asset.id),
  }));
}

// ── editor v2 polish: inserts long enough to read, no speaker flash between two ────────────────
// (studio's review: "inserts shown for only a moment before returning to the speaker"). In place,
// on output frames: bridge a short speaker gap between two inserts with the first insert, lift an
// insert to its minimum hold where there is room, drop one still too short to read, and keep the
// first seconds on the speaker's face.
function polishCutaways(list, { fps, spokenEnd, hookEnd = 0 }) {
  const f = (sec) => Math.round(sec * fps);
  const minOf = (c) => f(c.kind === 'video' ? MIN_VIDEO_SEC : MIN_IMAGE_SEC);
  const room = (c, want) => (c.kind === 'video' && c.maxFrames ? Math.min(want, c.maxFrames) : want);
  list.sort((a, b) => a.from - b.from);
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (c.from < hookEnd) {
      const cut = hookEnd - c.from;
      c.from = hookEnd;
      c.durationInFrames -= cut;
    }
    const next = list[i + 1];
    const limit = next ? next.from : spokenEnd;
    const end = c.from + c.durationInFrames;
    // a speaker gap too short to register → the insert runs on to the next one
    if (next && next.from - end > 0 && next.from - end < f(BRIDGE_SEC) && next.from - c.from <= f(5)) c.durationInFrames = room(c, next.from - c.from);
    // too short to read → stretched to the minimum where the next insert / the end allows
    if (c.durationInFrames < minOf(c)) c.durationInFrames = room(c, Math.min(minOf(c), limit - c.from));
  }
  // what is still too short to read goes; a dissolve into an insert that now follows a speaker shot is a push
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i].durationInFrames < f(1.1)) list.splice(i, 1);
  }
  list.forEach((c, i) => {
    const prev = list[i - 1];
    c.transition = prev && prev.from + prev.durationInFrames >= c.from - 1 ? 'fade' : 'soft';
    delete c.maxFrames;
  });
}

// ── phrase captions (editor v2): a whole short phrase on screen at once, one size, one place ────
// (studio's review: one word at a time and changing sizes were hard to follow). 2–5 words, broken at
// a pause, a sentence end or ~1.8 s; the beat's key words stay marked (`em`) and are coloured, not enlarged.
function phraseCues(list, fps) {
  const f = (t) => Math.max(0, Math.round(t * fps));
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  list.forEach((w, i) => {
    const prev = list[i - 1];
    // a new sentence starts a new caption — the transcript often has no full stops, so a capitalised
    // word ("So", "The", "That's") after a lower-case one marks it
    const sentence = /^\p{Lu}/u.test(w.text) && w.text !== 'I' && !/^I'/.test(w.text) && /\p{Ll}[^.!?]*$/u.test(prev?.text || '');
    if (cur.length && (cur.length >= 5 || w.start - prev.end > 0.35 || /[.!?;:]$/.test(prev.text) || sentence
      || (/,$/.test(prev.text) && cur.length >= 2) || w.end - cur[0].start > 1.8)) flush();
    cur.push(w);
  });
  flush();
  // a lone word joins its neighbour so the screen never flashes a single word
  for (let i = cues.length - 1; i > 0; i -= 1) {
    if (cues[i].length === 1 && cues[i][0].start - cues[i - 1][cues[i - 1].length - 1].end < 0.35 && cues[i - 1].length < 5) {
      cues[i - 1].push(...cues[i]);
      cues.splice(i, 1);
    }
  }
  return cues.map((ws, i) => {
    const next = cues[i + 1];
    const end = Math.min(next ? next[0].start : Infinity, ws[ws.length - 1].end + 0.35);
    const fromFrame = f(ws[0].start);
    return {
      fromFrame,
      toFrame: Math.max(fromFrame + 8, f(end)),
      words: ws.map((w, j) => ({
        text: w.text.replace(/^[^\p{L}\p{N}$#@"“'‘]+|[,;:]+$/gu, ''),
        fromFrame: f(w.start),
        toFrame: j < ws.length - 1 ? f(ws[j + 1].start) : f(end),
        ...(w.em ? { em: true } : {}),
      })).filter((w) => w.text),
    };
  }).filter((c) => c.words.length);
}

// ── narrative captions: 1–3 words at a time, a key word closes its group ─────
// (studio's reference reel: "little couple" small, then "hearts" large; the next
// thought starts a new group). Words keep their own timing so they appear as said.
function narrativeCues(list, fps) {
  const f = (t) => Math.max(0, Math.round(t * fps));
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  list.forEach((w, i) => {
    const prev = list[i - 1];
    if (cur.length && (cur.length >= 3 || w.start - prev.end > 0.3 || /[.!?,;:]$/.test(prev.text)
      || w.end - cur[0].start > 1.3 || (prev.em && !w.em) || (w.em && !prev.em && cur.length >= 2))) flush();
    cur.push(w);
  });
  flush();
  return cues.map((ws, i) => {
    const next = cues[i + 1];
    const end = Math.min(next ? next[0].start : Infinity, ws[ws.length - 1].end + 0.3);
    const fromFrame = f(ws[0].start);
    const toFrame = Math.max(fromFrame + 6, f(end));
    return {
      fromFrame,
      toFrame,
      words: ws.map((w, j) => ({
        text: w.text.replace(/^[^\p{L}\p{N}$#@"“'‘]+|[,;:]+$/gu, ''),
        fromFrame: f(w.start),
        toFrame: j < ws.length - 1 ? f(ws[j + 1].start) : toFrame,
        ...(w.em ? { em: true } : {}),
      })).filter((w) => w.text),
    };
  }).filter((c) => c.words.length);
}

// ── dialogue track: the chosen pieces, back to back, levelled ─────────────
// the dialogue's clean-up (2026-11-23, measured on studio takes: room noise floor −57…−60 dB → −85…−98 dB
// between words, speech level unchanged). REEL_DENOISE=off keeps the raw room sound.
const DENOISE = process.env.REEL_DENOISE === 'off' ? 'anull' : 'anlmdn=s=7:p=0.002:r=0.006,afftdn=nr=20:nf=-58:tn=1';
// a soft gate between words (−20 dB at most, slow release: no pumping on breaths)
const GATE = process.env.REEL_DENOISE === 'off' ? 'anull' : 'agate=threshold=0.012:ratio=3:range=0.1:attack=5:release=220:knee=4';
const XFADE = 0.05; // s of overlap at each join
// a chapter label must say something (studio review 2026-11-24: "THE RESULT" adds nothing when the
// finished project is on screen) — generic section names are dropped in code
const GENERIC_LABEL = /^\s*(the\s+|our\s+|a\s+)?(result|results|outcome|problem|challenge|brief|solution|process|before|after|reveal|final reveal|transformation|the end|intro|conclusion|step \d+|part \d+|finished|done)\s*[.!:]?\s*$/i;
const DISSOLVE = 4; // frames: a jump cut on the speaker dissolves
const DRAWING_READ_SEC = 1.0; // a drawing stays this long after its last element lands
const MAX_HOLD_SEC = 2.0; // the longest pause the edit will hold for a drawing

async function buildDialogueAudio(pieces, fps) {
  const { _clipFile, _ffmpegPath } = agent();
  const files = [];
  const index = new Map();
  for (const p of pieces) {
    if (!index.has(p.clip.key)) {
      // eslint-disable-next-line no-await-in-loop
      files.push(await _clipFile(p.clip.key));
      index.set(p.clip.key, files.length - 1);
    }
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reeldlg-'));
  const out = path.join(dir, 'dialogue.m4a');
  // clean voice (2026-11-23): each recording is denoised once, whole (one noise profile per take):
  // non-local means for the broadband room noise under the speech, FFT denoise for the steady hiss/hum
  const uses = files.map((_, k) => pieces.filter((p) => index.get(p.clip.key) === k).length);
  const sources = files.map((_, k) => `[${k}:a]aresample=48000,aformat=channel_layouts=mono,highpass=f=80,${DENOISE}`
    + (uses[k] > 1 ? `,asplit=${uses[k]}${Array.from({ length: uses[k] }, (_, u) => `[s${k}_${u}]`).join('')}` : `[s${k}_0]`));
  // smooth joins: every piece starts on its exact slot (words stay in sync with the picture) and runs
  // XFADE past its out-point, fading out while the next one fades in — a short crossfade on room tone,
  // never a hard edit or a hole
  const taken = files.map(() => 0);
  let at = 0;
  const parts = pieces.map((p, i) => {
    const k = index.get(p.clip.key);
    const label = `s${k}_${taken[k]}`;
    taken[k] += 1;
    const dur = p.frames / fps;
    const last = i === pieces.length - 1;
    const len = dur + (last ? 0 : XFADE);
    const fin = i === 0 ? 0.01 : Math.min(XFADE, dur / 4);
    const fout = last ? Math.min(0.03, dur / 4) : Math.min(XFADE * 2, dur / 3);
    const delay = Math.round(at * 1000);
    at += dur + (p.holdAfter || 0); // a pause the edit holds for a drawing to finish
    return `[${label}]atrim=start=${p.start.toFixed(3)}:duration=${len.toFixed(4)},asetpts=PTS-STARTPTS,`
      + `afade=t=in:d=${fin.toFixed(3)}:curve=qsin,afade=t=out:st=${Math.max(0, len - fout).toFixed(4)}:d=${fout.toFixed(3)}:curve=qsin,`
      + `adelay=delays=${delay}:all=1[a${i}]`;
  });
  const filter = `${sources.join(';')};${parts.join(';')};${pieces.map((_, i) => `[a${i}]`).join('')}amix=inputs=${pieces.length}:duration=longest:normalize=0,`
    + `apad=whole_dur=${at.toFixed(4)},atrim=duration=${at.toFixed(4)},${GATE},`
    + 'acompressor=threshold=-18dB:ratio=3:attack=8:release=120,loudnorm=I=-15:TP=-1.5:LRA=9,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono[out]';
  try {
    await run(_ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      ...files.flatMap((f) => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', out],
    { maxBuffer: 1 << 24, timeout: 180000 });
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A talking reel's director: the edit (one model call) → plan + a timeline
 * builder the pipeline calls once the music bed is ready.
 */
async function directDialogueReel({ reel, material, story, brand, handle }) {
  const fps = agent().FPS;
  const format = story.format;
  const phrasesByClip = new Map();
  material.assets.forEach((a) => {
    if (a.kind === 'video' && a.words?.length) phrasesByClip.set(a.id, phrasesOf(a));
  });
  if (!phrasesByClip.size) return null;

  let edit = await callEditor({ format, story, material, phrasesByClip, brand, handle });
  const debugRows = [edit.debug];
  let cut;
  const fill = (e) => {
    const { raw, added } = includeEveryTake(e.raw, material, phrasesByClip);
    if (added.length) console.log(`[reelFormat] ${reel._id} editor left out take(s) ${added.join(', ')} — added back in story order`);
    return { ...e, raw };
  };
  edit = fill(edit);
  try {
    cut = cutEdit({ raw: edit.raw, format, material, phrasesByClip, fps });
  } catch (err) {
    // one repair round with the reason
    edit = await callEditor({
      format, story, material, phrasesByClip, brand, handle,
      extra: `Your previous edit could not be used: ${err.message} Use only clip ids that have phrases, and phrase indices that exist.`,
    });
    debugRows.push(edit.debug);
    edit = fill(edit);
    cut = cutEdit({ raw: edit.raw, format, material, phrasesByClip, fps });
  }
  ensureBroll({ beats: cut.beats, pool: cut.pool, format, fps });

  // ── the review (editor v2): the draft is measured against the cut rules; when it breaks them the
  // editor gets its own draft back with the problems and returns a revised edit (one round)
  const issues = reviewIssues(cut, { fps, format });
  if (issues.length && process.env.REEL_EDIT_REVIEW !== 'off') {
    try {
      const revised = fill(await callEditor({
        format, story, material, phrasesByClip, brand, handle,
        extra: `REVIEW OF YOUR DRAFT EDIT — measured by Bauhly, fix every point and return the COMPLETE revised edit (same schema):\n${issues.map((x) => `- ${x}`).join('\n')}\n\nYOUR DRAFT:\n${JSON.stringify(draftOf(cut, fps), null, 1)}`,
      }));
      revised.debug.source = `${revised.debug.source} (review)`;
      debugRows.push(revised.debug);
      const recut = cutEdit({ raw: revised.raw, format, material, phrasesByClip, fps });
      ensureBroll({ beats: recut.beats, pool: recut.pool, format, fps });
      const after = reviewIssues(recut, { fps, format });
      if (after.length <= issues.length) { edit = revised; cut = recut; }
      console.log(`[reelFormat] ${reel._id} review: ${issues.length} issue(s) → ${after.length} after revision${after.length <= issues.length ? '' : ' (draft kept)'}`);
    } catch (err) {
      console.warn(`[reelFormat] ${reel._id} review failed, draft kept:`, err.message);
    }
  }

  onceEach(cut.beats, cut.pool);
  // cut accuracy (2026-11-23): every in/out point snapped to where the voice really starts and stops
  try {
    const snap = await require('./reelCutSnap').snapCuts(cut.beats, { fps, helpers: { clipFile: agent()._clipFile, ffmpegPath: agent()._ffmpegPath } });
    console.log(`[reelFormat] ${reel._id} cut snap: ${JSON.stringify(snap)}`);
    debugRows.push({ source: 'Capture reel — cut points snapped to the voice (code)', output: JSON.stringify(snap) });
    // pacing: real pauses where the reel should breathe (sentence ends, new points, before the close)
    const breath = await require('./reelCutSnap').breatheCuts(cut.beats, { fps, helpers: { clipFile: agent()._clipFile, ffmpegPath: agent()._ffmpegPath } });
    console.log(`[reelFormat] ${reel._id} pacing: ${JSON.stringify(breath)}`);
    debugRows.push({ source: 'Capture reel — pacing: pauses where the reel breathes (code)', output: JSON.stringify(breath) });
  } catch (err) {
    console.warn(`[reelFormat] ${reel._id} cut snap failed, transcript timings kept:`, err.message);
  }

  const raw = edit.raw || {};
  const hookText = words(str(raw.hook?.text, 80)).slice(0, 7).join(' ');
  const emph = str(raw.hook?.emphasis, 30);
  const hashtags = [...new Set((Array.isArray(raw.hashtags) ? raw.hashtags : [])
    .map((h) => str(h, 40).replace(/\s+/g, '')).map((h) => (h.startsWith('#') ? h : `#${h}`))
    .filter((h) => /^#[\p{L}\p{N}_]{2,}$/u.test(h)))].slice(0, 8);
  const endAsset = cut.byId.get(str(raw.endAssetId, 12));
  const m = raw.music || {};
  const plan = {
    concept: str(raw.concept, 400),
    format,
    audioMode: 'dialogue',
    hook: { text: hookText, emphasis: words(hookText).some((w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') === emph.toLowerCase()) ? emph : '' },
    beats: cut.beats.map((b) => ({
      clip: b.cut[0].clip.id,
      show: b.show,
      zoom: b.zoom,
      label: b.label,
      seconds: Math.round(b.cut.reduce((n, c) => n + c.frames / fps, 0) * 10) / 10,
      said: b.cut.flatMap((c) => c.words.map((w) => w.text)).join(' '),
      broll: b.broll.map((x) => x.asset.id),
    })),
    cta: { line: words(str(raw.cta?.line, 60)).slice(0, 8).join(' '), sub: str(raw.cta?.sub, 30) },
    caption: str(raw.caption, 2200) || story.caption || '',
    hashtags,
    warnings: cut.warnings,
    // the poster: the hook beat's face
    coverShotIndex: 0,
  };
  // the look: a styled reel (slam hook, karaoke captions, pill labels, end card)
  const style = {
    name: format,
    audio: {
      mode: 'voiceover',
      music: {
        mood: str(m.mood, 40) || 'warm, understated',
        genre: str(m.genre, 60) || 'soft modern instrumental',
        bpm: clampN(Math.round(num(m.bpm, 92)), 70, 110),
      },
    },
    hook: { treatment: 'slam' },
    text: { overlay: 'pill', textCase: 'sentence', font: 'sans-bold', color: '#FFFFFF', position: 'top' },
    captions: 'karaoke',
    cta: { endCard: 'card' },
    visuals: { grade: 'clean' },
  };

  const build = async ({ brandKit, music }) => {
    const { _imageSrc, _letterboxOf, _stillNear, captionCues, liftAccent, _luminance } = agent();
    const frames = (s) => Math.max(0, Math.round(s * fps));
    const pieces = cut.beats.flatMap((b) => b.cut);
    // (the dialogue track is built once the edit is final — after any pauses held for drawings)

    const speaker = [];
    const cutaways = [];
    const captionWords = [];
    let at = 0; // output frame
    let lastZoom = 0;
    let onSpeaker = 0;
    for (let bi = 0; bi < cut.beats.length; bi += 1) {
      const b = cut.beats[bi];
      const b0 = at;
      const litInBeat = new Set();
      for (let pi = 0; pi < b.cut.length; pi += 1) {
        const p = b.cut[pi];
        // steady framing (editor v2): one framing per stretch on the speaker. It changes only when
        // the speaker comes back from an insert, or once after REFRAME_SEC on camera — never on every
        // jump cut (that read as the camera shifting)
        let zoom = lastZoom || b.zoom;
        if (pi === 0 && bi > 0 && (cut.beats[bi - 1].broll.length || onSpeaker >= REFRAME_SEC)) {
          zoom = b.zoom !== lastZoom ? b.zoom : (lastZoom >= ZOOM.medium ? ZOOM.wide : ZOOM.medium);
          onSpeaker = 0;
        }
        if (zoom > ZOOM.medium && b.zoom !== ZOOM.close) zoom = ZOOM.medium;
        lastZoom = zoom;
        // never punch in past the source's resolution (a landscape take is already stretched ~1.8× to
        // fill the 9:16 frame — a 1.14 punch-in on top made it visibly soft, 2026-11-24)
        // eslint-disable-next-line no-await-in-loop
        const size = await agent()._videoSizeOf(p.clip.key).catch(() => null);
        const zoomCap = size ? Math.max(1, 1.15 / Math.max(1080 / size.w, 1920 / size.h)) : 1.15;
        const drawZoom = Math.min(zoom, zoomCap);
        onSpeaker += p.frames / fps;
        // eslint-disable-next-line no-await-in-loop
        const crop = p.clip.take?.role === 'speaking' ? null : await _letterboxOf(p.clip.key, p.start, p.frames / fps).catch(() => null);
        speaker.push({
          from: at,
          durationInFrames: p.frames,
          kind: 'video',
          src: await getMediaUrl(p.clip.key), // eslint-disable-line no-await-in-loop
          sourceStartSec: Math.round(p.start * 1000) / 1000,
          volume: 0, // the sound is the dialogue track
          motion: 'none',
          transition: 'cut',
          focusX: 50,
          focusY: 38,
          zoom: drawZoom,
          speaker: true,
          _src: { key: p.clip.key, kind: 'video' }, // for the caption contrast measure (removed before render)
          // narrative typography carries the structure: no chapter pills on the face
          ...(crop ? { crop } : {}),
        });
        p.words.forEach((w) => {
          // the beat's key words are set large (once each) — the captions follow what is being said
          const n = normWord(w.text);
          const em = Boolean(n) && b.emphasis.includes(n) && !litInBeat.has(n);
          if (em) litInBeat.add(n);
          captionWords.push({ text: w.text, start: at / fps + (w.start - p.start), end: at / fps + (w.end - p.start), em, beat: bi });
        });
        at += p.frames;
      }
      // B-roll over this beat (picture only — the voice runs on)
      if (b.broll.length) {
        const len = at - b0;
        // talking formats open on the face; a faceless reel never shows it
        const hookHold = bi === 0 && format !== 'faceless_voiceover' ? frames(1.5) : 0;
        const startOff = b.show === 'broll' || b.brollFrom === 'start' ? hookHold : Math.max(hookHold, frames(Math.max(1.0, (len / fps) * 0.4)));
        const span = len - startOff;
        if (span >= frames(0.8)) {
          const each = Math.floor(span / b.broll.length);
          for (let k = 0; k < b.broll.length; k += 1) {
            const x = b.broll[k];
            const from = b0 + startOff + k * each;
            const dur = k === b.broll.length - 1 ? b0 + len - from : each;
            // into B-roll on a soft push (blur + settle), between B-roll shots a short dissolve;
            // split = the B-roll takes the top half while the speaker stays below (never in a faceless reel)
            const split = b.layout === 'split' && format !== 'faceless_voiceover';
            const base = {
              _asset: x.asset,
              _beat: bi,
              from, durationInFrames: dur, motion: x.motion, transition: k === 0 ? 'soft' : 'fade',
              focusX: x.focusX, focusY: x.focusY,
              ...(split ? { layout: 'split' } : {}),
              ...(x.asset.width && x.asset.height ? { srcW: x.asset.width, srcH: x.asset.height } : {}),
            };
            if (x.asset.kind === 'image') {
              // eslint-disable-next-line no-await-in-loop
              cutaways.push({ ...base, _src: { key: x.asset.key, kind: 'image' }, kind: 'image', src: await _imageSrc(x.asset.key, 'clean'), graded: true, motion: x.motion === 'none' ? 'push-in' : x.motion });
            } else {
              const need = dur / fps;
              let start = x.startSec;
              let rate = 1;
              if (x.asset.durationSec - start < need) start = Math.max(0, x.asset.durationSec - need);
              if (x.asset.durationSec < need) rate = clampN(x.asset.durationSec / need, 0.6, 1); // gentle slow-mo to fill
              if (x.asset.durationSec / rate < need - 0.05) {
                const near = _stillNear(x.asset, start);
                // eslint-disable-next-line no-await-in-loop
                if (near) cutaways.push({ ...base, _src: { key: near.key, kind: 'image' }, kind: 'image', src: await _imageSrc(near.key, 'clean'), graded: true, motion: 'push-in' });
                continue;
              }
              // eslint-disable-next-line no-await-in-loop
              const crop = await _letterboxOf(x.asset.key, start, need).catch(() => null);
              cutaways.push({
                ...base, _src: { key: x.asset.key, kind: 'video' }, kind: 'video', src: await getMediaUrl(x.asset.key), // eslint-disable-line no-await-in-loop
                sourceStartSec: Math.round(start * 1000) / 1000, volume: 0, ...(rate < 1 ? { playbackRate: Math.round(rate * 100) / 100 } : {}),
                ...(crop ? { crop } : {}),
                maxFrames: Math.max(dur, Math.floor(((x.asset.durationSec - start) / rate) * fps)),
              });
            }
          }
        }
      }
    }
    let spokenEnd = at; // grows when the edit holds a pause for a drawing
    polishCutaways(cutaways, { fps, spokenEnd, hookEnd: format !== 'faceless_voiceover' ? frames(1.2) : 0 });
    // smooth joins (2026-11-23): a jump cut on the speaker dissolves over a few frames (the outgoing
    // piece runs on under the incoming one) — unless the take simply continues (no cut to hide)
    for (let i = 1; i < speaker.length; i += 1) {
      const prev = speaker[i - 1];
      const cur = speaker[i];
      if (cur.from !== prev.from + prev.durationInFrames) continue;
      const continuous = cur.src === prev.src
        && Math.abs(cur.sourceStartSec - (prev.sourceStartSec + prev.durationInFrames / fps)) < 0.08 && cur.zoom === prev.zoom;
      if (continuous) continue;
      prev.durationInFrames += DISSOLVE;
      cur.transition = 'fade';
    }
    // an insert leaving for the speaker fades out (the speaker is already underneath)
    cutaways.forEach((c) => {
      const end = c.from + c.durationInFrames;
      const next = cutaways.some((d) => d !== c && Math.abs(d.from - end) <= 1);
      if (!next && end < spokenEnd) c.exit = 'fade';
    });
    // end card: the best finished shot (or the last face, held) behind the CTA
    const hasCta = Boolean(plan.cta.line);
    const endFrames = hasCta ? frames(END_SEC) : frames(0.4);
    // not the photo the last cutaway just showed (the end card would look like a freeze)
    const lastShown = cut.beats[cut.beats.length - 1]?.broll.slice(-1)[0]?.asset.key || '';
    const images = cut.pool.filter((a) => a.kind === 'image');
    const endKey = (endAsset?.kind === 'image' && endAsset.key !== lastShown ? endAsset.key : '')
      || (images.find((a) => a.key !== lastShown && a.pool !== 'library') || images.find((a) => a.key !== lastShown) || images[0])?.key || '';
    if (endKey) {
      cutaways.push({ from: spokenEnd, durationInFrames: endFrames, _src: { key: endKey, kind: 'image' }, kind: 'image', src: await _imageSrc(endKey, 'clean'), graded: true, motion: 'pull-out', transition: 'zoom', focusX: 50, focusY: 45 });
    } else if (speaker.length) {
      speaker[speaker.length - 1].durationInFrames += endFrames;
    }
    // the hook reads first: the opening frame holds the title for a beat before the first word
    // (the take's own lead-in before the speaker starts talking, up to HOOK_LEAD_MAX)
    const firstPiece = pieces[0];
    const lead = plan.hook.text && firstPiece ? frames(clampN(firstPiece.start - LEAD, 0, HOOK_LEAD_MAX)) : 0;
    if (lead >= frames(0.3)) {
      [...speaker, ...cutaways].forEach((x) => { x.from += lead; });
      const first = speaker[0];
      first.from = 0;
      first.durationInFrames += lead;
      first.sourceStartSec = Math.max(0, Math.round((first.sourceStartSec - lead / fps) * 1000) / 1000);
      captionWords.forEach((w) => { w.start += lead / fps; w.end += lead / fps; });
    }
    const shift = lead >= frames(0.3) ? lead : 0;

    // ── the design agents (2026-11-22): captions and motion graphics, side by side, on the final cut ──
    const inserts = cutaways.filter((c) => c._asset);
    const spokenWords = captionWords.filter((w) => w.start < (spokenEnd + shift) / fps).map((w, i) => {
      const mid = ((w.start + w.end) / 2) * fps;
      const over = inserts.find((c) => mid >= c.from && mid < c.from + c.durationInFrames);
      return { ...w, i, on: !over ? 'speaker' : over.layout === 'split' ? 'split' : 'insert' };
    });
    const chapters = [];
    cut.beats.forEach((b, bi) => {
      if (!b.label || bi === 0) return;
      const first = spokenWords.find((w) => w.beat === bi);
      if (first) chapters.push({ text: b.label, fromFrame: frames(first.start), durationInFrames: frames(1.8) });
    });
    const story = [plan.concept, ...(plan.beats || []).map((b) => b.said)].join(' ').slice(0, 600);
    // the Brand Kit's colour roles, for the caption agent's key words (only real, distinct colours)
    const palette = Object.fromEntries(['accent', 'fg', 'ground']
      .map((r) => [r, String(brandKit[r] || '').trim()])
      .filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)));
    const design = require('./reelDesignAgents');
    const [capOut, motOut, expOut] = await Promise.all([
      design.designCaptions({ words: spokenWords, chapters: chapters.map((c) => c.text), story, palette })
        .catch((err) => { console.warn(`[reelFormat] ${reel._id} caption agent failed:`, err.message); return null; }),
      design.designGraphics({
        inserts: inserts.map((c, index) => ({
          index,
          asset: c._asset,
          seconds: c.durationInFrames / fps,
          said: spokenWords.filter((w) => w.start * fps >= c.from && w.start * fps < c.from + c.durationInFrames).map((w) => w.text).join(' '),
        })),
        visionParts: (list) => agent()._visionParts(list),
        story,
      }).catch((err) => { console.warn(`[reelFormat] ${reel._id} motion agent failed:`, err.message); return null; }),
      // the explainer specialist (2026-11-23): animated line drawings where they explain the words
      require('./reelExplainerAgent').designExplainers({
        words: spokenWords,
        inserts: inserts.map((c) => ({ fromSec: c.from / fps, toSec: (c.from + c.durationInFrames) / fps, shows: c._asset.summary || '' })),
        story,
        hookEndSec: (shift + frames(1.5)) / fps,
      }).catch((err) => { console.warn(`[reelFormat] ${reel._id} explainer agent failed:`, err.message); return null; }),
    ]);
    const designRows = [capOut?.debug, motOut?.debug, expOut?.debug].filter(Boolean);
    // a pause at the gap between two spoken words: the audio piece is split there (if the words are in one
    // piece) and holds silence after the first half; the speaker shot is split the same way so the
    // picture stays in sync after the pause. Returns the output frame where the pause starts.
    const splitForHold = (word, next, hold) => {
      let outStart = shift;
      for (let i = 0; i < pieces.length; i += 1) {
        const p = pieces[i];
        const outEnd = outStart + p.frames;
        const wf = frames(word.end);
        if (wf >= outStart && wf <= outEnd + 1) {
          const srcEnd = p.start + (word.end * fps - outStart) / fps; // the word's end in the take
          const k = p.words.findIndex((w) => Math.abs(w.end - srcEnd) < 0.25 && w.end <= srcEnd + 0.25);
          const isLast = k < 0 || k === p.words.length - 1 || frames(next.start) >= outEnd;
          if (isLast) {
            p.holdAfter = (p.holdAfter || 0) + hold / fps;
            return outEnd;
          }
          // split the piece in the gap after word k
          const gapMid = (p.words[k].end + p.words[k + 1].start) / 2;
          const off = Math.max(2, Math.min(p.frames - 2, Math.round((gapMid - p.start) * fps)));
          const p2 = { ...p, start: p.start + off / fps, frames: p.frames - off, words: p.words.slice(k + 1), holdAfter: p.holdAfter || 0 };
          p.frames = off;
          p.words = p.words.slice(0, k + 1);
          p.holdAfter = hold / fps;
          pieces.splice(i + 1, 0, p2);
          const T = outStart + off;
          // the speaker shot playing this piece: split at T (second half re-enters the take at the gap)
          const si = speaker.findIndex((sc) => sc.from <= T && sc.from + sc.durationInFrames > T && sc.src && sc._src?.key === p.clip.key);
          if (si >= 0) {
            const sc = speaker[si];
            const b2 = { ...sc, from: T, durationInFrames: sc.from + sc.durationInFrames - T, sourceStartSec: Math.round((sc.sourceStartSec + (T - sc.from) / fps) * 1000) / 1000, transition: 'cut' };
            sc.durationInFrames = T - sc.from;
            speaker.splice(si + 1, 0, b2);
          }
          return T;
        }
        outStart = outEnd + Math.round((p.holdAfter || 0) * fps);
      }
      return null;
    };
    // explainers → full-screen drawing cutaways: the speaker runs on underneath, inserts under a
    // drawing are trimmed (or dropped when < 0.8 s is left), a chapter title under one is dropped
    const explainerScenes = (expOut?.explainers || []).map((x) => ({
      from: frames(x.fromSec), durationInFrames: Math.max(1, frames(x.toSec) - frames(x.fromSec)),
      kind: 'card', src: '', motion: 'none', transition: 'fade', explainer: x.spec,
    }));
    // ── let every drawing finish (studio review 2026-11-24: "it rushes to the next frame without finishing
    // the animation — pause when required so the flow gets a natural finish") ──
    // A drawing needs its animation time + a beat to be read after its last element lands. When the
    // speaker moves on sooner, the edit HOLDS: the voice pauses between the drawing's last word and the
    // next one (the speaker clip runs on silently under the card), and everything after moves later.
    const holds = [];
    (expOut?.explainers || []).forEach((x, xi) => {
      const e = explainerScenes[xi];
      const spec = x.spec;
      const lastAt = Math.max(0, ...(spec.items || []).map((it) => Number(it.atSec) || 0));
      const anim = ['checklist', 'flow'].includes(spec.scene) ? frames(lastAt) + 18
        : spec.scene === 'open_plan' ? 56 : ['measure', 'light'].includes(spec.scene) ? 48 : 40;
      const need = anim + frames(DRAWING_READ_SEC);
      if (e.durationInFrames >= need) return;
      const next = spokenWords[x.to + 1];
      const nextAt = next ? frames(next.start) : spokenEnd + shift;
      const natural = nextAt - e.from; // the room before the speaker says the next word
      if (natural >= need) { e.durationInFrames = need; return; }
      e.durationInFrames = Math.max(e.durationInFrames, natural);
      const hold = Math.min(frames(MAX_HOLD_SEC), need - e.durationInFrames);
      if (hold >= 4 && next) holds.push({ x, e, word: spokenWords[x.to], next, hold });
    });
    // apply each hold at the gap after the drawing's last word, latest first so earlier frames stay valid
    holds.sort((a2, b2) => b2.next.start - a2.next.start).forEach(({ e, word, next, hold }) => {
      const T = splitForHold(word, next, hold);
      if (T == null) return;
      // everything from T on moves later; what spans T runs on (the card, an insert, the speaker)
      const move = (list) => list.forEach((c) => {
        if (c.from >= T) c.from += hold;
        else if (c.from + c.durationInFrames > T) c.durationInFrames += hold;
      });
      move(speaker);
      move(cutaways);
      explainerScenes.forEach((o) => { if (o !== e && o.from >= T) o.from += hold; });
      if (e.from + e.durationInFrames > T) e.durationInFrames += hold; else e.durationInFrames = T + hold - e.from;
      spokenWords.forEach((w) => { if (w.start * fps >= T) { w.start += hold / fps; w.end += hold / fps; } });
      chapters.forEach((ch) => { if (ch.fromFrame >= T) ch.fromFrame += hold; });
      spokenEnd += hold;
    });
    if (holds.length) {
      designRows.push({ source: 'Capture reel — pauses held for drawings (code)', output: JSON.stringify(holds.map((h) => ({ drawing: h.x.spec.title, pauseSec: Math.round((h.hold / fps) * 100) / 100, after: h.word.text }))) });
      console.log(`[reelFormat] ${reel._id} held ${holds.length} pause(s) for drawings: ${holds.map((h) => `${(h.hold / fps).toFixed(2)}s after "${h.word.text}"`).join(', ')}`);
    }

    explainerScenes.forEach((e) => {
      const a = e.from;
      const b = e.from + e.durationInFrames;
      for (let k = cutaways.length - 1; k >= 0; k -= 1) {
        const c = cutaways[k];
        const ca = c.from;
        const cb = c.from + c.durationInFrames;
        if (cb <= a || ca >= b || !c._asset) continue;
        const before = a - ca;
        const after = cb - b;
        if (before >= frames(0.8)) {
          c.durationInFrames = before; // keeps its start; the drawing cuts in over it
        } else if (after >= frames(0.8)) {
          const cutIn = b - ca;
          c.from = b;
          c.durationInFrames = after;
          if (c.kind === 'video' && c.sourceStartSec != null) c.sourceStartSec = Math.round((c.sourceStartSec + (cutIn / fps) * (c.playbackRate || 1)) * 1000) / 1000;
          c.transition = 'fade';
        } else {
          cutaways.splice(k, 1);
        }
      }
      for (let k = chapters.length - 1; k >= 0; k -= 1) {
        const ch = chapters[k];
        if (ch.fromFrame < b && a < ch.fromFrame + ch.durationInFrames) chapters.splice(k, 1);
      }
    });
    cutaways.push(...explainerScenes);
    cutaways.sort((x, y) => x.from - y.from);
    // graphics → annotations on the photo, or a ✓/✗ explainer card
    inserts.forEach((c, index) => {
      const g = motOut?.graphics?.get(index);
      if (!g) return;
      const at = Math.min(frames(0.4), Math.round(c.durationInFrames / 4));
      if (g.type === 'verdict') {
        // a white card under a chapter title would hide it: the chapter wins
        const underChapter = chapters.some((ch) => c.from < ch.fromFrame + ch.durationInFrames && ch.fromFrame < c.from + c.durationInFrames);
        // and next to a drawing it would repeat it: the drawing wins
        const nearDrawing = explainerScenes.some((e) => c.from < e.from + e.durationInFrames + frames(3) && e.from < c.from + c.durationInFrames + frames(3));
        if (!underChapter && !nearDrawing && c.layout !== 'split') c.card = { verdict: g.verdict, title: g.text };
        return;
      }
      if (c.layout === 'split') return;
      c.annotations = [g.type === 'measure'
        ? { type: 'measure', text: g.value, atFrame: at, box: { x: Math.min(g.x, g.x2), y: Math.min(g.y, g.y2), w: Math.abs(g.x2 - g.x), h: Math.abs(g.y2 - g.y) }, point: { x: g.x, y: g.y }, point2: { x: g.x2, y: g.y2 } }
        : { type: g.type, ...(g.text ? { text: g.text } : {}), atFrame: at, box: { x: clampN(g.x - 12, 0, 76), y: clampN(g.y - 12, 0, 76), w: 24, h: 24 }, point: { x: g.x, y: g.y } }];
    });
    // captions: the agent's groups (or the default phrase grouping when it failed)
    const captions = capOut?.cues?.length
      ? capOut.cues.map((cue, k) => {
        const ws = spokenWords.slice(cue.from, cue.to + 1);
        const next = capOut.cues[k + 1] ? spokenWords[capOut.cues[k + 1].from] : null;
        const end = Math.min(next ? next.start : Infinity, ws[ws.length - 1].end + 0.3);
        const fromFrame = frames(ws[0].start);
        const onScreen = ws[0].on;
        return {
          fromFrame,
          toFrame: Math.max(fromFrame + 8, frames(end)),
          key: cue.key >= 0 ? cue.key - cue.from : -1,
          keyStyle: cue.keyStyle,
          // position follows the shot, always (studio review 2026-11-24: captions hopping on one shot read as flicker)
          pos: onScreen === 'speaker' ? 'top' : onScreen === 'split' ? 'center' : 'lower',
          keyColorRole: cue.key >= 0 ? cue.keyColor : 'ink',
          words: ws.map((w, j) => ({
            text: w.text.replace(/^[^\p{L}\p{N}$#@"“'‘]+|[,;:]+$/gu, ''),
            fromFrame: frames(w.start),
            toFrame: j < ws.length - 1 ? frames(ws[j + 1].start) : frames(end),
          })),
        };
      }).filter((c) => c.words.some((w) => w.text))
      : phraseCues(spokenWords, fps);
    // contrast (2026-11-23): measure the picture behind every caption and chapter title; pick the ink,
    // a soft scrim where needed, and fit the Brand Kit colour so every word reads
    const sceneAt = (f) => {
      const cut = cutaways.filter((c) => f >= c.from && f < c.from + c.durationInFrames).pop();
      const sc = cut || speaker.find((c) => f >= c.from && f < c.from + c.durationInFrames);
      if (!sc) return null;
      if (sc.explainer || sc.card) return { card: true };
      if (sc.layout === 'split') return { split: true };
      if (!sc._src) return null;
      const into = (f - sc.from) / fps;
      return {
        key: sc._src.key, kind: sc._src.kind,
        atSec: sc._src.kind === 'video' ? (sc.sourceStartSec || 0) + into * (sc.playbackRate || 1) : 0,
        focusX: sc.focusX, focusY: sc.focusY, zoom: sc.zoom, crop: sc.crop,
      };
    };
    // one focus at a time (studio review 2026-11-24): a chapter label that only repeats what is being
    // said right then adds nothing — it goes
    for (let k = chapters.length - 1; k >= 0; k -= 1) {
      const ch = chapters[k];
      const said = new Set(spokenWords
        .filter((w) => w.start * fps >= ch.fromFrame - fps * 1.5 && w.start * fps < ch.fromFrame + ch.durationInFrames + fps * 0.5)
        .map((w) => normWord(w.text)).filter(Boolean));
      const content = words(ch.text).map(normWord).filter((w) => w && w.length > 2);
      if (content.length && content.filter((w) => said.has(w)).length >= Math.ceil(content.length / 2)) chapters.splice(k, 1);
    }
    const hookFrames = Math.max(shift + frames(0.6), frames(clampN(0.6 + words(plan.hook.text).length * 0.22, 1.3, 2.2)));
    // the kit's fonts as the renderer loads them: a stylesheet (Google / Fontshare) or the uploaded file
    const reelFonts = await (async () => {
      const f = brandKit.fonts;
      if (!f) return null;
      const out = {};
      for (const role of ['heading', 'body', 'detail']) {
        const v = f[role];
        if (!v?.family) continue;
        // eslint-disable-next-line no-await-in-loop
        const url = v.fileKey ? await getMediaUrl(v.fileKey).catch(() => '') : '';
        out[role] = { family: v.family, stack: v.stack || `'${v.family}', sans-serif`, ...(v.stylesheet ? { css: v.stylesheet } : {}), ...(url ? { url } : {}) };
      }
      return Object.keys(out).length ? out : null;
    })();
    const hookSpec = plan.hook.text ? { text: plan.hook.text, emphasis: plan.hook.emphasis, durationInFrames: hookFrames } : null;
    const contrast = await require('./reelCaptionContrast').applyCaptionContrast({
      captions, chapters, hook: hookSpec, sceneAt, palette,
      helpers: { clipFile: agent()._clipFile, ffmpegPath: agent()._ffmpegPath },
    }).catch((err) => { console.warn(`[reelFormat] ${reel._id} caption contrast failed:`, err.message); return null; });
    if (contrast) {
      designRows.push({ source: 'Capture reel — caption contrast (code)', output: JSON.stringify({ palette, ...contrast }) });
      console.log(`[reelFormat] ${reel._id} caption contrast: ${JSON.stringify(contrast)}`);
    }
    captions.forEach((c) => { delete c.keyColorRole; });
    inserts.forEach((c) => { delete c._asset; delete c._beat; });
    [...speaker, ...cutaways].forEach((c) => { delete c._src; });
    // the dialogue track: built now that the edit is final (pauses held for drawings included)
    const audio = await buildDialogueAudio(pieces, fps);
    const voiceKey = `projects/${reel.user}/reel-${reel._id}-dialogue.m4a`;
    await uploadBytes(voiceKey, audio, 'audio/mp4', { immutable: true });
    const voiceUrl = await getMediaUrl(voiceKey);
    const total = spokenEnd + shift + endFrames;
    const accent = liftAccent(brandKit.accent || '#FFFFFF');
    // narrative typography (studio's reference, 2026-11-21): a calm title, small words, the key word large
    const look = { ...require('./reelStyleRun').lookOf(style), hook: 'title', captions: capOut?.cues?.length ? 'twovoice' : 'narrative', progress: false };
    return {
      voiceKey,
      timeline: {
        format: { width: 1080, height: 1920, fps, durationInFrames: total },
        brand: {
          accent,
          accentInk: _luminance(accent) > 0.45 ? '#111111' : '#FFFFFF',
          headlineFont: brandKit.headlineFont || '',
          bodyFont: brandKit.bodyFont || '',
          // Brand Kit typography for every word (studio review 2026-11-24: "use only the Brand Kit fonts")
          ...(reelFonts ? { fonts: reelFonts } : {}),
          // Brand Kit colours for what Bauhly draws (explainers, ✓/✗ cards) — remotion/src/brandPalette.ts
          ...(Object.keys(palette).length ? { palette } : {}),
        },
        ...(hookSpec ? { hook: hookSpec } : {}),
        // speaker shots first, cutaways after: later scenes draw on top
        scenes: [...speaker, ...cutaways],
        captions,
        ...(chapters.length ? { chapters } : {}),
        ...(hasCta ? { cta: { line: plan.cta.line, sub: plan.cta.sub, fromFrame: spokenEnd + shift, durationInFrames: endFrames } } : {}),
        audio: { voiceoverSrc: voiceUrl, voiceVolume: 1, startFrame: shift },
        look,
      },
      debugRows: designRows,
      stats: {
        spokenSec: Math.round((spokenEnd / fps) * 10) / 10,
        brollShare: Math.round((cutaways.filter((c) => c.from < spokenEnd).reduce((n, c) => n + Math.min(c.durationInFrames, spokenEnd - c.from), 0) / Math.max(1, spokenEnd)) * 100),
        pieces: pieces.length,
      },
    };
  };

  return { plan, style, model: edit.model, debugRows, build };
}

// ── Faceless · Text: a story told in lines over footage, cut to music ──────
async function directFacelessText({ material, story, brand, handle, directReel }) {
  const style = {
    name: 'Faceless · Text',
    summary: 'Story reel: one short readable line per shot over project footage, original music bed, cuts on the beat.',
    audio: { mode: 'music', music: { mood: 'warm, confident', genre: 'modern minimal instrumental with a soft pulse', bpm: 100 } },
    pacing: { hookHoldSec: 1.9, shotSec: 2.2, beatSync: true, targetLengthSec: clampN((story.estimatedSec?.[1] || 20), 12, 30) },
    hook: { treatment: 'slam' },
    text: { overlay: 'bold-sans', perShot: 'every-shot', textCase: 'sentence', font: 'sans-bold', color: '#FFFFFF', position: 'center', kinetic: true },
    captions: 'none',
    chapters: { numbered: false, card: 'none' },
    cta: { endCard: 'card' },
    visuals: { grade: 'clean' },
    directorNotes: 'Every shot carries one line of the story plan. Readable, not decorative.',
  };
  const direction = `STORY PLAN (tell exactly this story, in this order):\n${JSON.stringify(story.sequences.map((s, i) => ({
    n: i + 1, role: s.role, line: s.onScreenText || s.say, seconds: s.targetSec,
  })), null, 2)}`;
  const directed = await directReel({ material, handle, brand, direction, style, extraRules: read('faceless-text.md') });
  // reading time: N words need ≥ 0.9 s + 0.3 s each
  directed.plan.scenes.forEach((s, i) => {
    const n = words(String(s.overlayText || '').replace(/\|/g, ' ')).length;
    if (n) s.durationSec = Math.max(s.durationSec, Math.min(5.5, 0.9 + 0.3 * n + (i === 0 ? 0.4 : 0)));
  });
  directed.plan.format = 'faceless_text';
  return { ...directed, style };
}

// Motion graphics (2026-11-19): the default director (reelDirectorDefault.js)
// with its teaser limits replaced — longer, text on every shot, more overlays
const MOTION_GRAPHICS_LOOK = {
  name: 'Motion graphics',
  target: [15, 30],
  maxOverlays: 12,
  get extraRules() { return read('motion-graphics.md'); },
};

module.exports = {
  DIALOGUE_FORMATS,
  includeEveryTake,
  MOTION_GRAPHICS_LOOK,
  directDialogueReel,
  directFacelessText,
  // exported for tests
  phrasesOf,
  cutEdit,
  ensureBroll,
  buildDialogueAudio,
  EDIT_TOOL,
};
