/*
 * Talking-reel design agents (studio, 2026-11-22) — two specialists that run AFTER the cut agent
 * (reelFormatDirector's editor) has fixed the edit, side by side:
 *
 *   Caption agent  (prompts/reel-agents/captions.md) — reads every spoken word with its time and
 *                  what is on screen, and designs the captions so they follow the narrative: 2–5
 *                  word groups, one key word per group set large in a face chosen by meaning
 *                  (condensed sans for things/numbers, display serif for qualities/verdicts,
 *                  spaced letters for an airy word), position by shot (top on the speaker, lower
 *                  third on inserts, seam on splits). Style from the studio's reference reel.
 *   Motion agent   (prompts/reel-agents/motion.md) — sees each insert's photo and the words said
 *                  over it, and draws only what explains them: label, arrow, circle, spotlight,
 *                  a measurement line, or a ✓/✗ verdict card.
 *
 * Everything they return is checked in code: captions are re-tiled to cover every word once
 * (gaps filled by the default phrase grouping), graphics are clamped and limited.
 * Model: Claude Sonnet 5.5 (2026-11-23) through completeToolCall's Claude JSON mode (Sonnet 5.5 can't be
 * forced to call a tool); REEL_CAPTION_MODEL / REEL_MOTION_MODEL override.
 */
const fs = require('fs');
const path = require('path');
const { completeToolCall } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');

const DIR = path.join(__dirname, '..', '..', 'prompts', 'reel-agents');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const o = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

const KEY_STYLES = ['condensed', 'serif', 'spaced', 'none'];
const POSITIONS = ['top', 'lower', 'center'];
const GRAPHIC_TYPES = ['none', 'label', 'arrow', 'circle', 'spotlight', 'measure', 'verdict'];

const CAPTION_TOOL = {
  name: 'design_captions',
  description: 'The on-screen captions of a talking reel, grouped and styled to follow the narrative.',
  input_schema: o({
    captions: {
      type: 'array',
      items: o({
        from: { type: 'integer' },
        to: { type: 'integer' },
        key: { type: 'integer' },
        keyStyle: { type: 'string', enum: KEY_STYLES },
        position: { type: 'string', enum: POSITIONS },
      }),
    },
  }),
};

const MOTION_TOOL = {
  name: 'design_graphics',
  description: 'The motion graphic (or none) for each insert of a talking reel.',
  input_schema: o({
    graphics: {
      type: 'array',
      items: o({
        insert: { type: 'integer' },
        type: { type: 'string', enum: GRAPHIC_TYPES },
        text: { type: 'string' },
        value: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
        verdict: { type: 'string', enum: ['good', 'bad', 'none'] },
      }),
    },
  }),
};

// Claude Sonnet 5.5 for both (studio, 2026-11-23); REEL_CAPTION_MODEL / REEL_MOTION_MODEL override
const DEFAULT_MODEL = 'claude-sonnet-5-5';

async function call({ tool, system, userParts, kind, envModel }) {
  const model = process.env[envModel] || DEFAULT_MODEL;
  const started = Date.now();
  const res = await completeToolCall({
    model, system, userParts, tool, maxTokens: 8000, kind, timeoutMs: 180000,
    retryHint: `Return ONLY the JSON object for ${tool.name}, matching the schema exactly.`,
  });
  const u = res.usage || {};
  return {
    parsed: res.parsed || {},
    debug: {
      source: kind === 'reelCaptions' ? 'Capture reel — caption agent' : 'Capture reel — motion graphics agent',
      model: res.model,
      prompt: `${system}\n\n---\n\n${userParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')}`,
      output: JSON.stringify(res.parsed, null, 2),
      elapsedMs: Date.now() - started,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd: estimatePlanCostUsd(res.model, num(u.input_tokens), num(u.output_tokens), num(u.cached_tokens)),
    },
  };
}

/**
 * words: [{ i, text, start, end, on }] (output seconds, in order). Returns
 * [{ from, to, key, keyStyle, position }] covering every word once, or null on failure.
 */
async function designCaptions({ words, chapters = [], story = '' }) {
  if (!words.length) return { cues: [], debug: null };
  const user = JSON.stringify({
    story: str(story, 300),
    chapters,
    words: words.map((w) => ({ i: w.i, w: w.text, t: Math.round(w.start * 10) / 10, on: w.on })),
  });
  const { parsed, debug } = await call({
    tool: CAPTION_TOOL, system: read('captions.md'), userParts: [{ type: 'text', text: user }],
    kind: 'reelCaptions', envModel: 'REEL_CAPTION_MODEL',
  });
  return { cues: cleanCaptions(parsed.captions, words), debug };
}

/* the agent's groups, re-tiled: every word once, in order, 1–6 words a group */
function cleanCaptions(list, words) {
  const n = words.length;
  const taken = new Array(n).fill(false);
  const out = [];
  (Array.isArray(list) ? list : [])
    .map((c) => ({ from: Math.round(num(c?.from, -1)), to: Math.round(num(c?.to, -1)), key: Math.round(num(c?.key, -1)), keyStyle: c?.keyStyle, position: c?.position }))
    .filter((c) => c.from >= 0 && c.to >= c.from && c.to < n && c.to - c.from < 6)
    .sort((a, b) => a.from - b.from)
    .forEach((c) => {
      for (let k = c.from; k <= c.to; k += 1) if (taken[k]) return;
      for (let k = c.from; k <= c.to; k += 1) taken[k] = true;
      const hasKey = c.key >= c.from && c.key <= c.to && KEY_STYLES.includes(c.keyStyle) && c.keyStyle !== 'none';
      out.push({
        from: c.from,
        to: c.to,
        key: hasKey ? c.key : -1,
        keyStyle: hasKey ? c.keyStyle : 'none',
        position: POSITIONS.includes(c.position) ? c.position : null,
      });
    });
  // words the agent left out: grouped by pause (≤ 4 words), no key word
  let k = 0;
  while (k < n) {
    if (taken[k]) { k += 1; continue; }
    const from = k;
    let to = k;
    while (to + 1 < n && !taken[to + 1] && to - from < 3 && words[to + 1].start - words[to].end < 0.35) to += 1;
    for (let m = from; m <= to; m += 1) taken[m] = true;
    out.push({ from, to, key: -1, keyStyle: 'none', position: null });
    k = to + 1;
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * inserts: [{ index, asset, said, seconds }] — asset = the material asset (image/video).
 * visionParts(assets) → image parts labelled by asset id. Returns Map(insert index → graphic).
 */
async function designGraphics({ inserts, visionParts, story = '' }) {
  if (!inserts.length) return { graphics: new Map(), debug: null };
  const assets = [...new Map(inserts.map((x) => [x.asset.id, x.asset])).values()];
  const images = await visionParts(assets).catch(() => []);
  const user = JSON.stringify({
    story: str(story, 300),
    inserts: inserts.map((x) => ({
      insert: x.index,
      id: x.asset.id,
      type: x.asset.kind === 'image' ? 'photo' : 'clip',
      seconds: Math.round(x.seconds * 10) / 10,
      said: str(x.said, 300),
      shows: str(x.asset.summary, 160),
      subjects: (x.asset.subjectBoxes || []).map((s) => ({ name: s.name, box: s.box })).slice(0, 8),
    })),
  });
  const { parsed, debug } = await call({
    tool: MOTION_TOOL, system: read('motion.md'), userParts: [...images, { type: 'text', text: user }],
    kind: 'reelMotion', envModel: 'REEL_MOTION_MODEL',
  });
  return { graphics: cleanGraphics(parsed.graphics, inserts), debug };
}

function cleanGraphics(list, inserts) {
  const byIndex = new Map(inserts.map((x) => [x.index, x]));
  const out = new Map();
  let verdicts = 0;
  let lastVerdict = -9;
  (Array.isArray(list) ? list : []).forEach((g) => {
    const ins = byIndex.get(Math.round(num(g?.insert, -1)));
    const type = GRAPHIC_TYPES.includes(g?.type) ? g.type : 'none';
    if (!ins || type === 'none' || out.has(ins.index)) return;
    const photo = ins.asset.kind === 'image';
    if (!photo && !['label', 'arrow'].includes(type)) return;
    if (ins.seconds < 1.4) return; // too short to read a graphic
    const text = str(g.text, 40).split(' ').slice(0, type === 'verdict' ? 5 : 4).join(' ').replace(/[.!]+$/, '');
    if (type === 'verdict') {
      if (verdicts >= 2 || ins.index - lastVerdict <= 1 || !text) return;
      verdicts += 1;
      lastVerdict = ins.index;
      out.set(ins.index, { type, text, verdict: g.verdict === 'good' ? 'good' : 'bad' });
      return;
    }
    const x = clampN(num(g.x, 50), 4, 96);
    const y = clampN(num(g.y, 50), 4, 96);
    if (type === 'measure') {
      const value = str(g.value, 10);
      const x2 = clampN(num(g.x2, x), 4, 96);
      const y2 = clampN(num(g.y2, y), 4, 96);
      if (!value || Math.hypot(x2 - x, y2 - y) < 12) return; // a measurement needs two real ends
      out.set(ins.index, { type, value, x, y, x2, y2 });
      return;
    }
    out.set(ins.index, { type, text, x, y });
  });
  // at most ~40 % of inserts carry a graphic: keep the earliest ones past the limit? keep verdicts/measures first
  const cap = Math.max(1, Math.round(inserts.length * 0.4));
  if (out.size > cap) {
    const order = [...out.entries()].sort((a, b) => (['verdict', 'measure'].includes(b[1].type) - ['verdict', 'measure'].includes(a[1].type)) || a[0] - b[0]);
    return new Map(order.slice(0, cap).sort((a, b) => a[0] - b[0]));
  }
  return out;
}

module.exports = { designCaptions, designGraphics, cleanCaptions, cleanGraphics, CAPTION_TOOL, MOTION_TOOL };
