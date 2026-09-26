/**
 * Add Slide agent — Editor mode › Slide › Add before / Add after.
 *
 * The studio answers Capture's "What is this new slide about?" (the capture is
 * filed to the Content Library as any capture is). That capture — the words,
 * the conversation's summary and understanding, any pictures attached — goes
 * here with the post's FULL strategy brief, the brand voice, the carousel's
 * theme CSS, an outline of every slide and the two neighbour slides. The agent
 * returns ONE new `<article>` in the carousel's own design.
 *
 * If the slide reserves an empty image slot (`data-image-request`) and the
 * studio attached no picture, the Visual agent renders one for it.
 *
 * The article is spliced in at the chosen position, every later slide is
 * renumbered, and the carousel document is rebuilt — the other slides keep the
 * studio's markup byte for byte.
 *
 * Model: PLAN_ADD_SLIDE_MODEL / PLAN_ADD_SLIDE_PROVIDER (planAgentLlm
 * `addSlide`); effort PLAN_ADD_SLIDE_REASONING_EFFORT (default low).
 */
const fs = require('fs');
const path = require('path');
const { completeText, resolvePlanAgentLlm, splitPromptTemplate } = require('./llmComplete');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { sanitizeArticle, compactBrandVoice, staticLayoutIssues } = require('./slideEditAgent');
const { composeCurrentCarousel, withIndex, slotKeysOf, logStep, previewOf } = require('./carouselRefine');
const { parseCarouselDocument, htmlAttr, injectImageIntoSlots } = require('./layoutHtml');
const { generateRequestedVisual, requestedVisualAvailable } = require('./planOrchestrator');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'add-slide.md');
let template = null;
function promptParts() {
  if (!template) template = splitPromptTemplate(fs.readFileSync(PROMPT_FILE, 'utf8'));
  return template;
}

const STRATEGY_MAX = 60000; // the full brief, bounded only against runaway size
const CSS_MAX = 40000;

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function clip(v, n) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const plainOfHtml = (html) => String(html || '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function indexAttr(article) {
  const open = String(article || '').match(/^<article\b[^>]*>/i)?.[0] || '';
  return Number(htmlAttr(open, 'data-index')) || 0;
}

// What the studio told Capture, as the agent reads it.
function captureBlock(capture) {
  const c = capture && typeof capture === 'object' ? capture : {};
  const out = [];
  if (c.text) out.push(`In their words: ${clip(c.text, 2400)}`);
  if (c.conversationTitle) out.push(`Title: ${clip(c.conversationTitle, 160)}`);
  if (c.conversationSummary) out.push(`Summary: ${clip(c.conversationSummary, 1200)}`);
  const turns = (Array.isArray(c.turns) ? c.turns : [])
    .filter((t) => t && t.text)
    .slice(0, 12)
    .map((t) => `${t.role === 'assistant' ? 'Bauhly asked' : 'Studio said'}: ${clip(t.text, 400)}`);
  if (turns.length > 1) out.push(`The conversation:\n${turns.join('\n')}`);
  const u = c.understanding && typeof c.understanding === 'object' ? c.understanding : null;
  if (u) {
    const json = JSON.stringify(u);
    out.push(`What the conversation understood: ${json.length > 3000 ? `${json.slice(0, 3000)}…` : json}`);
  }
  if (c.projectName) out.push(`Filed to project: ${clip(c.projectName, 120)}`);
  return out.join('\n\n');
}

function fullStrategy(brief) {
  if (!brief || typeof brief !== 'object') return '';
  const text = JSON.stringify(brief, null, 1);
  return text.length > STRATEGY_MAX ? `${text.slice(0, STRATEGY_MAX)}…` : text;
}

/**
 * Write the new slide's <article>. Retries once when the answer is not one
 * article with the right data-index, or adds markup that cuts text off.
 */
async function writeNewSlide({ position, newIndex, capture, pictures, strategy, brand, outline, css, neighbours }) {
  const { system, userTemplate } = promptParts();
  const fill = {
    '{{POSITION}}': position,
    '{{CAPTURE}}': captureBlock(capture) || 'Nothing was said — write the beat the story most needs here.',
    '{{PICTURES}}': pictures.length
      ? pictures.map((k) => `- data-asset-key="${k}"`).join('\n')
      : 'None attached.',
    '{{STRATEGY}}': fullStrategy(strategy) || 'None supplied — keep to what the capture and the neighbour slides say.',
    '{{BRAND_VOICE}}': compactBrandVoice(brand) || 'None supplied — keep the voice the carousel already has.',
    '{{OUTLINE}}': outline,
    '{{CAROUSEL_CSS}}': css || 'Not supplied — match the neighbours\' inline styles.',
    '{{NEIGHBOURS}}': neighbours,
  };
  const user = Object.entries(fill).reduce((acc, [k, v]) => acc.split(k).join(v), userTemplate);
  const llm = resolvePlanAgentLlm('addSlide');
  const started = Date.now();
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  let retryNote = '';
  let fallback = null;
  let lastOutput = '';
  let model = llm.model;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await completeText({
      model: llm.model,
      system,
      user: attempt === 1 ? user : `${user}\n\n${retryNote}`,
      maxTokens: 12000,
      kind: 'addSlide',
      cacheKey: 'igsignal-add-slide',
      timeoutMs: 120000,
    });
    model = res.model || model;
    lastOutput = res.text;
    const inputTokens = usage.inputTokens + (Number(res.usage?.input_tokens) || 0);
    const outputTokens = usage.outputTokens + (Number(res.usage?.output_tokens) || 0);
    usage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: usage.estimatedCostUsd
        + estimatePlanCostUsd(res.model, Number(res.usage?.input_tokens) || 0, Number(res.usage?.output_tokens) || 0, Number(res.usage?.cached_tokens) || 0),
    };
    let next = sanitizeArticle(res.text);
    if (next && res.stopReason !== 'max_tokens') {
      // the index is ours to set — a model that numbers it wrongly is not a failure
      if (indexAttr(next) !== newIndex) next = withIndex(next, newIndex);
      const issues = staticLayoutIssues(next, '');
      const done = { html: next, model, prompt: `${system}\n\n${user}`, output: res.text, attempts: attempt, staticIssues: issues };
      if (!issues.length || attempt === 2) return { ...done, usage, elapsedMs: Date.now() - started };
      fallback = done;
      retryNote = `(Your previous answer broke the layout rules:\n${issues.map((x) => `- ${x}`).join('\n')}\nReturn the whole new article again with these fixed.)`;
      continue;
    }
    retryNote = '(Your previous answer was not one complete <article>. Return the whole new slide article only.)';
  }
  if (fallback) return { ...fallback, usage, elapsedMs: Date.now() - started };
  const e = err(502, 'Bauhly could not write the new slide — try again, or say it another way.');
  e.debug = { prompt: `${system}\n\n${user}`, output: lastOutput, model, usage, elapsedMs: Date.now() - started };
  throw e;
}

/**
 * @param {object} p
 * @param {number} p.at        insert position, 0-based (0 = before the first slide)
 * @param {object} p.capture   { text, conversationSummary, conversationTitle, understanding, turns, attachments:[{key,type}], projectName }
 * @param {object} p.current   { carouselHtml, direction, slides: [{ index, layoutHtml, themed, assetKeys }] }
 * @param {object} p.strategy  the post's full strategy brief (agentTrace.strategyBrief)
 * @returns {{ html, slides, newIndex, article, keys, visual, model, usage }}
 */
async function addSlideToCarousel({ userId, handle, label, at, capture, current, strategy, brand, slideRecords, debug }) {
  const t0 = Date.now();
  const slides = Array.isArray(current?.slides) ? current.slides : [];
  const composed = composeCurrentCarousel({
    carouselHtml: current?.carouselHtml,
    slides,
    direction: current?.direction,
  });
  const n = composed.articles.length;
  const pos = Math.max(0, Math.min(Number.isFinite(Number(at)) ? Number(at) : n, n));
  const newIndex = pos + 1;
  const own = `projects/${userId}/`;
  const pictures = (Array.isArray(capture?.attachments) ? capture.attachments : [])
    .filter((a) => a && (a.type === 'image' || !a.type))
    .map((a) => String(a.key || '').trim())
    .filter((k) => k.startsWith(own))
    .slice(0, 4);

  const records = Array.isArray(slideRecords) ? slideRecords : [];
  const lineOf = (a, i) => {
    const r = records[i] || {};
    const role = r.role ? `[${clip(r.role, 30)}] ` : '';
    return `${role}${clip(plainOfHtml(a.html), 160)}`;
  };
  const outlineRows = composed.articles.map((a, i) => `${a.index < newIndex ? a.index : a.index + 1}. ${lineOf(a, i)}`);
  outlineRows.splice(pos, 0, `${newIndex}. ← THE NEW SLIDE GOES HERE`);
  const before = composed.articles[pos - 1] || null;
  const after = composed.articles[pos] || null;
  const neighbours = [
    before ? `BEFORE (becomes slide ${pos}):\n${before.html}` : 'BEFORE: none — the new slide is the first slide (the hook).',
    after ? `AFTER (becomes slide ${newIndex + 1}):\n${after.html}` : 'AFTER: none — the new slide is the final slide.',
  ].join('\n\n');
  const position = [
    `The new slide is slide ${newIndex} of ${n + 1} (data-index="${newIndex}").`,
    newIndex === 1 ? 'It becomes the FIRST slide — the hook.' : '',
    newIndex === n + 1 ? 'It becomes the FINAL slide.' : '',
  ].filter(Boolean).join(' ');
  const cssAll = composed.styles.join('\n');
  const css = cssAll.length > CSS_MAX ? cssAll.slice(0, CSS_MAX) : cssAll;

  logStep(debug, {
    source: 'Add slide · request',
    prompt: { position, capture: captureBlock(capture), pictures },
    output: { at: pos, newIndex, of: n + 1 },
    elapsedMs: Date.now() - t0,
  });

  let written;
  try {
    written = await writeNewSlide({
      position, newIndex, capture, pictures, strategy, brand, outline: outlineRows.join('\n'), css, neighbours,
    });
  } catch (e) {
    logStep(debug, {
      source: 'Add slide · Add slide agent',
      model: e.debug?.model,
      prompt: e.debug?.prompt || '',
      output: `Error — ${e.message}${e.debug?.output ? `\n\n${e.debug.output}` : ''}`,
      elapsedMs: e.debug?.elapsedMs,
      usage: e.debug?.usage,
    });
    throw e;
  }
  let article = written.html;
  logStep(debug, {
    source: 'Add slide · Add slide agent',
    model: written.model,
    prompt: written.prompt,
    output: written.staticIssues?.length
      ? `${written.output}\n\n[static layout check after ${written.attempts} attempt(s): ${written.staticIssues.join(' | ')}]`
      : written.output,
    elapsedMs: written.elapsedMs,
    usage: written.usage,
    preview: previewOf(composed, [{ index: newIndex, before: '', after: article }]),
  });

  // ── a picture for a reserved slot, when the studio attached none ─────────
  let visual = null;
  const reserved = (article.match(/<img\b[^>]*\bdata-slot\s*=\s*["']image["'][^>]*>/gi) || [])
    .find((tag) => !htmlAttr(tag, 'src') && !htmlAttr(tag, 'data-asset-key') && htmlAttr(tag, 'data-image-request'));
  if (reserved && !pictures.length) {
    if (!requestedVisualAvailable()) {
      visual = { ok: false, skipReason: 'Image generation is not configured.' };
    } else {
      try {
        visual = await generateRequestedVisual({
          source: `AddSlide:${label}#${newIndex}:visual`,
          request: htmlAttr(reserved, 'data-image-request'),
          slide: { index: newIndex, title: plainOfHtml(article).slice(0, 200) },
          existingPictures: [],
          brief: strategy || {},
          brand,
          userId,
          handle,
        });
      } catch (e) {
        console.warn(`[addSlide] visual agent failed — ${e.message}`);
        visual = { ok: false, skipReason: e.message };
      }
    }
    if (visual?.debugEntry) {
      logStep(debug, {
        source: 'Add slide · Visual agent (image brief)',
        model: visual.debugEntry.model,
        prompt: visual.debugEntry.prompt,
        output: visual.debugEntry.output,
        elapsedMs: visual.debugEntry.elapsedMs,
        usage: visual.debugEntry.usage,
      });
    }
    if (visual?.ok) {
      article = injectImageIntoSlots(article, { src: visual.src, assetKey: visual.key });
      logStep(debug, {
        source: 'Add slide · Image render',
        model: visual.model,
        prompt: visual.finalPrompt,
        output: { key: visual.key, url: visual.src },
        elapsedMs: visual.usage?.imageElapsedMs,
        usage: { estimatedCostUsd: visual.usage?.imageCostUsd },
      });
    }
  }

  // ── splice it in and renumber what follows ─────────────────────────────
  const articles = composed.articles.map((a) => (a.index >= newIndex ? withIndex(a.html, a.index + 1) : a.html));
  articles.splice(pos, 0, withIndex(article, newIndex));
  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n<section data-direction="${composed.direction}">\n${composed.styles.join('\n')}\n${articles.join('\n')}\n</section>\n</body></html>`;
  const parsed = parseCarouselDocument(html, n + 1);
  if (!parsed.slides.length) throw err(502, 'Bauhly returned a slide the editor cannot read — try again.');
  const keys = slotKeysOf(article, pictures, own);
  logStep(debug, {
    source: 'Add slide · result (saved)',
    prompt: `Slide ${newIndex} of ${n + 1} added. Every other slide keeps the studio's markup.`,
    output: { newIndex, keys, visual: visual ? (visual.ok ? { key: visual.key } : { skipped: visual.skipReason }) : null, html: article },
    elapsedMs: Date.now() - t0,
  });
  return {
    html: parsed.html,
    slides: parsed.slides,
    direction: composed.direction,
    newIndex,
    at: pos,
    article,
    keys,
    visual,
    model: written.model,
    usage: {
      totalTokens: written.usage.totalTokens,
      estimatedCostUsd: written.usage.estimatedCostUsd + (Number(visual?.usage?.estimatedCostUsd) || 0),
    },
  };
}

module.exports = { addSlideToCarousel, captureBlock };
