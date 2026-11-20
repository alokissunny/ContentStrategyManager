/*
 * Motion graphic reel — PLANNER + GUARD + COMPILER (studio's guidance, 2026-11-19).
 *
 *   selector (motionReelSelector.js) → planner LLM (prompts/motion-reel-planner.md,
 *   the studio's own system prompt) → cleanMotionPlan (code guard: valid formats
 *   only, allowed accents, fact guard on every number, copy limits, asset ids,
 *   lengths, no gaps) → compileMotionTimeline (frames + media for the Remotion
 *   MotionReel inside the CaptureReel composition, remotion/src/MotionReel.tsx).
 *
 * The planner never decides validity and never writes video code; anything it
 * gets wrong is repaired here, so a reel is always made.
 */

const fs = require('fs');
const path = require('path');
const { completeText } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { getMediaUrl } = require('./s3Client');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'motion-reel-planner.md');
// Claude Sonnet 5.5 at the studio's request (2026-11-19) — an exception to the
// OpenAI-by-default rule; MOTION_REEL_MODEL overrides
const plannerModel = () => process.env.MOTION_REEL_MODEL || 'claude-sonnet-5-5';

const ACCENTS = {
  before_after_wipe: { fact_captions: 3, stat_badge: 1, hotspot_tags: 3 },
  ken_burns: { fact_captions: 6, stat_badge: 1, palette_strip: 1 },
  stat_counter: { fact_captions: 3 },
  listicle_tips: { hotspot_tags: 5 },
  hotspot_callouts: { fact_captions: 1, stat_badge: 1 },
  palette_extract: { fact_captions: 3 },
  grid_build: { fact_captions: 4, poll_sticker: 1 },
  kinetic_hook: {},
  motion_story: {},
};

// motion_story: one animated scene per beat, chosen by what the beat says
// (remotion/src/motionStory.tsx). Seconds = how long each scene needs to land.
const SCENES = {
  slam: 2.3, strike_swap: 3.0, prompt_type: 3.4, marker: 2.6, checklist: 3.4, split: 2.8, stamp: 2.8, circle: 2.6,
  photo_reveal: 3.0, zoom_punch: 2.8, polaroid: 3.0,
};
// scenes that ARE a picture (they need one)
const PICTURE_SCENES = new Set(['photo_reveal', 'zoom_punch', 'polaroid']);
const STOP = /^(the|and|for|with|your|our|you|we|are|was|that|this|from|into|not|but|its|it's|they|them|their|have|has|will|can|just|more|than|what|when|how|why|a|an|of|to|in|on|is|it|do|don't|dont)$/i;
const normWord = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// the word a line hangs on: the longest content word
function keyWordOf(text) {
  return wordsOf(text).map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter((w) => w && !STOP.test(w))
    .sort((a, b) => b.length - a.length)[0] || '';
}
// a scene from the words alone (when the planner named none, or one the beat can't carry)
function sceneFor(text, i) {
  if (/\b(ai|a\.i\.|prompt\w*|chatgpt|gpt|digital|software|app|apps|tool|tools|automat\w*|online|algorithm\w*|generat\w*)\b/i.test(text)) return 'prompt_type';
  if (/\b(not|don't|dont|never|no|isn't|won't|stop|instead|without|myth|wrong)\b/i.test(text)) return 'stamp';
  if (i === 0) return 'slam';
  return ['marker', 'circle', 'slam'][i % 3];
}
const MOODS = {
  'warm-upbeat': { mood: 'warm, upbeat, confident', genre: 'modern acoustic-electronic with a light groove', bpm: 108 },
  'calm-ambient': { mood: 'calm, airy, refined', genre: 'ambient minimal piano and soft pads with a gentle pulse', bpm: 90 },
  'bright-pop': { mood: 'bright, playful, fresh', genre: 'light indie-pop instrumental', bpm: 118 },
  'moody-cinematic': { mood: 'moody, cinematic, luxurious', genre: 'cinematic minimal with deep bass and soft strings', bpm: 96 },
};

const str = (v, n = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (n) => Math.round(n * 100) / 100;
const wordsOf = (s) => String(s || '').split(/\s+/).filter(Boolean);

let promptCache = null;
function prompt() {
  promptCache ||= fs.readFileSync(PROMPT_FILE, 'utf8');
  const [system, user] = promptCache.split('---USER---');
  return { system: system.trim(), user: user.trim() };
}

// ── copy hygiene ──────────────────────────────────────────────────────────────

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
function onVideo(text, maxWords, { stop = false } = {}) {
  let t = String(text || '').replace(EMOJI, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  const w = wordsOf(t);
  if (w.length > maxWords) t = w.slice(0, maxWords).join(' ');
  if (stop) t = t.replace(/[.。]+$/u, '');
  return t;
}

// The fact guard: every number on screen must be one the studio stated
// (project.metrics, or a product's price), written as they wrote it.
function factGuard(ctx) {
  const allowed = [
    ...Object.values(ctx.project.metrics).map((m) => m.text),
    ...ctx.project.products.map((p) => p.price).filter(Boolean),
  ].map((t) => t.toLowerCase().replace(/[\s,]/g, ''));
  return (text) => {
    const nums = String(text || '').match(/\d[\d,.]*/g) || [];
    return nums.every((n) => {
      const k = n.replace(/[,]/g, '').replace(/\.$/, '');
      return allowed.some((a) => a.includes(k));
    });
  };
}

// ── the model call ───────────────────────────────────────────────────────────

function parseJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON object in the answer');
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('the JSON answer was cut off');
}

async function callPlanner(ctx, request, extra = '') {
  const { system, user: tpl } = prompt();
  const strip = (o) => JSON.stringify(o, null, 1);
  const user = tpl
    .replace('{{REQUEST}}', request || '')
    .replace('{{PROJECT}}', strip(ctx.project))
    .replace('{{ASSETS}}', strip(ctx.capture))
    .replace('{{OPTIONS}}', strip(ctx.options))
    .replace('{{BRAND_KIT}}', strip(ctx.brandKit)) + (extra ? `\n\n${extra}` : '');
  const model = plannerModel();
  const started = Date.now();
  const res = await completeText({
    model, system, user, maxTokens: 6000, kind: 'captureReel', reasoningEffort: 'medium', timeoutMs: 180000, cacheKey: 'motion-reel-planner',
  });
  const usage = res.usage || {};
  const costUsd = estimatePlanCostUsd(res.model || model, num(usage.input_tokens), num(usage.output_tokens), num(usage.cached_tokens), num(usage.cache_write_tokens));
  let raw = null; let error = '';
  try { raw = parseJson(res.text); } catch (err) { error = err.message; }
  return {
    raw, error, model: res.model || model, costUsd,
    debug: {
      source: 'Capture reel — motion graphics planner', model: res.model || model,
      prompt: `${system}\n\n---\n\n${user}`, output: res.text, elapsedMs: Date.now() - started,
      inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens), costUsd,
      ...(error ? { note: `unreadable: ${error}` } : {}),
    },
  };
}

// ── the guard: whatever the planner returned becomes a valid plan ────────────

function cleanMotionPlan(raw, ctx) {
  const warnings = [];
  const ok = factGuard(ctx);
  const opt = new Map(ctx.options.map((o) => [o.formatId, o.status]));
  const usable = (id) => opt.get(id) === 'valid' || opt.get(id) === 'recommended';
  const recommended = ctx.options.find((o) => o.status === 'recommended')?.formatId || 'kinetic_hook';
  const A = new Map(ctx.capture.assets.map((a) => [a.assetId, a]));
  const shown = ctx.capture.assets.filter((a) => a.stage !== 'before');
  const bySharp = [...shown].sort((x, y) => (y.wide - x.wide) || (y.sharpness - x.sharpness));
  const isAsset = (id) => A.has(id);
  const p = raw && typeof raw === 'object' ? raw : {};
  const segs = Array.isArray(p.segments) ? p.segments : [];
  const segOf = (type) => segs.find((s) => s?.type === type) || null;
  let mainRaw = segOf('main') || segs.find((s) => s?.formatId && s.formatId !== 'kinetic_hook' && s.formatId !== 'cta_end_card') || {};
  let main = usable(p.mainFormat) && p.mainFormat !== 'cta_end_card' ? p.mainFormat : (usable(mainRaw.formatId) ? mainRaw.formatId : recommended);
  if (main !== mainRaw.formatId) mainRaw = { formatId: main, props: {} };
  const props = mainRaw.props && typeof mainRaw.props === 'object' ? mainRaw.props : {};
  const ids = (list) => (Array.isArray(list) ? list : []).map(String).filter(isAsset);
  const products = ctx.project.products;

  // main props, repaired against the selector
  const build = (fmt) => {
    if (fmt === 'before_after_wipe') {
      const pair = ctx.capture.pairs.find((x) => x.aligned);
      if (!pair) return null;
      const w = props.wipe || {};
      return {
        beforeAssetId: pair.beforeAssetId, afterAssetId: pair.afterAssetId,
        wipe: { direction: w.direction === 'rtl' ? 'rtl' : 'ltr', startSec: clamp(num(w.startSec, 1.2), 0.5, 3), durationSec: clamp(num(w.durationSec, 2.2), 1.4, 3) },
        labels: { before: onVideo(props.labels?.before || 'Before', 2), after: onVideo(props.labels?.after || 'After', 2) },
      };
    }
    if (fmt === 'ken_burns') {
      let list = ids(props.assetIds).filter((id) => A.get(id).stage !== 'before');
      bySharp.forEach((a) => { if (list.length < 3 && !list.includes(a.assetId)) list.push(a.assetId); });
      list = [...new Set(list)].slice(0, 6);
      return list.length >= 3 ? { assetIds: list } : null;
    }
    if (fmt === 'stat_counter') {
      const metrics = Object.values(ctx.project.metrics).map((m) => m.text);
      const stats = (Array.isArray(props.stats) ? props.stats : [])
        .map((s) => ({ value: str(s?.value, 24), label: onVideo(s?.label, 4, { stop: true }) }))
        .filter((s) => s.value && metrics.some((m) => m.toLowerCase().replace(/\s/g, '') === s.value.toLowerCase().replace(/\s/g, '')) && ok(s.label))
        .slice(0, 3);
      if (!stats.length) return null;
      const bg = isAsset(props.backgroundAssetId) ? props.backgroundAssetId : bySharp[0]?.assetId;
      return { stats, ...(bg ? { backgroundAssetId: bg } : {}) };
    }
    if (fmt === 'listicle_tips') {
      const facts = new Map(ctx.project.facts.map((f) => [f.id, f]));
      const tips = (Array.isArray(props.tips) ? props.tips : [])
        .map((t) => ({ title: onVideo(t?.title, 5, { stop: true }), factId: facts.has(t?.factId) ? t.factId : '' }))
        .filter((t) => t.title && t.factId && ok(t.title))
        .slice(0, 5);
      if (tips.length < 3) return null;
      const bg = isAsset(props.backgroundAssetId) ? props.backgroundAssetId : '';
      return { title: onVideo(props.title, 5, { stop: true }), tips, ...(bg ? { backgroundAssetId: bg } : {}) };
    }
    if (fmt === 'hotspot_callouts') {
      const count = (id) => products.filter((x) => x.assetId === id).length;
      const best = [...new Set(products.map((x) => x.assetId))].sort((x, y) => count(y) - count(x))[0];
      const assetId = isAsset(props.assetId) && count(props.assetId) >= 2 ? props.assetId : best;
      if (!assetId) return null;
      let pids = (Array.isArray(props.productIds) ? props.productIds : []).filter((id) => products.some((x) => x.productId === id && x.assetId === assetId));
      if (pids.length < 2) pids = products.filter((x) => x.assetId === assetId).map((x) => x.productId);
      return pids.length >= 2 ? { assetId, productIds: pids.slice(0, 4) } : null;
    }
    if (fmt === 'palette_extract') {
      const colourful = ctx.capture.assets.filter((a) => a.stage === 'finished' && !a.neutral && a.swatches.length >= 3);
      const assetId = colourful.some((a) => a.assetId === props.assetId) ? props.assetId
        : [...colourful].sort((x, y) => y.swatchSpread - x.swatchSpread)[0]?.assetId;
      return assetId ? { assetId, swatchCount: clamp(Math.round(num(props.swatchCount, 4)), 3, Math.min(5, A.get(assetId).swatches.length)) } : null;
    }
    if (fmt === 'grid_build') {
      let tiles = (Array.isArray(props.tiles) ? props.tiles : [])
        .filter((t) => isAsset(t?.assetId) && A.get(t.assetId).stage !== 'before')
        .map((t) => ({ assetId: t.assetId, label: ok(t.label) ? onVideo(t.label, 3, { stop: true }) : '' }));
      bySharp.forEach((a) => { if (tiles.length < 4 && !tiles.some((t) => t.assetId === a.assetId)) tiles.push({ assetId: a.assetId, label: '' }); });
      tiles = tiles.slice(0, 4);
      return tiles.length === 4 ? { tiles, variant: props.variant === 'options' ? 'options' : 'rooms' } : null;
    }
    if (fmt === 'motion_story') {
      let beats = storyBeats(props.beats);
      if (beats.length < 2) beats = beatsFromFacts();
      return beats.length >= 2 ? { beats } : null;
    }
    return null;
  };

  // motion_story beats, repaired: valid scene for what it carries, copy limits,
  // facts, a key word that is in the line, and never the same scene twice running
  const storyBeats = (list) => {
    const out = [];
    (Array.isArray(list) ? list : []).slice(0, 7).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      let scene = SCENES[b.scene] ? b.scene : '';
      let text = onVideo(b.text, 8, { stop: true });
      if (text && !ok(text)) text = '';
      const beat = {};
      // the picture it plays over / shows (a photo or a clip still — a clip plays)
      const pic = isAsset(String(b.assetId || '')) ? String(b.assetId) : '';
      const pics = ids(b.assetIds).slice(0, 2);
      if (pic) beat.assetId = pic;
      if (PICTURE_SCENES.has(scene) && !pic) scene = '';
      if (scene === 'polaroid' && pics.some((x) => x !== pic)) beat.assetIds = [pic, pics.find((x) => x !== pic)];
      if (scene === 'split' && pics.length === 2) beat.assetIds = pics;
      if (scene === 'strike_swap') {
        const struck = onVideo(b.struck, 4, { stop: true });
        if (struck && ok(struck) && text) beat.struck = struck; else scene = '';
      }
      if (scene === 'checklist') {
        const items = (Array.isArray(b.items) ? b.items : []).map((x) => onVideo(x, 4, { stop: true })).filter((x) => x && ok(x)).slice(0, 4);
        if (items.length >= 2) beat.items = items; else scene = '';
      }
      if (scene === 'split') {
        const left = onVideo(b.left, 4, { stop: true }); const right = onVideo(b.right, 4, { stop: true });
        if (left && right && ok(left) && ok(right)) { beat.left = left; beat.right = right; if (!text) text = `${left} vs ${right}`; } else scene = '';
      }
      if (!text && scene !== 'checklist') return;
      if (!scene) scene = sceneFor(text, out.length);
      if (scene === 'stamp') {
        const st = onVideo(b.stampText, 2, { stop: true });
        beat.stampText = st && ok(st) ? st : '';
      }
      const emph = str(b.emphasis, 30);
      beat.emphasis = emph && wordsOf(text).some((w) => normWord(w) === normWord(emph)) ? emph : keyWordOf(text);
      if (scene === 'stamp' && !beat.stampText) beat.stampText = beat.emphasis;
      out.push({ scene, text, ...beat });
    });
    // variety: no scene twice in a row (the content-led ones are kept, the plain ones move)
    for (let i = 1; i < out.length; i += 1) {
      if (out[i].scene !== out[i - 1].scene || PICTURE_SCENES.has(out[i].scene)) continue;
      const alt = ['marker', 'circle', 'slam'].find((x) => x !== out[i - 1].scene && x !== out[i + 1]?.scene);
      if (['marker', 'circle', 'slam', 'stamp'].includes(out[i].scene)) out[i] = { ...out[i], scene: alt };
    }
    const beats = out.slice(0, 6);
    // a reel with pictures shows them: at least half the beats play over one.
    // Unused pictures go to text beats that don't have one (hook on the widest,
    // the last beats on finished rooms); checklist / prompt / split stay on colour
    const pool = bySharp.map((a) => a.assetId).filter((id) => !beats.some((b) => b.assetId === id || b.assetIds?.includes(id)));
    const want = Math.ceil(beats.length / 2);
    let have = beats.filter((b) => b.assetId).length;
    for (const b of beats) {
      if (have >= want || !pool.length) break;
      if (b.assetId || ['checklist', 'prompt_type', 'split'].includes(b.scene)) continue;
      b.assetId = pool.shift();
      have += 1;
    }
    return beats.map((b) => ({ ...b, sec: SCENES[b.scene] + (b.scene === 'checklist' ? 0.5 * Math.max(0, (b.items?.length || 0) - 2) : 0) }));
  };
  // no usable beats from the planner: tell the studio's own lines, a scene each
  const beatsFromFacts = () => {
    const lines = [ctx.hookFallback, ...ctx.project.facts.map((f) => f.text)].map((l) => onVideo(l, 8, { stop: true })).filter((l) => l && ok(l));
    return storyBeats([...new Set(lines)].slice(0, 5).map((text, i) => ({ text, scene: sceneFor(text, i) })));
  };

  const kineticLines = () => {
    const raw = Array.isArray(props.lines) ? props.lines : [];
    return raw.map((l) => onVideo(l, 7, { stop: true })).filter((l) => l && ok(l)).slice(0, 4);
  };
  let mainProps = main === 'kinetic_hook' ? {} : build(main);
  if (!mainProps && main !== 'kinetic_hook') {
    warnings.push(`${main} could not be built from the material — used ${recommended}`);
    main = recommended;
    mainProps = main === 'kinetic_hook' ? {} : build(main);
    if (!mainProps) { main = usable('ken_burns') ? 'ken_burns' : 'kinetic_hook'; mainProps = main === 'ken_burns' ? build('ken_burns') : {}; }
  }

  // hook (intro, or the main itself when nothing else is valid)
  const introRaw = segOf('intro') || segs.find((s) => s?.formatId === 'kinetic_hook');
  const hookWords = (() => {
    const w = Array.isArray(introRaw?.props?.words) ? introRaw.props.words.join(' ') : str(introRaw?.props?.words);
    const t = onVideo(w, 7);
    return t && ok(t) ? t : '';
  })();
  const fallbackHook = onVideo(ctx.hookFallback || '', 7);
  const hookText = hookWords || (fallbackHook && ok(fallbackHook) ? fallbackHook : '');
  const opensWithText = main === 'listicle_tips' || main === 'stat_counter' || main === 'motion_story';
  const wantIntro = main !== 'kinetic_hook' && !opensWithText && Boolean(hookText) && Boolean(introRaw);
  const firstAsset = mainProps?.beforeAssetId || mainProps?.assetIds?.[0] || mainProps?.assetId || mainProps?.tiles?.[0]?.assetId || mainProps?.backgroundAssetId || bySharp[0]?.assetId || '';

  // accents: allowed for this main, ≤ 2 kinds, grounded
  const allowed = ACCENTS[main] || {};
  const accents = [];
  (Array.isArray(mainRaw.accents) ? mainRaw.accents : []).forEach((a) => {
    const kind = a?.kind;
    if (!allowed[kind] || accents.some((x) => x.kind === kind) || accents.length >= 2) return;
    if (kind === 'fact_captions') {
      const items = (Array.isArray(a.items) ? a.items : []).map((t) => onVideo(t, 6, { stop: true })).filter((t) => t && ok(t)).slice(0, allowed[kind]);
      if (items.length) accents.push({ kind, items });
    } else if (kind === 'stat_badge') {
      const text = onVideo(a.text, 4);
      const pricedAll = products.length && products.every((x) => x.price);
      if (text && ok(text) && /\d/.test(text) && (main !== 'hotspot_callouts' || pricedAll)) accents.push({ kind, text });
    } else if (kind === 'hotspot_tags') {
      const on = main === 'before_after_wipe' ? mainProps.afterAssetId : null;
      const pids = (Array.isArray(a.productIds) ? a.productIds : []).filter((id) => products.some((x) => x.productId === id && (!on || x.assetId === on))).slice(0, allowed[kind]);
      if (pids.length) accents.push({ kind, productIds: pids });
    } else if (kind === 'palette_strip') {
      const last = mainProps.assetIds?.[mainProps.assetIds.length - 1];
      if (last && A.get(last)?.swatches?.length >= 3) accents.push({ kind });
    } else if (kind === 'poll_sticker') {
      if (mainProps.variant === 'options') accents.push({ kind, question: onVideo(a.question || 'Which one?', 4) });
    }
  });

  // timing: intro 1–2 s · main 8–15 s · outro 2–3 s · total ≤ 30 s, no gaps
  const introSec = wantIntro ? clamp(0.9 + wordsOf(hookText).length * 0.16, 1.2, 2) : 0;
  const natural = {
    before_after_wipe: () => clamp(mainProps.wipe.startSec + mainProps.wipe.durationSec + 2.2 + ((accents.find((x) => x.kind === 'fact_captions')?.items.length || 0) * 1.1), 8, 15),
    ken_burns: () => clamp(mainProps.assetIds.length * 2.4, 8, 15),
    stat_counter: () => clamp(1 + mainProps.stats.length * 2.8, 8, 15),
    listicle_tips: () => clamp(1.6 + mainProps.tips.length * 2.6, 8, 15),
    hotspot_callouts: () => clamp(2 + mainProps.productIds.length * 1.8, 8, 15),
    palette_extract: () => clamp(3 + mainProps.swatchCount * 1.0, 8, 15),
    grid_build: () => clamp(7.5 + (accents.some((x) => x.kind === 'poll_sticker') ? 1.5 : 0), 8, 15),
    kinetic_hook: () => clamp(1.2 + Math.max(1, kineticLines().length || 1) * 2.4, 3.5, 12),
    motion_story: () => clamp(mainProps.beats.reduce((n, b) => n + b.sec, 0), 8, 20),
  };
  let mainSec = r2(natural[main]());
  const mainHook = main === 'kinetic_hook' ? (hookText || onVideo(ctx.project.title, 7)) : '';
  const outro = ctx.brandKit.complete;
  if (!outro) warnings.push('Brand Kit incomplete (handle or accent) — no end card');
  const outroRaw = segOf('outro') || segs.find((s) => s?.formatId === 'cta_end_card') || {};
  let cta = onVideo(ctx.brandKit.cta || outroRaw.props?.cta, 6, { stop: true });
  if (!cta || !ok(cta)) cta = 'Follow for more design stories';
  const outroSec = outro ? 2.6 : 0;
  if (introSec + mainSec + outroSec > 30) mainSec = r2(30 - introSec - outroSec);

  const segments = [];
  let t = 0;
  if (introSec) { segments.push({ type: 'intro', formatId: 'kinetic_hook', startSec: 0, endSec: r2(introSec), props: { words: wordsOf(hookText), emphasis: str(introRaw?.props?.emphasis, 30), backgroundAssetId: firstAsset } }); t = introSec; }
  segments.push({
    type: 'main', formatId: main, startSec: r2(t), endSec: r2(t + mainSec),
    props: main === 'kinetic_hook'
      ? { words: wordsOf(mainHook), lines: kineticLines().length ? kineticLines() : [mainHook].filter(Boolean), backgroundAssetId: firstAsset }
      : mainProps,
    accents,
  });
  t += mainSec;
  if (outro) { segments.push({ type: 'outro', formatId: 'cta_end_card', startSec: r2(t), endSec: r2(t + outroSec), props: { cta, handle: ctx.brandKit.handle, backgroundAssetId: mainProps?.afterAssetId || mainProps?.assetIds?.[mainProps.assetIds.length - 1] || firstAsset } }); t += outroSec; }

  const mood = MOODS[p.audio?.mood] ? p.audio.mood : 'warm-upbeat';
  const caption = str(p.postCaption, 2200);
  const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 20);
  (Array.isArray(p.warnings) ? p.warnings : []).forEach((w) => warnings.push(str(w, 200)));
  ctx.capture.assets.filter((a) => a.needsConfirmation).forEach((a) => warnings.push(`${a.assetId}: ${a.needsConfirmation}`));
  return {
    status: 'ok', mainFormat: main, durationSec: r2(t), segments,
    audio: { mood, sfx: [] },
    factRefs: (Array.isArray(p.factRefs) ? p.factRefs : []).filter((f) => str(f?.text) && /^project\.|^brandKit\./.test(str(f?.source))).slice(0, 12),
    postCaption: caption,
    caption: caption.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim(),
    hashtags,
    warnings: [...new Set(warnings)].slice(0, 10),
  };
}

// ── plan → Remotion timeline (frames) ────────────────────────────────────────

function snap(sec, beats, within = 0.22) {
  const list = beats?.beats || [];
  if (!list.length) return sec;
  let best = sec; let bd = within;
  list.forEach((b) => { const d = Math.abs(b - sec); if (d < bd) { bd = d; best = b; } });
  return best;
}

async function compileMotionTimeline(plan, ctx, { brand, fps, width, height, music }) {
  const agent = require('./captureReelAgent');
  const F = (sec) => Math.max(0, Math.round(sec * fps));
  // segment boundaries and the wipe's end land on the beat (when there is one)
  const segs = plan.segments.map((s) => ({ ...s }));
  for (let i = 1; i < segs.length; i += 1) {
    const at = snap(segs[i].startSec, music?.beats);
    if (at > segs[i - 1].startSec + 0.8 && at < segs[i].endSec - 0.8) { segs[i - 1].endSec = at; segs[i].startSec = at; }
  }
  const main = segs.find((s) => s.type === 'main');
  if (main?.formatId === 'before_after_wipe') {
    const w = main.props.wipe;
    const end = snap(main.startSec + w.startSec + w.durationSec, music?.beats, 0.3) - main.startSec;
    if (end > w.startSec + 1) w.durationSec = r2(end - w.startSec);
  }

  // media: every picture the plan uses, at reel size
  const used = new Set();
  const take = (id) => { if (id) used.add(id); };
  segs.forEach((s) => {
    const q = s.props || {};
    [q.backgroundAssetId, q.beforeAssetId, q.afterAssetId, q.assetId].forEach(take);
    (q.assetIds || []).forEach(take);
    (q.beats || []).forEach((b) => { take(b.assetId); (b.assetIds || []).forEach(take); });
    (q.tiles || []).forEach((x) => take(x.assetId));
  });
  const media = {};
  await Promise.all([...used].map(async (id) => {
    const row = ctx.internal.get(id);
    const meta = ctx.capture.assets.find((a) => a.assetId === id);
    if (!row || !meta) return;
    media[id] = {
      src: await agent._imageSrc(row.key),
      w: row.width || 0, h: row.height || 0,
      focal: meta.focal, swatches: meta.swatches,
    };
    // a clip still: the clip plays (muted) from just before that moment; pinned
    // formats (wipe, hotspots, palette) keep the still so their marks line up
    if (row.clip?.key) {
      const url = await getMediaUrl(row.clip.key).catch(() => '');
      if (url) {
        media[id].video = url;
        media[id].videoStart = r2(Math.max(0, Math.min(row.clip.t - 0.4, (row.clip.durationSec || 0) - 2)));
      }
    }
  }));
  const products = Object.fromEntries(ctx.project.products.map((x) => [x.productId, { name: onVideo(x.name, 3), price: x.price || '', assetId: x.assetId, point: x.point }]));

  const total = segs[segs.length - 1].endSec;
  const accent = agent._liftAccent(brand.accent || '#D7F24A');
  const timelineSegs = segs.map((s) => {
    const q = JSON.parse(JSON.stringify(s.props || {}));
    if (q.wipe) { q.wipe.startFrame = F(q.wipe.startSec); q.wipe.durationInFrames = Math.max(8, F(q.wipe.durationSec)); }
    return {
      type: s.type, formatId: s.formatId,
      from: F(s.startSec), durationInFrames: Math.max(1, F(s.endSec) - F(s.startSec)),
      props: q, accents: s.accents || [],
    };
  });
  const mainSeg = timelineSegs.find((s) => s.type === 'main');
  const coverFrame = mainSeg.formatId === 'before_after_wipe'
    ? mainSeg.from + mainSeg.props.wipe.startFrame + mainSeg.props.wipe.durationInFrames + F(0.4)
    : mainSeg.from + Math.min(mainSeg.durationInFrames - 1, F(1.4));
  return {
    format: { width, height, fps, durationInFrames: F(total) },
    brand: {
      accent,
      accentInk: agent._luminance(accent) > 0.45 ? '#111111' : '#FFFFFF',
      ground: brand.ground || '#F4F1EA',
      fg: brand.fg || '#141414',
      headlineFont: brand.headlineFont || '',
      bodyFont: brand.bodyFont || '',
    },
    scenes: [],
    captions: [],
    motion: { segments: timelineSegs, media, products, coverFrame },
  };
}

// ── the whole step, as runCaptureReel calls it ───────────────────────────────

async function planMotionReel({ material, brand, dna, handle, idea, storyPlan, language, stored = null }) {
  const { buildContexts } = require('./motionReelSelector');
  const ctx = await buildContexts({ material, brand, dna, handle, idea, storyPlan, language });
  // no pictures at all: the reel is pure graphics (tips, stats, animated
  // headlines on brand colours) — the selector only offers those formats
  const seqLines = (storyPlan?.sequences || []).map((s) => s.onScreenText).filter(Boolean);
  ctx.hookFallback = seqLines[0] || storyPlan?.title || idea?.title || '';
  const request = [
    storyPlan?.title || idea?.title ? `The reel is about: ${storyPlan?.title || idea?.title}.` : '',
    seqLines.length ? `Story the studio approved, in order: ${seqLines.join(' / ')}.` : '',
  ].filter(Boolean).join(' ');
  const debugRows = [];
  // the reel plan the studio saw (ideaReelPlan → motionPlan): reused as is,
  // only re-checked against the pictures — no new model call
  if (stored?.segments?.length) {
    const plan = cleanMotionPlan(stored, ctx);
    debugRows.push({ source: 'Capture reel — motion graphics (approved plan)', output: JSON.stringify(plan, null, 2), note: `${plan.mainFormat} · ${plan.durationSec}s · reused, no model call` });
    return { plan, ctx, model: '', debugRows, costUsd: 0, music: MOODS[plan.audio.mood] };
  }
  let cost = 0;
  let r = await callPlanner(ctx, request);
  debugRows.push(r.debug); cost += r.costUsd;
  if (!r.raw || r.raw.status === 'blocked') {
    const rec = ctx.options.find((o) => o.status === 'recommended')?.formatId;
    r = await callPlanner(ctx, request, `${r.raw ? 'That main format is not valid.' : 'Your last answer was not one complete JSON object.'} Plan it with "${rec}" as the main format. Return ONLY the JSON object.`);
    debugRows.push(r.debug); cost += r.costUsd;
  }
  const plan = cleanMotionPlan(r.raw, ctx);
  debugRows.push({
    source: 'Capture reel — motion graphics guard',
    output: JSON.stringify({ selector: ctx.options, plan }, null, 2),
    note: `${plan.mainFormat} · ${plan.durationSec}s${plan.warnings.length ? ` · ${plan.warnings.length} warning(s)` : ''}`,
  });
  return { plan, ctx, model: r.model, debugRows, costUsd: cost, music: MOODS[plan.audio.mood] };
}

module.exports = { planMotionReel, cleanMotionPlan, compileMotionTimeline, factGuard, ACCENTS, MOODS };
