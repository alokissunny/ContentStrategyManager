/*
 * Explainer animation specialist (studio, 2026-11-23) — the third design agent of a talking reel,
 * running beside the caption and motion agents once the cut agent has fixed the edit.
 *
 * Studio's reference reel (DMfntZZNuLH): while the designer explains a kitchen mistake, the reel cuts to a
 * small animated line drawing — a section of the cabinet base with a foot and "7cm / 10cm", the recess
 * filled green with a ✓; a person at the counter with the ceiling light behind them, "shadowed area", ✗;
 * the counter at "80cm" ✗ then "85cm" ✓. This agent finds such moments in the spoken words and orders a
 * drawing from a fixed vocabulary (prompts/reel-agents/explainer.md); Remotion draws it (explainers.tsx).
 *
 * Code checks everything it returns: word ranges, spacing (≥ 3 s apart unless a ✗→✓ pair), at most one
 * per ~9 s and never more than 3, never over the hook or the last sentence, and every number must be one
 * the speaker actually said (a drawing never shows a made-up value).
 * Model: Claude Sonnet 5.5 (JSON mode); REEL_EXPLAINER_MODEL overrides, REEL_EXPLAINERS=off disables.
 */
const fs = require('fs');
const path = require('path');
const { completeToolCall } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');

const PROMPT = path.join(__dirname, '..', '..', 'prompts', 'reel-agents', 'explainer.md');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, max = 80) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const firstWords = (s, n) => s.split(' ').filter(Boolean).slice(0, n).join(' ');
const o = (properties) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });

const SCENES = ['measure', 'light', 'compare', 'flow', 'checklist', 'open_plan', 'stat'];
const MEASURE_SUBJECTS = ['counter', 'toe_kick', 'upper_cabinet', 'table', 'seat', 'shelf', 'window', 'walkway', 'ceiling'];
const LIGHT_SUBJECTS = ['ceiling', 'pendant', 'under_cabinet', 'wall', 'lamp'];
const FIGURES = ['standing', 'seated', 'foot', 'none'];
const DIMENSIONS = ['height', 'depth', 'gap', 'width', 'none'];
const VERDICTS = ['good', 'bad', 'none'];
// what a checklist / flow point SHOWS (a small line icon drawn for it) — a point that can't be pictured
// is not a checklist point
const ICONS = ['material', 'weather', 'water', 'storage', 'floor', 'light', 'measure', 'time', 'budget', 'plant', 'layout', 'seat', 'style', 'none'];

const EXPLAINER_TOOL = {
  name: 'design_explainers',
  description: 'The animated explainer drawings of a talking reel (or none).',
  input_schema: o({
    explainers: {
      type: 'array',
      items: o({
        from: { type: 'integer' },
        to: { type: 'integer' },
        scene: { type: 'string', enum: SCENES },
        subject: { type: 'string', enum: [...new Set([...MEASURE_SUBJECTS, ...LIGHT_SUBJECTS, 'none'])] },
        figure: { type: 'string', enum: FIGURES },
        dimension: { type: 'string', enum: DIMENSIONS },
        value: { type: 'string' },
        dimension2: { type: 'string', enum: DIMENSIONS },
        value2: { type: 'string' },
        title: { type: 'string' },
        label: { type: 'string' },
        verdict: { type: 'string', enum: VERDICTS },
        items: {
          type: 'array',
          items: o({ text: { type: 'string' }, value: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, at: { type: 'integer' }, icon: { type: 'string', enum: ICONS } }),
        },
        why: { type: 'string' },
        strength: { type: 'integer' },
      }),
    },
  }),
};

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX = 3;
const PER_SEC = 9; // at most one drawing per ~9 s of speech
const MIN_GAP = 3; // s between two drawings (a ✗ → ✓ pair may touch)
const MIN_SEC = 2.2;
const MAX_SEC = 4.5;
const LIST_MAX_SEC = 7; // a checklist / flow holds while its items are said
// a list whose points are said far apart (> LIST_GAP_SEC) does not sit on screen through the gap: the
// card leaves after a point has been read and comes back (`resume`) just before the next one — one
// focus at a time, nothing on screen that isn't moving or being read (Dec 17 reel: 14 s card)
const LIST_GAP_SEC = 3;
const LIST_READ_SEC = 1.4;

/* "85 cm" → ["85"]; "1,5 m" → ["1.5"] — the digits a value claims */
const numbersIn = (s) => (String(s || '').replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) || []);
/* number words the speaker may say instead of digits */
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
function spokenNumbers(text) {
  const out = new Set(numbersIn(text));
  const ws = String(text || '').toLowerCase().split(/[^a-z]+/);
  for (let k = 0; k < ws.length; k += 1) {
    const a = NUMBER_WORDS[ws[k]];
    if (a == null) continue;
    const b = NUMBER_WORDS[ws[k + 1]];
    out.add(String(a));
    if (b != null && a >= 20 && b < 10) out.add(String(a + b)); // "eighty five"
  }
  return out;
}
/* a value is kept only when every number in it was said near the drawing (or anywhere in the reel) */
const saidValue = (value, near, all) => {
  const v = str(value, 14);
  const ns = numbersIn(v);
  if (!v || !ns.length) return '';
  return ns.every((n) => near.has(n) || all.has(n)) ? v : '';
};

/**
 * words: [{ i, text, start, end, on }] (output seconds); inserts: [{ fromSec, toSec, shows }].
 * Returns { explainers: [{ fromSec, toSec, spec }], debug }.
 */
async function designExplainers({ words, inserts = [], story = '', hookEndSec = 1.5 }) {
  if (process.env.REEL_EXPLAINERS === 'off' || words.length < 12) return { explainers: [], debug: null };
  const system = fs.readFileSync(PROMPT, 'utf8');
  const user = JSON.stringify({
    story: str(story, 300),
    spokenSeconds: Math.round((words[words.length - 1].end - words[0].start) * 10) / 10,
    words: words.map((w) => ({ i: w.i, w: w.text, t: Math.round(w.start * 10) / 10, on: w.on })),
    inserts: inserts.map((x) => ({ from: Math.round(x.fromSec * 10) / 10, to: Math.round(x.toSec * 10) / 10, shows: str(x.shows, 140) })),
  });
  const model = process.env.REEL_EXPLAINER_MODEL || DEFAULT_MODEL;
  const started = Date.now();
  const res = await completeToolCall({
    model, system, userParts: [{ type: 'text', text: user }], tool: EXPLAINER_TOOL, maxTokens: 6000,
    kind: 'reelExplainers', timeoutMs: 180000,
    retryHint: 'Return ONLY the JSON object for design_explainers, matching the schema exactly.',
  });
  const u = res.usage || {};
  const explainers = cleanExplainers(res.parsed?.explainers, words, { hookEndSec });
  return {
    explainers,
    debug: {
      source: 'Capture reel — explainer animation agent',
      model: res.model,
      prompt: `${system}\n\n---\n\n${user}`,
      output: JSON.stringify({ agent: res.parsed, kept: explainers.map((x) => ({ at: `${x.fromSec.toFixed(1)}–${x.toSec.toFixed(1)}s`, ...x.spec })) }, null, 2),
      elapsedMs: Date.now() - started,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd: estimatePlanCostUsd(res.model, num(u.input_tokens), num(u.output_tokens), num(u.cached_tokens)),
    },
  };
}

/* the drawing an agent ordered, checked against the vocabulary: every value must be a number that was
   said (`near` = said around it, `all` = said anywhere); null when nothing honest is left to draw */
function specOf(x, near, all) {
  const verdict = VERDICTS.includes(x.verdict) ? x.verdict : 'none';
  const spec = { scene: x.scene, verdict, title: firstWords(str(x.title, 48), 5).replace(/[.!]+$/, '') };
  if (x.scene === 'measure') {
    spec.subject = MEASURE_SUBJECTS.includes(x.subject) ? x.subject : 'counter';
    spec.figure = FIGURES.includes(x.figure) ? x.figure : 'standing';
    spec.dimension = DIMENSIONS.includes(x.dimension) ? x.dimension : 'none';
    spec.value = spec.dimension === 'none' ? '' : saidValue(x.value, near, all);
    spec.dimension2 = DIMENSIONS.includes(x.dimension2) && x.dimension2 !== spec.dimension ? x.dimension2 : 'none';
    spec.value2 = spec.dimension2 === 'none' ? '' : saidValue(x.value2, near, all);
    if (!spec.value2) spec.dimension2 = 'none';
    spec.label = firstWords(str(x.label, 30), 3);
  } else if (x.scene === 'light') {
    spec.subject = LIGHT_SUBJECTS.includes(x.subject) ? x.subject : 'ceiling';
    spec.label = firstWords(str(x.label, 30), 3);
  } else {
    const items = (Array.isArray(x.items) ? x.items : []).map((it) => ({
      text: firstWords(str(it?.text, 40), x.scene === 'stat' ? 5 : 3),
      value: saidValue(it?.value, near, all),
      verdict: VERDICTS.includes(it?.verdict) ? it.verdict : 'none',
      at: Math.round(num(it?.at, -1)),
      icon: ICONS.includes(it?.icon) ? it.icon : 'none',
    })).filter((it) => it.text || it.value);
    if (x.scene === 'compare') {
      if (items.length < 2) return null;
      spec.items = items.slice(0, 2);
    } else if (x.scene === 'flow' || x.scene === 'checklist') {
      if (items.length < 2) return null;
      // a checklist must SHOW its points (studio review 2026-11-24: a tick explains nothing):
      // at least half of the points need a picture, else it is decoration and is dropped
      if (x.scene === 'checklist' && items.filter((it) => it.icon !== 'none').length < Math.ceil(items.length / 2)) return null;
      spec.items = items.slice(0, 4).map((it) => ({ text: it.text, value: '', verdict: 'none', at: it.at, icon: it.icon }));
    } else if (x.scene === 'open_plan') {
      if (items.length < 2) return null;
      spec.items = items.slice(0, 2).map((it) => ({ text: it.text, value: '', verdict: 'none' }));
    } else {
      if (!items[0]?.value) return null; // a stat is its number: no said number, no stat
      spec.items = [items[0]];
    }
  }
  if (!spec.title && !spec.value && !spec.items?.length) return null;
  return spec;
}

function cleanExplainers(list, words, { hookEndSec = 1.5 } = {}) {
  const n = words.length;
  if (!n) return [];
  const all = spokenNumbers(words.map((w) => w.text).join(' '));
  const speechSec = words[n - 1].end - words[0].start;
  const cap = Math.min(MAX, Math.max(1, Math.floor(speechSec / PER_SEC)));
  // the last sentence is the call to action: from the last pause ≥ 0.45 s in the final 5 s
  let lastSentence = words[n - 1].start;
  for (let k = n - 1; k > 0; k -= 1) {
    if (words[n - 1].end - words[k].start > 5) break;
    if (words[k].start - words[k - 1].end >= 0.45 || /[.!?]$/.test(words[k - 1].text)) { lastSentence = words[k].start; break; }
  }
  const out = [];
  (Array.isArray(list) ? list : [])
    .map((x) => ({ ...x, from: Math.round(num(x?.from, -1)), to: Math.round(num(x?.to, -1)) }))
    .filter((x) => x.from >= 0 && x.to >= x.from && x.to < n && SCENES.includes(x.scene))
    .map((x) => ({ ...x, strength: Math.max(1, Math.min(5, Math.round(num(x.strength, 3)))) }))
    .filter((x, _, all) => {
      // the agent scores every candidate; strong ones (≥ 3) are drawn. With none strong, the single best
      // concrete one (a list, a process, light, a comparison, a measurement — never a lone stat) still is:
      // an explaining reel should show at least one idea, not only say it
      if (x.strength >= 3) return true;
      if (all.some((y) => y.strength >= 3) || x.strength < 2 || x.scene === 'stat') return false;
      const best = all.filter((y) => y.strength === 2 && y.scene !== 'stat').sort((a, b) => b.to - b.from - (a.to - a.from))[0];
      return best === x;
    })
    .sort((a, b) => a.from - b.from)
    .forEach((x) => {
      if (out.length >= cap) return;
      const near = spokenNumbers(words.slice(Math.max(0, x.from - 10), Math.min(n, x.to + 11)).map((w) => w.text).join(' '));
      const spec = specOf(x, near, all);
      if (!spec) return;
      // timing: the sentence, held 2.2–4.5 s
      const fromSec = Math.max(words[x.from].start - 0.12, hookEndSec);
      let toSec = words[x.to].end + 0.3; // eslint-disable-line prefer-const
      const listy = x.scene === 'checklist' || x.scene === 'flow';
      if (toSec - fromSec > (listy ? LIST_MAX_SEC : MAX_SEC)) toSec = fromSec + (listy ? LIST_MAX_SEC : MAX_SEC);
      if (toSec - fromSec < MIN_SEC) toSec = fromSec + MIN_SEC;
      toSec = Math.min(toSec, lastSentence - 0.05);
      if (toSec - fromSec < 1.6) return;
      const prev = out[out.length - 1];
      if (prev) {
        const pair = prev.spec.scene === spec.scene && prev.spec.verdict === 'bad' && spec.verdict === 'good';
        if (fromSec < prev.toSec + (pair ? 0 : MIN_GAP)) {
          if (!pair || fromSec < prev.toSec - 0.6) return;
        }
      }
      const start = prev && fromSec < prev.toSec ? prev.toSec : fromSec;
      // list items appear as they are said: `at` (a word index) → seconds into the drawing
      if (spec.items) {
        let last = 0;
        spec.items = spec.items.map((it, k) => {
          const w = it.at >= x.from && it.at <= x.to + 2 && it.at < n ? words[it.at] : null;
          const atSec = w ? Math.max(last, Math.round((w.start - start) * 100) / 100) : (listy ? last + (k ? 0.5 : 0.25) : 0);
          last = atSec;
          const { at, ...rest } = it; // eslint-disable-line no-unused-vars
          return listy ? { ...rest, atSec: Math.max(0, Math.round(last * 100) / 100) } : rest;
        });
      }
      // a list holds until its last point has been read (~1.2 s), within the limits
      if (listy && spec.items.length) {
        const times = spec.items.map((it) => start + (it.atSec || 0));
        const groups = [[0]];
        for (let k = 1; k < times.length; k += 1) {
          if (times[k] - times[k - 1] > LIST_GAP_SEC) groups.push([k]); else groups[groups.length - 1].push(k);
        }
        if (groups.length > 1) {
          // one card per run of points, the later ones returning with the earlier points already in place
          const wordAt = (t) => { let i = x.from; while (i + 1 < n && words[i + 1].start <= t) i += 1; return i; };
          groups.forEach((g, gi) => {
            const a = gi === 0 ? start : times[g[0]] - 0.5;
            const lastT = times[g[g.length - 1]];
            let b = Math.max(lastT + LIST_READ_SEC, a + MIN_SEC);
            b = Math.min(b, a + LIST_MAX_SEC, lastSentence - 0.05);
            if (gi + 1 < groups.length) b = Math.min(b, times[groups[gi + 1][0]] - 0.5 - 0.8); // footage between
            if (b - a < 1.6) return;
            const items = spec.items.map((it, k) => ({ ...it, atSec: Math.round((times[k] - a) * 100) / 100 }));
            out.push({
              fromSec: a, toSec: b, from: gi === 0 ? x.from : wordAt(a + 0.5), to: wordAt(lastT), strength: x.strength, why: str(x.why, 160),
              spec: { ...spec, items, ...(gi > 0 ? { resume: true } : {}) },
            });
          });
          return;
        }
        const lastAt = spec.items[spec.items.length - 1].atSec || 0;
        toSec = Math.min(Math.max(toSec, start + lastAt + 1.2), lastSentence - 0.05, start + LIST_MAX_SEC + 1.5);
      }
      out.push({ fromSec: start, toSec, from: x.from, to: x.to, strength: x.strength, why: str(x.why, 160), spec });
    });
  return out;
}

/* ── Teaser / photo reels (Capture › Reel, "Include graphics", studio 2026-11-25) ──────────────────────────
   A music-led reel has no speech to time a drawing against, so this agent reads the capture (the studio's
   own words) and the cut (shot by shot) and orders up to 2 drawings, each cut in AFTER a given shot as
   its own full-screen card. Same vocabulary and the same code checks as the talking-reel agent; numbers
   must be in the studio's words. Claude Sonnet 5.5 like the other reel agents (2026-11-27):
   REEL_TEASER_EXPLAINER_MODEL overrides. */
const TEASER_MAX = 2;
const TEASER_TOOL = (() => {
  const item = JSON.parse(JSON.stringify(EXPLAINER_TOOL.input_schema.properties.explainers.items));
  delete item.properties.from;
  delete item.properties.to;
  item.properties = { afterShot: { type: 'integer' }, ...item.properties };
  item.required = Object.keys(item.properties);
  return {
    name: 'design_reel_explainers',
    description: 'Animated explainer drawings cut into a photo reel (or none).',
    input_schema: o({ explainers: { type: 'array', items: item } }),
  };
})();
// how long a drawing holds on screen (its lines draw on in ~1.6 s, then it is read)
function teaserSeconds(spec) {
  const n = spec.items?.length || 0;
  if (spec.scene === 'checklist' || spec.scene === 'flow') return Math.min(LIST_MAX_SEC, 0.35 + Math.max(0, n - 1) * 0.75 + 2.0);
  if (spec.scene === 'stat') return 2.6;
  if (spec.scene === 'measure' || spec.scene === 'light') return 3.4;
  return 3.0;
}

/**
 * story: the studio's words (notes / summary / what they said in Capture); shots: [{ i, text, shows }] —
 * the cut in order (text = the words on that shot, shows = what the picture is).
 * Returns { explainers: [{ afterShot, durationSec, spec }], debug }.
 */
async function designTeaserExplainers({ story = '', shots = [], language = '' }) {
  if (process.env.REEL_EXPLAINERS === 'off' || shots.length < 2 || String(story).trim().split(/\s+/).length < 8) return { explainers: [], debug: null };
  const base = fs.readFileSync(PROMPT, 'utf8');
  // the drawing vocabulary is the talking-reel agent's, word for word
  const vocab = base.slice(base.indexOf('MEANING, NOT DECORATION'), base.indexOf('HOW YOUR DRAWING MOVES'))
    + base.slice(base.indexOf('THE DRAWINGS YOU CAN ORDER'), base.indexOf('FOR EVERY DRAWING:'));
  const system = fs.readFileSync(path.join(path.dirname(PROMPT), 'explainer-teaser.md'), 'utf8').replace('{{VOCABULARY}}', vocab);
  const user = JSON.stringify({
    studioWords: str(story, 2400),
    ...(language ? { language } : {}),
    shots: shots.map((x) => ({ i: x.i, text: str(x.text, 80), shows: str(x.shows, 160) })),
  });
  const model = process.env.REEL_TEASER_EXPLAINER_MODEL || 'claude-sonnet-5-5';
  const started = Date.now();
  const res = await completeToolCall({
    model, system, userParts: [{ type: 'text', text: user }], tool: TEASER_TOOL, maxTokens: 6000,
    kind: 'reelExplainers', timeoutMs: 120000,
    retryHint: 'Return ONLY the JSON object for design_reel_explainers, matching the schema exactly.',
  });
  const u = res.usage || {};
  const all = spokenNumbers(`${story} ${shots.map((x) => x.text).join(' ')}`);
  const last = shots.length - 1;
  const out = [];
  (Array.isArray(res.parsed?.explainers) ? res.parsed.explainers : [])
    .map((x) => ({ ...x, afterShot: Math.round(num(x?.afterShot, -1)), strength: Math.max(1, Math.min(5, Math.round(num(x?.strength, 3)))) }))
    // never before the hook has been seen, never after the last shot (the end card follows it)
    .filter((x) => x.afterShot >= 1 && x.afterShot < last && SCENES.includes(x.scene) && x.strength >= 3)
    .sort((a, b) => b.strength - a.strength)
    .forEach((x) => {
      if (out.length >= TEASER_MAX || out.some((y) => Math.abs(y.afterShot - x.afterShot) < 2)) return;
      const spec = specOf(x, all, all);
      if (!spec) return;
      const listy = spec.scene === 'checklist' || spec.scene === 'flow';
      if (spec.items) {
        // no words to time the points against: they land one after another
        spec.items = spec.items.map((it, k) => {
          const { at, ...rest } = it; // eslint-disable-line no-unused-vars
          return listy ? { ...rest, atSec: Math.round((0.35 + k * 0.75) * 100) / 100 } : rest;
        });
      }
      out.push({ afterShot: x.afterShot, durationSec: teaserSeconds(spec), strength: x.strength, why: str(x.why, 160), spec });
    });
  out.sort((a, b) => a.afterShot - b.afterShot);
  return {
    explainers: out,
    debug: {
      source: 'Capture reel — explainer animation agent (photo reel)',
      model: res.model,
      prompt: `${system}\n\n---\n\n${user}`,
      output: JSON.stringify({ agent: res.parsed, kept: out.map((x) => ({ afterShot: x.afterShot, sec: x.durationSec, ...x.spec })) }, null, 2),
      elapsedMs: Date.now() - started,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd: estimatePlanCostUsd(res.model, num(u.input_tokens), num(u.output_tokens), num(u.cached_tokens)),
    },
  };
}

module.exports = { designExplainers, designTeaserExplainers, cleanExplainers, spokenNumbers, EXPLAINER_TOOL };
