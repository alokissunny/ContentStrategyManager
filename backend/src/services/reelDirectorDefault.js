/**
 * Default reel director (Captures › Generate reel › Default) — the Bauhly Reel
 * Director brief, as a TEASER editor (prompts/reel-director-default.md): a
 * 7–12 s, no-voice, sound-off-first 9:16 teaser of the capture's photos and
 * clips — hook, fast build, one reveal on the drop, animated overlays anchored
 * to the things vision found in the photos — cut to an original music bed,
 * plus a post kit.
 *
 *   directDefaultReel()
 *     brief (brand, project notes, DCTT stage, language, target length, music
 *     bpm, avoid) + one labelled preview per asset
 *     → submit_reel_plan (LLM, vision)
 *     → validateReelPlan → one repair round with the errors → autoFix the rest
 *     → { plan (the pipeline's shape), style (a "look" for the renderer) }
 *
 * The plan then runs through the same timeline/render path as a music-led reel
 * style (reelStyleRun), so cuts snap to the generated track's real beats.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { completeToolCall, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { getObjectBytes } = require('./s3Client');
const { toVisionImage } = require('./visionImage');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'reel-director-default.md');
const TARGET = [7, 12];
const MAX_PREVIEWS = 16;
const MUSIC_BPM = Number(process.env.REEL_DEFAULT_BPM) || 104;
const MOTIONS = ['push_in', 'pull_out', 'pan_left', 'pan_right', 'pan_up', 'still'];
const OVERLAYS = ['circle', 'arrow', 'label', 'spotlight', 'zoom'];
const MAX_OVERLAYS = 5;
// an overlay draws in over ~0.4 s: it needs a shot long enough to be seen
const OVERLAY_SHOT_MIN = 1.2;
const OVERLAY_MIN_ON = 0.9;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (n) => Math.round(n * 100) / 100;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

// The original instrumental laid under a default reel (generated in parallel
// with the director, so the director plans to its tempo).
const DEFAULT_MUSIC = {
  bpm: MUSIC_BPM,
  mood: 'punchy, modern, building to a drop',
  prompt: `Original instrumental for a viral interior design teaser Reel: modern punchy house / pop, ${MUSIC_BPM} BPM, a tense riser for the first 4 seconds (filtered, building, snare roll) then a strong drop with a heavy kick on every beat, bright synth stabs, no vocals.`,
};

// ── tool schema (the guidance's submit_reel_plan) ─────────────────────────────
const REEL_PLAN_TOOL = {
  name: 'submit_reel_plan',
  description: 'Submit the final reel edit plan and post kit for rendering.',
  input_schema: {
    type: 'object',
    required: ['format', 'hookText', 'grade', 'shots', 'endCard', 'totalSec', 'postKit', 'rejectedAssets', 'warnings'],
    properties: {
      format: { type: 'string', enum: ['before_after', 'room_reveal', 'detail_montage', 'pov', 'numbers'] },
      hookText: { type: 'string', description: '3–7 word hook shown on shot 1' },
      grade: { type: 'string', enum: ['warm', 'clean', 'moody', 'none'], description: 'warm for wood/brass/residential, clean for white/minimal, moody for dark/luxe' },
      shots: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          required: ['assetId', 'durationSec', 'purpose'],
          properties: {
            assetId: { type: 'string' },
            durationSec: { type: 'number', minimum: 0.3, maximum: 4 },
            inSec: { type: 'number', minimum: 0 },
            speed: { type: 'number', minimum: 0.75, maximum: 2 },
            motion: { type: 'string', enum: MOTIONS },
            flash: { type: 'boolean' },
            text: { type: 'string' },
            textY: { type: 'number', minimum: 0.15, maximum: 0.75 },
            beforeAssetId: { type: 'string', description: 'before_after: the before photo this shot wipes away to reveal the after' },
            overlays: {
              type: 'array',
              maxItems: 2,
              items: {
                type: 'object',
                required: ['type', 'subject', 'atSec'],
                properties: {
                  type: { type: 'string', enum: OVERLAYS },
                  subject: { type: 'string', description: "exact name of one of this asset's subjects" },
                  text: { type: 'string', description: '1–3 words (arrow / label)' },
                  atSec: { type: 'number', minimum: 0, description: 'seconds from the start of this shot' },
                },
              },
            },
            purpose: { type: 'string' },
          },
        },
      },
      endCard: {
        type: 'object',
        required: ['title', 'sub', 'durationSec'],
        properties: { title: { type: 'string' }, sub: { type: 'string' }, durationSec: { type: 'number', minimum: 1, maximum: 3 } },
      },
      totalSec: { type: 'number' },
      postKit: {
        type: 'object',
        required: ['caption', 'hashtags', 'coverShotIndex', 'audioSuggestion', 'altHook'],
        properties: {
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' }, minItems: 5, maxItems: 20 },
          coverShotIndex: { type: 'integer', minimum: 0 },
          audioSuggestion: { type: 'string' },
          altHook: { type: 'string' },
        },
      },
      rejectedAssets: {
        type: 'array',
        items: { type: 'object', required: ['assetId', 'reason'], properties: { assetId: { type: 'string' }, reason: { type: 'string' } } },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

// ── brief ─────────────────────────────────────────────────────────────────────
const ROLE_HINT = [
  [/\bbefore\b|antes|demoli|obra|construction|site|raw|unfinished|dust|polvo|sin terminar/i, 'process'],
  [/close[- ]?up|detail|detalle|handle|tirador|texture|textura|tap|grifo/i, 'after_detail'],
];
function roleOf(a) {
  const t = `${a.summary} ${a.description}`;
  if (a.kind === 'video') return /walk|recorr|pan|through/i.test(t) ? 'walkthrough' : 'unknown';
  for (const [re, role] of ROLE_HINT) if (re.test(t)) return role;
  return 'unknown';
}

async function previewOf(key) {
  const { buffer, contentType } = await getObjectBytes(key);
  const vis = await toVisionImage(buffer, contentType, key);
  const img = sharp(vis.buffer).rotate();
  const meta = await sharp(await img.clone().toBuffer()).metadata();
  const jpg = await img.resize(512, 512, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  return { width: meta.width || 0, height: meta.height || 0, data: jpg.toString('base64') };
}

function orientation(w, h) {
  if (!w || !h) return 'unknown';
  return h > w ? 'portrait' : h === w ? 'square' : 'landscape';
}

async function assetsAndPreviews(assets) {
  const out = [];
  const parts = [];
  await Promise.all(assets.slice(0, MAX_PREVIEWS).map(async (a, i) => {
    const key = a.kind === 'image' ? a.key : a.stills?.[Math.min(1, (a.stills.length || 1) - 1)]?.key;
    let p = null;
    if (key) { try { p = await previewOf(key); } catch { /* listed without a preview */ } }
    if (p) { a.width = p.width; a.height = p.height; } // the renderer maps overlay anchors with these
    out[i] = {
      id: a.id,
      kind: a.kind,
      width: p?.width || 0,
      height: p?.height || 0,
      orientation: orientation(p?.width, p?.height),
      ...(a.kind === 'video' ? { durationSec: r2(a.durationSec) } : {}),
      role: roleOf(a),
      note: [a.summary, a.kind === 'video' && a.transcript ? `said: "${a.transcript.slice(0, 200)}"` : ''].filter(Boolean).join(' · '),
      ...(a.kind === 'image' && a.subjectBoxes?.length
        ? { subjects: a.subjectBoxes.map((s) => ({ name: s.name, x: Math.round(s.point.x), y: Math.round(s.point.y) })) }
        : {}),
      _preview: p,
    };
  }));
  for (const a of out) {
    if (!a) continue;
    if (a._preview) {
      parts.push({ type: 'text', text: `Asset ${a.id} (${a.kind}${a.kind === 'video' ? `, ${a.durationSec}s, keyframe shown` : ''}):` });
      parts.push({ type: 'image', mediaType: 'image/jpeg', data: a._preview.data });
    }
    delete a._preview;
  }
  return { assets: out.filter(Boolean), parts };
}

function briefOf({ assets, material, profile, dna, dcttStage }) {
  const notes = material.capture.notes.map((n) => [n.note, n.understanding?.happened, n.understanding?.actionTaken, n.understanding?.outcome]
    .filter(Boolean).join('\n')).join('\n\n').slice(0, 4000);
  const quote = (material.capture.conversation || []).filter((t) => t.role === 'user').map((t) => t.text).join(' ').slice(0, 600);
  return {
    brand: {
      studioName: profile?.fullName || (profile?.username ? `@${profile.username}` : 'the studio'),
      ...(profile?.username ? { handle: `@${profile.username}` } : {}),
      ...(profile?.biography ? { bio: profile.biography.slice(0, 300) } : {}),
      ...(dna?.visualStyle ? { styleWords: words(dna.visualStyle).length > 12 ? [dna.visualStyle.slice(0, 120)] : [dna.visualStyle] } : {}),
      ...(dna?.whatYouOffer ? { offer: dna.whatYouOffer.slice(0, 300) } : {}),
    },
    project: {
      ...(material.capture.project && material.capture.project !== 'No project' ? { type: material.capture.project } : {}),
      notes,
      ...(quote ? { inTheirWords: quote } : {}),
    },
    dcttStage: dcttStage || 'discovery',
    language: 'the language of project.notes (the studio\'s own words)',
    targetSeconds: TARGET,
    music: { bpm: MUSIC_BPM, mood: DEFAULT_MUSIC.mood },
    avoid: dna?.neverDo ? [dna.neverDo.slice(0, 300)] : [],
    assets,
  };
}

// an overlay anchor: one of the asset's vision subjects, by (loose) name
function subjectOf(asset, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  const list = asset?.subjects || [];
  return list.find((s) => s.name.toLowerCase() === want)
    || list.find((s) => s.name.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()))
    || null;
}

// ── validation (the guidance's validateReelPlan, + our renderer's limits) ─────
function validateReelPlan(plan, assets) {
  const errors = [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  if (shots.length < 3) errors.push(`only ${shots.length} shots — at least 3 are needed`);
  shots.forEach((s, i) => {
    const a = byId.get(s.assetId);
    if (!a) { errors.push(`shot ${i}: unknown assetId "${s.assetId}"`); return; }
    if (a.kind === 'image' && !s.motion) errors.push(`shot ${i}: image shot needs a motion`);
    if (a.kind === 'video' && a.durationSec != null) {
      const need = num(s.inSec) + num(s.durationSec) * num(s.speed, 1);
      if (need > a.durationSec + 0.05) errors.push(`shot ${i}: needs ${need.toFixed(2)}s of video but ${a.id} is ${a.durationSec}s`);
    }
    const prev = shots[i - 1];
    if (prev && s.motion && s.motion !== 'still' && prev.motion === s.motion) errors.push(`shot ${i}: repeats motion "${s.motion}" from previous shot`);
    if (s.text && words(s.text).length > 9) errors.push(`shot ${i}: text over 9 words`);
    const ovs = Array.isArray(s.overlays) ? s.overlays : [];
    if (ovs.length > 2) errors.push(`shot ${i}: more than 2 overlays`);
    ovs.forEach((o, j) => {
      if (!OVERLAYS.includes(o?.type)) errors.push(`shot ${i} overlay ${j}: unknown type "${o?.type}"`);
      if (a.kind !== 'image') errors.push(`shot ${i} overlay ${j}: overlays go on image shots only`);
      else if (!subjectOf(a, o?.subject)) errors.push(`shot ${i} overlay ${j}: "${o?.subject}" is not one of ${a.id}'s subjects (${(a.subjects || []).map((x) => x.name).join(', ') || 'none'})`);
      if (num(o?.atSec, 0) >= num(s.durationSec)) errors.push(`shot ${i} overlay ${j}: atSec ${o?.atSec} is not inside the ${s.durationSec}s shot`);
      else if (num(s.durationSec) - num(o?.atSec, 0) < OVERLAY_MIN_ON) errors.push(`shot ${i} overlay ${j}: on screen only ${(num(s.durationSec) - num(o?.atSec, 0)).toFixed(2)}s — a shot with an overlay must last ≥ ${OVERLAY_SHOT_MIN}s with the overlay up ≥ ${OVERLAY_MIN_ON}s`);
    });
    if (s.beforeAssetId) {
      const b = byId.get(s.beforeAssetId);
      if (!b || b.kind !== 'image' || a.kind !== 'image') errors.push(`shot ${i}: beforeAssetId must be a photo and the shot a photo`);
    }
  });
  const overlayCount = shots.reduce((n, s) => n + (Array.isArray(s.overlays) ? s.overlays.length : 0), 0);
  if (overlayCount > MAX_OVERLAYS) errors.push(`${overlayCount} overlays — keep it to 2–4 in the whole reel`);
  if (!plan?.hookText && !shots[0]?.text) errors.push('shot 0 must carry the hook text');
  const end = num(plan?.endCard?.durationSec, 2);
  const total = shots.reduce((t, s) => t + num(s.durationSec), 0) + end;
  if (Math.abs(total - num(plan?.totalSec)) > 0.1) errors.push(`totalSec ${plan?.totalSec} != computed ${total.toFixed(2)}`);
  if (total < TARGET[0] - 0.5 || total > TARGET[1] + 0.5) errors.push(`total ${total.toFixed(1)}s outside target ${TARGET[0]}–${TARGET[1]}s`);
  if (shots.filter((s) => s.flash).length > 1) errors.push('flash used on more than one shot');
  if (num(plan?.postKit?.coverShotIndex, 0) >= shots.length) errors.push('coverShotIndex out of range');
  return errors;
}

// whatever is still off after the repair round is fixed here, never failing a reel
function autoFix(plan, assets) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const p = JSON.parse(JSON.stringify(plan || {}));
  let shots = (Array.isArray(p.shots) ? p.shots : []).filter((s) => byId.has(s?.assetId));
  if (shots.length < 3) {
    // too few usable shots: fill from unused photos, slow moves
    const used = new Set(shots.map((s) => s.assetId));
    for (const a of assets) {
      if (shots.length >= 3) break;
      if (!used.has(a.id)) shots.push({ assetId: a.id, durationSec: 1.2, purpose: 'filler', motion: 'push_in' });
    }
  }
  let flashed = false;
  shots = shots.map((s, i) => {
    const a = byId.get(s.assetId);
    const out = { ...s, durationSec: clamp(num(s.durationSec, 1), 0.3, 4) };
    if (a.kind === 'image') {
      if (!MOTIONS.includes(out.motion)) out.motion = 'push_in';
    } else {
      out.speed = clamp(num(out.speed, 1), 0.75, 2);
      const room = Math.max(0, a.durationSec - out.durationSec * out.speed);
      out.inSec = clamp(num(out.inSec), 0, room);
      if (out.durationSec * out.speed > a.durationSec) out.durationSec = r2(a.durationSec / out.speed);
    }
    if (out.flash) { if (flashed) out.flash = false; flashed = true; }
    if (out.text && words(out.text).length > 9) out.text = words(out.text).slice(0, 7).join(' ');
    out.overlays = (Array.isArray(out.overlays) ? out.overlays : [])
      .filter((o) => OVERLAYS.includes(o?.type) && a.kind === 'image' && subjectOf(a, o.subject))
      .slice(0, 2)
      .map((o) => ({ ...o, atSec: clamp(num(o.atSec, 0.2), 0, Math.max(0, out.durationSec - 0.25)) }));
    if (out.beforeAssetId && (byId.get(out.beforeAssetId)?.kind !== 'image' || a.kind !== 'image')) delete out.beforeAssetId;
    if (out.textY != null) out.textY = clamp(num(out.textY, 0.7), 0.15, 0.75);
    return out;
  });
  // no motion twice in a row
  const order = ['push_in', 'pan_left', 'pull_out', 'pan_right', 'pan_up'];
  for (let i = 1; i < shots.length; i += 1) {
    if (shots[i].motion && shots[i].motion !== 'still' && shots[i].motion === shots[i - 1].motion) {
      shots[i].motion = order.find((m) => m !== shots[i - 1].motion && m !== shots[i + 1]?.motion) || 'push_in';
    }
  }
  // at most MAX_OVERLAYS in the reel (first come, first kept)
  let left = MAX_OVERLAYS;
  shots.forEach((s) => { s.overlays = s.overlays.slice(0, Math.max(0, left)); left -= s.overlays.length; });
  // a shot carrying an overlay stays up long enough for it to be seen
  shots.forEach((s) => {
    if (!s.overlays?.length) return;
    const lastAt = Math.max(...s.overlays.map((o) => num(o.atSec)));
    s.durationSec = r2(Math.min(4, Math.max(s.durationSec, OVERLAY_SHOT_MIN, lastAt + OVERLAY_MIN_ON)));
  });
  // fit the target length by scaling the other shots (overlay shots keep theirs)
  const end = clamp(num(p.endCard?.durationSec, 1.8), 1.5, 2.2);
  const fixedSum = shots.filter((s) => s.overlays?.length).reduce((t, s) => t + s.durationSec, 0);
  const flexSum = shots.filter((s) => !s.overlays?.length).reduce((t, s) => t + s.durationSec, 0);
  const want = clamp(fixedSum + flexSum + end, TARGET[0], TARGET[1]);
  if (Math.abs(want - (fixedSum + flexSum + end)) > 0.05 && flexSum > 0) {
    const k = Math.max(0.2, (want - end - fixedSum) / flexSum);
    shots = shots.map((s) => (s.overlays?.length ? s : { ...s, durationSec: r2(clamp(s.durationSec * k, 0.3, 4)) }));
  }
  p.shots = shots;
  p.endCard = { title: String(p.endCard?.title || '').trim(), sub: String(p.endCard?.sub || '').trim(), durationSec: end };
  p.totalSec = r2(shots.reduce((t, s) => t + s.durationSec, 0) + end);
  p.postKit = { ...(p.postKit || {}), coverShotIndex: clamp(Math.round(num(p.postKit?.coverShotIndex, shots.length - 1)), 0, shots.length - 1) };
  if (!p.hookText) p.hookText = shots[0]?.text || '';
  return p;
}

// ── to the pipeline's plan + a renderer look ─────────────────────────────────
const MOTION_MAP = { push_in: 'push-in', pull_out: 'pull-out', pan_left: 'pan-left', pan_right: 'pan-right', pan_up: 'pan-up', still: 'none' };
const GRADE_MAP = { warm: 'warm', clean: 'clean', moody: 'moody', none: 'neutral' };

function toPipeline(rp, materialAssets = []) {
  const shots = rp.shots;
  const matById = new Map(materialAssets.map((a) => [a.id, a]));
  // overlay → the subject's real box/point on the photo (% of the image)
  const anchorOf = (assetId, name) => {
    const m = matById.get(assetId);
    const hit = subjectOf({ subjects: m?.subjectBoxes || [] }, name);
    return hit ? { box: hit.box, point: hit.point } : null;
  };
  const sorted = shots.map((s) => s.durationSec).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const hashtags = [...new Set((rp.postKit?.hashtags || [])
    .map((h) => String(h || '').trim().replace(/\s+/g, ''))
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .filter((h) => /^#[\p{L}\p{N}_]{2,}$/u.test(h)))].slice(0, 15);
  const plan = {
    concept: `${String(rp.format || '').replace('_', ' ')} — ${shots.map((s) => s.purpose).filter(Boolean).slice(0, 3).join(' → ')}`.slice(0, 400),
    audioMode: 'music',
    voice: { name: 'coral', direction: '' },
    hook: { text: words(rp.hookText).slice(0, 9).join(' '), emphasis: '' },
    scenes: shots.map((s, i) => ({
      assetId: s.assetId,
      startSec: r2(num(s.inSec)),
      durationSec: r2(s.durationSec),
      voiceLine: '',
      kicker: '',
      // the hook is drawn on shot 1 by the hook layer
      overlayText: i === 0 ? '' : String(s.text || '').trim(),
      // the brief's default text height is 0.70 (clear of the IG UI at the bottom)
      ...(i > 0 && String(s.text || '').trim() ? { textY: s.textY != null ? s.textY : 0.7 } : {}),
      ...(s.speed && s.speed !== 1 ? { speed: s.speed } : {}),
      motion: MOTION_MAP[s.motion] || 'push-in',
      transition: s.flash ? 'flash' : 'cut',
      focusX: 50,
      focusY: 50,
      purpose: String(s.purpose || '').slice(0, 120),
      ...(s.beforeAssetId ? { beforeAssetId: s.beforeAssetId } : {}),
      annotations: (s.overlays || []).map((o) => {
        const at = anchorOf(s.assetId, o.subject);
        return at ? { type: o.type, subject: o.subject, text: words(o.text).slice(0, 3).join(' '), atSec: r2(num(o.atSec, 0.2)), ...at } : null;
      }).filter(Boolean),
    })),
    cta: { line: rp.endCard.title || '', sub: rp.endCard.sub || '', durationSec: rp.endCard.durationSec },
    caption: String(rp.postKit?.caption || '').slice(0, 2200),
    hashtags,
    format: rp.format,
    grade: rp.grade,
    coverShotIndex: rp.postKit?.coverShotIndex ?? 0,
    altHook: String(rp.postKit?.altHook || '').slice(0, 120),
    audioSuggestion: String(rp.postKit?.audioSuggestion || '').slice(0, 300),
    rejectedAssets: rp.rejectedAssets || [],
    warnings: rp.warnings || [],
  };
  // the default look, expressed as a reel style so the music-led render path
  // (beat-snapped cuts, overlays, end card) draws it
  const style = {
    name: 'Default',
    audio: { mode: 'music', music: { ...DEFAULT_MUSIC } },
    pacing: { hookHoldSec: shots[0]?.durationSec || 1.2, shotSec: median, beatSync: true, targetLengthSec: rp.totalSec },
    hook: { treatment: 'slam' },
    text: { overlay: 'bold-sans', perShot: 'some-shots', textCase: 'sentence', font: 'sans-bold', color: '#FFFFFF', position: 'center', kinetic: true },
    captions: 'none',
    chapters: { numbered: false, card: 'none' },
    cta: { endCard: 'card' },
    visuals: { grade: GRADE_MAP[rp.grade] || 'neutral' },
  };
  return { plan, style };
}

// ── the call ────────────────────────────────────────────────────────────────
async function callDirector({ system, parts, user, extra = '' }) {
  const llm = resolvePlanAgentLlm('captureReel');
  const started = Date.now();
  const res = await completeToolCall({
    model: llm.model,
    system,
    userParts: [...parts, { type: 'text', text: extra ? `${user}\n\n${extra}` : user }],
    tool: REEL_PLAN_TOOL,
    maxTokens: 12000,
    kind: 'captureReel',
    timeoutMs: 240000,
    retryHint: 'Return ONLY the JSON object for submit_reel_plan, matching the schema exactly.',
  });
  const u = res.usage || {};
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  return {
    raw: res.parsed,
    model: res.model,
    inputTokens,
    outputTokens,
    costUsd: estimatePlanCostUsd(res.model, inputTokens, outputTokens, num(u.cached_tokens)),
    elapsedMs: Date.now() - started,
  };
}

/**
 * @returns {{ plan, style, model, debugRows: object[], costUsd: number }}
 */
async function directDefaultReel({ material, profile, dna, dcttStage }) {
  const { system, userTemplate } = splitPromptTemplate(fs.readFileSync(PROMPT_FILE, 'utf8'));
  const { assets, parts } = await assetsAndPreviews(material.assets);
  const brief = briefOf({ assets, material, profile, dna, dcttStage });
  const user = userTemplate.split('{{BRIEF_JSON}}').join(JSON.stringify(brief, null, 2));
  const rows = [];
  const row = (label, r, note = '') => rows.push({
    source: label, model: r.model, prompt: `${system}\n\n---\n\n${user}`, output: JSON.stringify(r.raw, null, 2),
    elapsedMs: r.elapsedMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, note,
  });

  let r = await callDirector({ system, parts, user });
  let errors = validateReelPlan(r.raw, assets);
  row('Capture reel — director (default)', r, errors.length ? `${errors.length} problem(s): ${errors.join('; ')}` : 'valid');
  let model = r.model;
  let costUsd = r.costUsd;
  if (errors.length) {
    // one repair round: the guidance's "send the errors back and ask for a fix"
    r = await callDirector({
      system, parts, user,
      extra: `Your previous submit_reel_plan had these problems:\n- ${errors.join('\n- ')}\n\nPrevious plan:\n${JSON.stringify(r.raw)}\n\nFix every problem and submit the corrected plan.`,
    });
    model = r.model;
    costUsd += r.costUsd;
    errors = validateReelPlan(r.raw, assets);
    row('Capture reel — director (repair)', r, errors.length ? `still ${errors.length}: ${errors.join('; ')} — auto-fixed` : 'valid after repair');
  }
  const fixed = autoFix(r.raw, assets);
  const { plan, style } = toPipeline(fixed, material.assets);
  return { plan, style, model, debugRows: rows, costUsd };
}

module.exports = { directDefaultReel, validateReelPlan, autoFix, toPipeline, DEFAULT_MUSIC, REEL_PLAN_TOOL };
