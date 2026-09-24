/**
 * Slide Edit agent — the cheap path behind Editor mode's prompt band.
 *
 * Input is kept small: ONE slide's `<article>` (every hand edit already baked
 * into it), the change the studio asked for, a COMPACT copy of the strategist's
 * brief (angle, central fact, verified truths, narrative units — capped, see
 * `compactStrategy`), the brand's voice and never-do lines, the slide's job, its
 * rendered metrics and the theme CSS rules that apply to THIS slide (filtered on
 * the live DOM in the editor). No carousel document, no picture analyses, no
 * attached image. The
 * carousel agent's aesthetic and truth guardrails live in the prompt's static
 * system part (prompts/slide-edit.md), which providers cache across calls.
 * Output is that one article, edited. A small, low-effort model call.
 *
 * Model: PLAN_SLIDE_EDIT_MODEL / PLAN_SLIDE_EDIT_PROVIDER (planAgentLlm
 * `slideEdit`); effort PLAN_SLIDE_EDIT_REASONING_EFFORT (default low).
 */
const fs = require('fs');
const path = require('path');
const { completeText, resolvePlanAgentLlm, splitPromptTemplate } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'slide-edit.md');
let template = null;
function promptParts() {
  if (!template) template = splitPromptTemplate(fs.readFileSync(PROMPT_FILE, 'utf8'));
  return template;
}

// ── compact context ───────────────────────────────────────────────────────
// The strategist's brief can run to many KB (captures, asset context, a whole
// outline). The edit only needs what keeps it on-angle and truthful, so strings
// are clipped, lists capped and the rest dropped — a fixed small budget.
function clip(v, n) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
function shrink(v, depth = 0) {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string') return clip(v, depth ? 220 : 400) || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const out = v.slice(0, 8).map((x) => shrink(x, depth + 1)).filter((x) => x !== undefined);
    return out.length ? out : undefined;
  }
  if (typeof v === 'object' && depth < 3) {
    const out = {};
    Object.entries(v).slice(0, 10).forEach(([k, x]) => {
      const y = shrink(x, depth + 1);
      if (y !== undefined) out[k] = y;
    });
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
const STRATEGY_FIELDS = [
  'angle', 'pillar', 'lens', 'pillarJob', 'uniqueJob', 'audienceTension', 'hookTerritory',
  'centralFact', 'verifiedTruth', 'observableDetails', 'narrativeUnits', 'ownedTerritory',
  'doNotRepeat', 'knownLimitation', 'format',
];
function compactStrategy(brief) {
  if (!brief || typeof brief !== 'object') return '';
  const out = {};
  STRATEGY_FIELDS.forEach((k) => {
    const v = shrink(brief[k]);
    if (v !== undefined) out[k] = v;
  });
  const stage = brief.project?.stage || brief.project?.status || brief.projectStage;
  if (stage) out.projectStage = clip(stage, 60);
  if (brief.project?.name || brief.project?.title) out.project = clip(brief.project.name || brief.project.title, 120);
  let text = JSON.stringify(out);
  // hard ceiling — drop the heaviest fields first
  for (const k of ['narrativeUnits', 'observableDetails', 'ownedTerritory', 'hookTerritory']) {
    if (text.length <= 3500) break;
    delete out[k];
    text = JSON.stringify(out);
  }
  return text.length > 3500 ? text.slice(0, 3500) : text;
}
function compactBrandVoice(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const lines = [];
  if (b.voice) lines.push(`How they sound: ${clip(b.voice, 300)}`);
  if (b.audience) lines.push(`Audience: ${clip(b.audience, 200)}`);
  if (b.position) lines.push(`Position: ${clip(b.position, 200)}`);
  const never = Array.isArray(b.guardrails) && b.guardrails.length ? b.guardrails.join('; ') : b.neverDo;
  if (never) lines.push(`Never: ${clip(never, 300)}`);
  return lines.join('\n');
}

// The slide as the editor renders it, in a few lines. The html the model edits
// carries positions but not type sizes — the carousel's theme CSS (not sent,
// for cost) sets those, and a headline with no inline font-size can render at
// 90px+. Without these numbers the model places lines as if type were small.
function renderedMetrics(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.runs)) return '';
  const n = (v) => Math.round(Number(v) || 0);
  const out = [`RENDERED SLIDE (measured in the editor with the carousel's theme CSS, which you cannot see — plan every size and position from these numbers, not from the raw html). Canvas ${n(g.width)}×${n(g.height)}px; inline left/top/width values are in this same px space.`];
  g.runs.slice(0, 14).forEach((r) => {
    const b = r.box || {};
    out.push(`- ${clip(r.slot || r.tag, 24)} "${clip(r.text, 40)}": ${clip(r.font, 60)}, ${n(r.lines)} line(s), ${clip(r.position, 12)}, box x${n(b.x)} y${n(b.y)} w${n(b.w)} h${n(b.h)}`);
  });
  (Array.isArray(g.images) ? g.images : []).slice(0, 6).forEach((i) => {
    const b = i.box || {};
    out.push(`- picture (${clip(i.slot, 16)}): box x${n(b.x)} y${n(b.y)} w${n(b.w)} h${n(b.h)}`);
  });
  return out.join('\n');
}

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Only the one <article>, nothing that can run, focus marker off.
function sanitizeArticle(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:html|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const start = raw.search(/<article\b/i);
  const end = raw.toLowerCase().lastIndexOf('</article>');
  if (start < 0 || end < start) return '';
  return raw.slice(start, end + '</article>'.length)
    .replace(/\sdata-bauhly-focus\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form|link|meta|style)\b[\s\S]*?(?:<\/\1>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

// ── markup that is certain to cut text off ────────────────────────────────
// Geometry (overlap, overflow) needs a rendered page — the editor measures that
// and sends it back as `layoutIssues`. What can be read from the markup alone
// is truncation: counted per pattern, and only flagged when the edit ADDED it
// (a slide that already clipped something is the studio's design).
const TRUNCATION = [
  { re: /line-clamp\s*:/gi, say: 'Text is clamped to a number of lines (line-clamp) — remove the clamp so every word shows.' },
  { re: /text-overflow\s*:\s*ellipsis/gi, say: 'Text is cut with an ellipsis (text-overflow: ellipsis) — let it wrap instead.' },
  { re: /style="[^"]*\b(?:max-)?height\s*:[^";]+;[^"]*overflow\s*:\s*hidden|style="[^"]*overflow\s*:\s*hidden[^"]*\b(?:max-)?height\s*:/gi, say: 'A container has a fixed height with overflow hidden — text inside it gets cut off. Remove the fixed height or the hidden overflow.' },
];
function textRunsWithNowrap(html) {
  let n = 0;
  String(html || '').replace(/<([a-z0-9]+)\b[^>]*style="[^"]*white-space\s*:\s*nowrap[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => {
    const words = String(inner).replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    if (words > 4) n += 1;
    return '';
  });
  return n;
}
function staticLayoutIssues(next, source) {
  const out = [];
  TRUNCATION.forEach(({ re, say }) => {
    const count = (h) => (String(h || '').match(re) || []).length;
    if (count(next) > count(source)) out.push(say);
  });
  if (textRunsWithNowrap(next) > textRunsWithNowrap(source)) {
    out.push('A run of several words is forced onto one line (white-space: nowrap) — it will overflow; let it wrap.');
  }
  return out;
}

function indexAttr(article) {
  const open = String(article || '').match(/^<article\b[^>]*>/i)?.[0] || '';
  const m = open.match(/\sdata-index\s*=\s*("([^"]*)"|'([^']*)')/i);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

/**
 * @param {string} instruction   the change, in the studio's words
 * @param {string} html          the slide's <article>
 * @param {object} [newPicture]  { key, alt, placement } — a picture made for this request
 * @param {string[]} [otherSlides] one short line per slide — only for flow-type asks
 * @param {object} [strategy]    the strategist's brief (compacted here)
 * @param {object} [brand]       compiled brand memory (voice / never-do used)
 * @param {object} [slide]       { index, count, role, purpose } — this slide's job
 * @param {string[]} [layoutIssues] problems measured on the RENDERED slide (repair pass)
 * @param {object} [geometry]     the slide as rendered: { width, height, runs:[{slot, font, lines, box}], images }
 * @param {string} [slideCss]     the theme CSS rules that apply to this slide (read-only)
 */
async function editSlideHtml({ instruction, html, newPicture, otherSlides, strategy, brand, slide, layoutIssues, geometry, slideCss } = {}) {
  const ask = String(instruction || '').trim();
  if (!ask) throw err(400, 'Say what should change.');
  if (ask.length > 800) throw err(400, 'Keep the instruction under 800 characters.');
  const source = String(html || '').trim();
  if (!/^<article\b/i.test(source)) throw err(400, 'This slide has no layout to edit — try Fix layout first.');
  if (source.length > 60000) throw err(413, 'This slide is too large to edit by prompt.');

  const lines = [`CHANGE: ${ask}`];
  if (newPicture?.key) {
    const alt = String(newPicture.alt || '').replace(/"/g, "'");
    lines.push(
      `NEW PICTURE (made for this request): place <img data-slot="image" data-asset-key="${newPicture.key}" alt="${alt}"> `
      + (newPicture.placement === 'background'
        ? 'full-bleed behind the words (object-fit: cover), words kept legible — add a soft scrim only if needed.'
        : 'as a framed inset beside or under the words (object-fit: cover), large enough to read on a phone.')
      + ' Compose the slide around it; add no other empty picture slot.',
    );
  }
  const measured = (Array.isArray(layoutIssues) ? layoutIssues : []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 12);
  if (measured.length) {
    lines.push(`LAYOUT PROBLEMS (measured on the rendered slide — fix every one, keep everything else):\n${measured.map((x) => `- ${x}`).join('\n')}`);
  }
  const metrics = renderedMetrics(geometry);
  if (metrics) lines.push(metrics);
  const others = (Array.isArray(otherSlides) ? otherSlides : []).map((s) => String(s || '').trim()).filter(Boolean);
  if (others.length) lines.push(`THE CAROUSEL'S SLIDES, IN ORDER (context only):\n${others.map((s, i) => `${i + 1}. ${s.slice(0, 140)}`).join('\n')}`);

  const { system, userTemplate } = promptParts();
  const ctx = [];
  if (slide?.index) ctx.push(`Slide ${slide.index}${slide.count ? ` of ${slide.count}` : ''}${slide.index === slide.count && slide.count > 1 ? ' (final slide)' : ''}${slide.index === 1 ? ' (hook)' : ''}`);
  if (slide?.role) ctx.push(`Role: ${clip(slide.role, 60)}`);
  if (slide?.purpose) ctx.push(`Job: ${clip(slide.purpose, 240)}`);
  const fill = {
    '{{STRATEGY}}': compactStrategy(strategy) || 'None supplied — keep to what the slide already says.',
    '{{BRAND_VOICE}}': compactBrandVoice(brand) || 'None supplied — keep the voice the slide already has.',
    '{{SLIDE_CONTEXT}}': ctx.join('\n') || 'Not supplied.',
    '{{REQUEST}}': lines.join('\n\n'),
    '{{SLIDE_CSS}}': String(slideCss || '').trim().slice(0, 16000) || 'Not supplied — only inline styles are known.',
    '{{SLIDE_HTML}}': source,
  };
  const user = Object.entries(fill).reduce((acc, [k, v]) => acc.split(k).join(v), userTemplate);
  const llm = resolvePlanAgentLlm('slideEdit');
  // the answer is the article again, plus what was asked for — bound it by that
  const maxTokens = Math.min(16000, Math.max(2500, Math.ceil(source.length / 2.5) + 1500));
  const started = Date.now();
  let last = null;
  let retryNote = '';
  let fallback = null; // a valid article that still had static problems
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await completeText({
      model: llm.model,
      system,
      user: attempt === 1 ? user : `${user}\n\n${retryNote}`,
      maxTokens,
      kind: 'slideEdit',
      cacheKey: 'igsignal-slide-edit',
      timeoutMs: 90000,
    });
    const inputTokens = (last?.usage?.inputTokens || 0) + (Number(res.usage?.input_tokens) || 0);
    const outputTokens = (last?.usage?.outputTokens || 0) + (Number(res.usage?.output_tokens) || 0);
    const cached = Number(res.usage?.cached_tokens) || 0;
    last = {
      output: res.text,
      model: res.model,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: estimatePlanCostUsd(res.model, inputTokens, outputTokens, cached),
      },
    };
    const next = sanitizeArticle(res.text);
    const idx = indexAttr(source);
    if (next && (idx == null || indexAttr(next) === idx) && res.stopReason !== 'max_tokens') {
      const issues = staticLayoutIssues(next, source);
      const done = {
        html: next,
        unchanged: next.replace(/\s+/g, ' ') === sanitizeArticle(source).replace(/\s+/g, ' '),
        model: res.model,
        prompt: `${system}\n\n${user}`,
        output: res.text,
        usage: last.usage,
        elapsedMs: Date.now() - started,
        attempts: attempt,
        staticIssues: issues,
      };
      if (!issues.length || attempt === 2) return done;
      fallback = done;
      retryNote = `(Your previous answer broke the layout rules:\n${issues.map((x) => `- ${x}`).join('\n')}\nReturn the whole edited article again with these fixed.)`;
      continue;
    }
    retryNote = `(Your previous answer was not one complete <article> with data-index="${indexAttr(source)}". Return the whole edited article only.)`;
  }
  if (fallback) return { ...fallback, usage: last.usage, elapsedMs: Date.now() - started };
  const e = err(502, 'Bauhly could not edit this slide — try saying it another way.');
  e.debug = { prompt: `${system}\n\n${user}`, output: last?.output || '', model: last?.model, usage: last?.usage, elapsedMs: Date.now() - started };
  throw e;
}

module.exports = { editSlideHtml, sanitizeArticle, compactStrategy, compactBrandVoice, staticLayoutIssues };
