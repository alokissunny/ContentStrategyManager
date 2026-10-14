/*
 * Theme Apply agent — HTML output. Chosen per request by the Design Rules
 * agent's read of the reference (themeDesignRules: output.mode 'html' when the
 * look can be reproduced by restyling the slide's own HTML/CSS; 'image' →
 * themeApplyAgent.js, the image render). Prompt: prompts/theme-apply-html.md
 * (the same brief as the image render: inspiration notes, typography from the
 * reference, brand colours, nothing new on the slide).
 *
 * Text-to-text: the slide goes in as its carousel HTML + CSS and comes back as
 * HTML + CSS — no image model. The words, data-slots and photos stay live, so
 * Edit text and element edits keep working on a themed slide.
 *   1. the slide's article (with the document's CSS and font links) is cut
 *      out of the carousel document; picture URLs are swapped for short
 *      placeholders so the prompt carries no signed URLs or data URIs;
 *   2. the model (THEME_HTML_MODEL, OpenAI gpt-5.6-terra by default) gets the HTML,
 *      the reference image and the inspiration notes, returns one document;
 *   3. code checks the contract (one article, every data-slot word kept,
 *      every picture kept, no new elements) — one retry naming the problems —
 *      then restores the picture URLs.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { completeText } = require('./llmComplete');
const { extractHtmlDocument } = require('./layoutHtml');
const { sectionsOf, indexOf, buildDocument, stylesOf, linksOf } = require('./themeMerge');
const { designRulesSection } = require('./themeDesignRules');
const { estimatePlanCostUsd } = require('./weeklyPlan');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'theme-apply-html.md');
let promptCache = '';
const loadPrompt = () => (promptCache || (promptCache = fs.readFileSync(PROMPT_PATH, 'utf8').trim()));

// OpenAI only (no Anthropic): gpt-5.6-terra passed the HTML tests (~3¢, ~15s/slide)
const THEME_HTML_MODEL = () => process.env.THEME_HTML_MODEL || 'gpt-5.6-terra';
// optional second model for when the main one's provider refuses the call
// (bad key, rate limit, outage) — off unless set; the slide then falls back
// to the image render
const THEME_HTML_FALLBACK_MODEL = () => process.env.THEME_HTML_FALLBACK_MODEL || '';
const providerTrouble = (err) => /credit balance|billing|quota|insufficient|api key|unauthori[sz]ed|permission|rate.?limit|overloaded|\b(401|402|403|429|5\d\d)\b/i
  .test(`${err?.status || ''} ${err?.message || ''}`);
const THEME_HTML_EFFORT = () => process.env.THEME_HTML_EFFORT || 'medium';
const HTML_DIRECTION = 'themed-html';

// ── the slide in ────────────────────────────────────────────────────────────
/**
 * One slide of a carousel document as a document of its own, or null — only
 * the CSS that draws it (unscoped blocks + its own section's), with its section
 * already renamed `themed-html` so those locked rules still apply after the
 * merge.
 */
function slideDocumentOf(doc, slideIndex) {
  const want = Number(slideIndex) || 0;
  const sections = sectionsOf(doc);
  const sec = sections.find((s) => s.articles.some((a) => indexOf(a) === want));
  const article = sec?.articles.find((a) => indexOf(a) === want);
  if (!article) return null;
  const others = sections.map((s) => s.dir).filter((d) => d !== sec.dir);
  const scopedTo = (c, d) => c.includes(`data-direction="${d}"`);
  const css = stylesOf(doc)
    .filter((c) => scopedTo(c, sec.dir) || !others.some((d) => scopedTo(c, d)))
    .map((c) => c.split(`data-direction="${sec.dir}"`).join(`data-direction="${HTML_DIRECTION}"`));
  return buildDocument({ links: linksOf(doc), css, sections: [{ dir: HTML_DIRECTION, articles: [article] }] });
}

// Picture sources (signed URLs, data URIs) out of the prompt and back again.
function maskAssets(html) {
  const assets = [];
  const token = (v) => { assets.push(v); return `__ASSET_${assets.length}__`; };
  const masked = String(html || '')
    .replace(/\s(src|srcset|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, q, a, b) => {
      const v = a ?? b ?? '';
      return v && !/^__ASSET_\d+__$/.test(v) ? ` ${attr}="${token(v)}"` : m;
    })
    .replace(/url\(\s*(["']?)(data:[^)"']+|https?:[^)"']+)\1\s*\)/gi, (m, q, v) => `url("${token(v)}")`);
  return { masked, assets };
}
const unmaskAssets = (html, assets) => String(html || '')
  .replace(/__ASSET_(\d+)__/g, (m, n) => (assets[Number(n) - 1] !== undefined ? assets[Number(n) - 1] : m));

// ── the contract check ──────────────────────────────────────────────────────
const decode = (t) => String(t || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"');
const norm = (t) => decode(String(t || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();

// Every data-slot element that holds text: { slot, text }.
function slotTexts(html) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bdata-slot\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const text = norm(m[3]);
    if (text) out.push({ slot: m[2].toLowerCase(), text });
  }
  return out;
}
const assetTokensOf = (html) => [...new Set(String(html || '').match(/__ASSET_\d+__/g) || [])];
const assetKeysOf = (html) => [...new Set([...String(html || '').matchAll(/data-asset-key\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]))];

function contractProblems(source, out) {
  const problems = [];
  const sections = out ? sectionsOf(out) : [];
  const articles = sections.flatMap((s) => s.articles);
  if (!articles.length) return ['no <section data-direction> with an <article class="slide"> came back'];
  if (articles.length > 1) problems.push(`return exactly one article (got ${articles.length})`);
  const body = norm(out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' '));
  slotTexts(source).forEach((e) => {
    if (!body.includes(e.text)) problems.push(`the ${e.slot} text "${e.text.slice(0, 80)}" is missing or changed — keep it word for word`);
  });
  const outSlots = new Set(slotTexts(out).map((e) => e.slot));
  [...new Set(slotTexts(source).map((e) => e.slot))].forEach((slot) => {
    if (!outSlots.has(slot)) problems.push(`the data-slot="${slot}" element is gone — keep the attribute on the element that holds that text`);
  });
  // pictures in the markup must survive; old CSS backgrounds may be restyled away
  assetTokensOf(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')).forEach((t) => { if (!out.includes(t)) problems.push(`picture placeholder ${t} is missing — keep every <img> and its src`); });
  assetKeysOf(source).forEach((k) => { if (!out.includes(k)) problems.push(`the picture with data-asset-key="${k}" is missing`); });
  if (/<script\b/i.test(out)) problems.push('remove the <script> — no JavaScript');
  // nothing new on the slide: no more elements of any kind than the source had
  const tagsOf = (h) => {
    const counts = {};
    const body = String(h || '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const article = (body.match(/<article\b[\s\S]*<\/article>/i) || [''])[0];
    for (const m of article.matchAll(/<([a-z][a-z0-9-]*)\b/gi)) counts[m[1].toLowerCase()] = (counts[m[1].toLowerCase()] || 0) + 1;
    return counts;
  };
  const before = tagsOf(source);
  const after = tagsOf(out);
  const added = Object.keys(after).filter((t) => after[t] > (before[t] || 0)).map((t) => `${after[t] - (before[t] || 0)} <${t}>`);
  if (added.length) problems.push(`new elements were added (${added.join(', ')}) — restyle only the slide's own elements, add none`);
  return problems;
}

// The returned document, normalised: section id `themed-html`, the slide's own
// data-index on the article.
function normalizeDocument(html, slideIndex) {
  let doc = extractHtmlDocument(html);
  const first = sectionsOf(doc)[0];
  if (first && first.dir !== HTML_DIRECTION) doc = doc.split(`data-direction="${first.dir}"`).join(`data-direction="${HTML_DIRECTION}"`);
  return doc
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/(<article\b[^>]*\bdata-index\s*=\s*["'])\d+(["'])/i, `$1${Number(slideIndex) || 1}$2`);
}

// The slide's own CSS is locked: whatever the model did to those blocks, the
// originals go back in, followed by the blocks it added (its theme layer).
function lockSourceCss(source, out) {
  const head = (c) => String(c).replace(/\s+/g, ' ').trim().slice(0, 80);
  const original = stylesOf(source);
  const heads = new Set(original.map(head));
  const added = stylesOf(out).filter((c) => !heads.has(head(c)));
  const sections = sectionsOf(out);
  if (!sections.length) return out;
  return buildDocument({
    links: [...linksOf(source), ...linksOf(out)],
    css: [...original, ...added],
    sections: [{ dir: HTML_DIRECTION, articles: sections[0].articles.slice(0, 1) }],
  });
}

// ── brand colours (the slide's Brand Kit set, when the studio sent it) ──────
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function brandNotes(colors) {
  const pick = (v) => (HEX.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '');
  const c = colors && typeof colors === 'object'
    ? { ground: pick(colors.ground || colors.bg), fg: pick(colors.fg || colors.ink), accent: pick(colors.accent) }
    : {};
  if (!c.ground && !c.fg && !c.accent) return '';
  return [
    '## Brand colours',
    '',
    'The slide\'s Brand Kit colours — with the colours its HTML defines, the only colours you may use:',
    c.ground ? `- Background: ${c.ground}` : '',
    c.fg ? `- Text and dark surfaces: ${c.fg}` : '',
    c.accent ? `- Accent: ${c.accent}` : '',
    '',
  ].filter((l, i, all) => l || all[i - 1]).join('\n');
}

/**
 * @param {{ slideIndex: number, slideDoc: string, reference: { buffer: Buffer },
 *   brandColors?: object|null, designRules?: object|null }} p
 * @returns {Promise<{ html, model, usage, prompt, problems, themeDescription, debugEntry }>}
 */
async function applyThemeHtmlToSlide({ slideIndex, slideDoc, reference, brandColors = null, designRules = null }) {
  if (!reference?.buffer) throw new Error('A reference photo is required.');
  if (!slideDoc) throw new Error(`Slide ${slideIndex} has no HTML design to re-theme — run Fix layout first.`);
  const started = Date.now();
  let model = THEME_HTML_MODEL();
  let switchedFrom = null;
  const ref = await sharp(reference.buffer).rotate()
    .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer();
  const { masked, assets } = maskAssets(slideDoc);
  const system = loadPrompt();
  const user = [
    `The reference image is attached. The HTML below is slide ${slideIndex} (data-index="${slideIndex}") — all its pictures are present. Answer with the THEME DESCRIPTION, then the restyled slide in one \`\`\`html block.`,
    '',
    designRulesSection(designRules),
    '',
    brandNotes(brandColors),
    '## The slide (HTML)',
    '',
    masked,
  ].join('\n');

  const calls = [];
  const run = async (extra = '') => {
    const call = (m) => completeText({
      model: m,
      system,
      user: extra ? `${user}\n\n${extra}` : user,
      image: { mediaType: 'image/jpeg', data: ref.toString('base64') },
      maxTokens: 32000,
      reasoningEffort: THEME_HTML_EFFORT(),
      timeoutMs: 300000,
    });
    let r;
    try {
      r = await call(model);
    } catch (err) {
      const backup = THEME_HTML_FALLBACK_MODEL();
      if (!backup || backup === model || !providerTrouble(err)) throw err;
      console.warn(`[themeApplyHtml] slide ${slideIndex}: ${model} unavailable (${String(err.message || err).slice(0, 160)}) — using ${backup}`);
      switchedFrom = { model, error: String(err.message || err).slice(0, 300) };
      model = backup;
      r = await call(model);
    }
    calls.push(r);
    if (r.stopReason === 'refusal') throw new Error('The theme model declined this slide.');
    const doc = normalizeDocument(r.text, slideIndex);
    // part 1 of the answer: the portable theme description (kept for debug)
    const description = String(r.text || '').split(/```|<!doctype html|<html[\s>]/i)[0].trim();
    return { doc, description, problems: contractProblems(masked, doc), stopReason: r.stopReason };
  };

  let best = await run();
  if (best.problems.length) {
    console.warn(`[themeApplyHtml] slide ${slideIndex}: ${best.problems.join('; ')} — retrying once`);
    const again = await run(`FIX THESE PROBLEMS from your previous answer, and return the whole document again:\n- ${best.problems.join('\n- ')}`);
    if (again.problems.length <= best.problems.length) best = again;
  }
  if (!sectionsOf(best.doc).length) throw new Error(`The theme model returned no usable slide for slide ${slideIndex}${best.stopReason === 'max_tokens' ? ' (its answer was cut off)' : ''}.`);
  if (best.problems.length) console.warn(`[themeApplyHtml] slide ${slideIndex} kept with: ${best.problems.join('; ')}`);

  const html = unmaskAssets(lockSourceCss(masked, best.doc), assets);
  const usage = calls.reduce((a, c) => {
    const i = Number(c.usage?.input_tokens ?? c.usage?.prompt_tokens) || 0;
    const o = Number(c.usage?.output_tokens ?? c.usage?.completion_tokens) || 0;
    return {
      inputTokens: a.inputTokens + i,
      outputTokens: a.outputTokens + o,
      totalTokens: a.totalTokens + i + o,
      estimatedCostUsd: a.estimatedCostUsd + estimatePlanCostUsd(model, i, o),
      elapsedMs: Date.now() - started,
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, elapsedMs: 0 });

  return {
    html,
    model,
    ...(switchedFrom ? { switchedFrom } : {}),
    usage,
    // the slide as it went in — previewed in the debug panel
    inputHtml: String(slideDoc || '').replace(/(["'(])data:[^"')]{2000,}/gi, '$1').slice(0, 60000),
    prompt: user,
    problems: best.problems,
    themeDescription: best.description || '',
    debugEntry: {
      source: `ThemeApply (HTML):slide ${slideIndex}`,
      model: `${model} · effort ${THEME_HTML_EFFORT()}`,
      prompt: `${system}\n\n---\n\n${user}\n\nInput image: theme reference`,
      output: `${switchedFrom ? `NOTE: ${switchedFrom.model} was unavailable (${switchedFrom.error}) — answered by ${model}\n\n` : ''}${best.description ? `${best.description}\n\n---\n\n` : ''}${best.doc}${calls.length > 1 ? '\n\n(2 calls — the first answer broke the contract)' : ''}${best.problems.length ? `\n\nStill open: ${best.problems.join('; ')}` : ''}`,
      elapsedMs: usage.elapsedMs,
    },
  };
}

module.exports = { applyThemeHtmlToSlide, slideDocumentOf, HTML_DIRECTION };
