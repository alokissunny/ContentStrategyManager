/**
 * Prompt-based slide editing — the backend of Editor mode's prompt band.
 *
 * Cheap by construction: the Slide Edit agent (services/slideEditAgent.js)
 * gets ONE slide's `<article>` — as the studio sees it, every hand edit baked in
 * — and the change they asked for, and returns that article edited. A one-slide
 * ask is one small call; `Improve the flow` is one call per slide, in parallel,
 * each given a one-line summary of every slide as context.
 *
 * When the ask is for a visual, the Visual agent first art-directs and renders
 * one picture for the slide; its key and placement go into that slide's edit.
 *
 * Slides are then spliced back into the carousel document (every untouched
 * slide keeps the studio's markup byte for byte) and each changed slide's
 * pictures are re-read in slot order.
 */
const { generateRequestedVisual, requestedVisualAvailable } = require('./planOrchestrator');
const { editSlideHtml } = require('./slideEditAgent');
const { planIntent, focusedImage, swapFocusedImage, attrOf, PERSPECTIVE_PROMPT } = require('./slideActions');
const { editImage } = require('./openaiImage');
const { persistGeneratedImage } = require('./generatedImage');
const { getObjectBytes, getMediaUrl } = require('./s3Client');
const { toVisionImage } = require('./visionImage');
const {
  extractHtmlDocument,
  parseCarouselDocument,
  discoveredThemes,
  blockForDirection,
  slideArticles,
  htmlAttr,
  canonThemeId,
  stripDanger,
} = require('./layoutHtml');

const MAX_REFERENCE = 220000; // chars of carousel html sent as the reference
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

function err(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function openTagOf(article) {
  return String(article || '').match(/^<[a-z]+\b[^>]*>/i)?.[0] || '';
}

function indexOfArticle(article) {
  return Number(htmlAttr(openTagOf(article), 'data-index')) || 0;
}

// Style blocks that are not inside a slide (a slide's own <style> travels with it).
function outerStyles(html) {
  let rest = String(html || '');
  slideArticles(rest).forEach((a) => { rest = rest.replace(a, ''); });
  return [...rest.matchAll(STYLE_RE)].map((m) => m[0]);
}

function withIndex(article, index) {
  const open = openTagOf(article);
  if (!open || indexOfArticle(article) === index) return article;
  const next = /\sdata-index\s*=/.test(open)
    ? open.replace(/\sdata-index\s*=\s*("[^"]*"|'[^']*')/i, ` data-index="${index}"`)
    : open.replace(/>$/, ` data-index="${index}">`);
  return next + article.slice(open.length);
}

/**
 * One `<section data-direction>` holding the carousel as the studio sees it.
 * `slides` come from the client in order: { index, layoutHtml, themed }.
 * Returns { html, direction, articles: [{ index, html }], styles }.
 */
function composeCurrentCarousel({ carouselHtml, slides, direction }) {
  const doc = carouselHtml ? extractHtmlDocument(String(carouselHtml)) : '';
  const dirs = doc ? discoveredThemes(doc).map((d) => d.id) : [];
  const want = canonThemeId(direction);
  const dir = (want && dirs.includes(want) ? want : '') || dirs[0] || want || 'architectural-minimal';
  const block = doc ? (blockForDirection(doc, dir) || doc) : '';
  const docArticles = block ? slideArticles(block) : [];
  const styles = [];
  const addStyles = (list) => list.forEach((st) => { if (!styles.includes(st)) styles.push(st); });
  if (doc) addStyles(outerStyles(doc));

  const list = Array.isArray(slides) ? slides : [];
  const articles = list.map((s, i) => {
    const index = Number(s?.index) > 0 ? Number(s.index) : i + 1;
    let art = '';
    const own = String(s?.layoutHtml || '');
    if (own && (!s?.themed || !docArticles.length)) {
      art = slideArticles(own)[0] || '';
      if (art) addStyles(outerStyles(own));
    }
    if (!art) {
      art = docArticles.find((a) => indexOfArticle(a) === index) || docArticles[i] || '';
    }
    if (!art) throw err(400, `Slide ${index} has no layout to refine — try Fix layout first.`);
    return { index, html: withIndex(stripDanger(art), index) };
  });
  if (!articles.length) throw err(400, 'This post has no slides to refine.');
  const html = `<section data-direction="${dir}">\n${styles.join('\n')}\n${articles.map((a) => a.html).join('\n')}\n</section>`;
  if (html.length > MAX_REFERENCE) throw err(413, 'This carousel is too large to refine by prompt.');
  // the theme's font stylesheets — not for the model, only so a preview draws
  // the slide in its real type (https links only)
  const links = [...String(doc || '').matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => m[0])
    .filter((l) => /\bhref\s*=\s*["']https:\/\//i.test(l));
  return { html, direction: dir, articles, styles, links: [...new Set(links)] };
}

// Does this instruction ask for a picture? The band's `visual` action says so
// outright; typed words are read for an add/generate verb near a picture noun.
const VISUAL_ASK = /\b(add|adding|include|insert|put|place|give|generate|create|make|show|use)\b[^.?!]{0,48}\b(visual|image|picture|photo|photograph|illustration|graphic|artwork|sketch|render)s?\b/i;
function asksForVisual(instruction, flag) {
  if (flag === true) return true;
  if (flag === false) return false;
  return VISUAL_ASK.test(String(instruction || ''));
}

// The asset keys an article's image slots hold, in slot order — a slot with a
// data-asset-key keeps it; a bare slot takes the next of the slide's previous
// keys (that is how the renderer binds them).
function slotKeysOf(article, prevKeys, own) {
  const prev = (prevKeys || []).slice();
  const used = new Set();
  const keys = [];
  String(article || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    if (!/\bdata-slot\s*=\s*["'](?:image|illustration)["']/i.test(attrs)) return '';
    const k = htmlAttr(`<img ${attrs}>`, 'data-asset-key');
    if (k && k.startsWith(own)) { keys.push(k); used.add(k); return ''; }
    const next = prev.find((x) => !used.has(x));
    if (next) { keys.push(next); used.add(next); }
    return '';
  });
  return keys;
}

/**
 * @param {object} p
 * @param {string} p.instruction
 * @param {number|null} p.slideIndex  the slide in scope (null = every slide)
 * @param {object|null} p.focus       { slideIndex, tag, slot, text } — also marked in the html
 * @param {object} p.current          { carouselHtml, slides: [{ index, layoutHtml, themed, assetKeys, role, title }] }
 * @returns {{ html, slides, direction, result }} — `html` is the new carousel document
 */
// A debug-panel row: what went into one step and what came out of it.
function logStep(debug, entry) {
  if (!Array.isArray(debug)) return;
  const u = entry.usage || {};
  debug.push({
    source: entry.source,
    model: entry.model || '',
    prompt: typeof entry.prompt === 'string' ? entry.prompt : JSON.stringify(entry.prompt ?? '', null, 2),
    output: typeof entry.output === 'string' ? entry.output : JSON.stringify(entry.output ?? '', null, 2),
    elapsedMs: Number(entry.elapsedMs) || 0,
    inputTokens: Number(u.inputTokens) || 0,
    outputTokens: Number(u.outputTokens) || 0,
    totalTokens: Number(u.totalTokens) || 0,
    estimatedCostUsd: Number(u.estimatedCostUsd) || 0,
    ...(entry.preview ? { preview: entry.preview } : {}),
  });
}

// What the debug panel's Preview button draws: the slide(s) before and after,
// in the carousel's own CSS and direction, the way the editor renders them.
const PREVIEW_CSS_MAX = 60000;
function previewOf(composed, slides) {
  const css = [...(composed.links || []), ...composed.styles].join('\n');
  return {
    direction: composed.direction,
    css: css.length > PREVIEW_CSS_MAX ? css.slice(0, PREVIEW_CSS_MAX) : css,
    slides,
  };
}

// `debug` (optional array) collects one row per step — the request, the Visual
// agent (when a picture was asked for), each slide edit, the saved result — so
// the Editor's debug panel shows the input and output of every edit, even when
// a later step fails.
async function refineCarouselFromEdits({
  userId, handle, label, instruction, slideIndex, focus, current, brand,
  visual: visualFlag, visualSlideIndex, slideRecords, strategy, layoutIssues, geometry, slideCss, debug, intent,
}) {
  const t0 = Date.now();
  // the chip path that was pressed (Editor chat) — a precise brief for the
  // agent, or a picture operation it cannot do by rewriting html
  const plan = planIntent(intent);
  if (plan.unsupported) throw err(422, plan.unsupported);
  const ask = String(instruction || '').trim();
  if (!ask) throw err(400, 'Say what should change.');
  if (ask.length > 800) throw err(400, 'Keep the instruction under 800 characters.');
  const slides = Array.isArray(current?.slides) ? current.slides : [];
  const composed = composeCurrentCarousel({
    carouselHtml: current?.carouselHtml,
    slides,
    direction: current?.direction,
  });
  const n = composed.articles.length;
  const target = Number(slideIndex) > 0 ? Number(slideIndex) : null;
  if (target && !composed.articles.some((a) => a.index === target)) throw err(404, 'Slide not found on this post.');
  const own = `projects/${userId}/`;
  const keysAt = (index) => {
    const i = composed.articles.findIndex((a) => a.index === index);
    return (slides[i]?.assetKeys || []).filter((k) => String(k).startsWith(own));
  };
  const pictureOp = (plan.op === 'replace' || plan.op === 'perspective') ? plan.op : '';
  const wantsVisual = !pictureOp && (plan.op === 'add' || asksForVisual(ask, visualFlag));
  logStep(debug, {
    source: 'Prompt edit · request',
    prompt: {
      instruction: ask,
      scope: target ? `slide ${target} of ${n}` : `all ${n} slides`,
      focus: focus || null,
      visualRequested: wantsVisual,
      pressed: plan.pressed || null,
      pictureOp: pictureOp || plan.op || null,
      brief: plan.brief || null,
    },
    output: { slides: target ? [target] : composed.articles.map((a) => a.index) },
    elapsedMs: Date.now() - t0,
  });

  // ── the Visual agent, when a picture was asked for ──────────────────────
  let visual = null;
  const visualAt = Number(visualSlideIndex) > 0 ? Number(visualSlideIndex)
    : (target || Number(focus?.slideIndex) || null);
  if (wantsVisual && visualAt && composed.articles.some((a) => a.index === visualAt)) {
    if (!requestedVisualAvailable()) {
      visual = { ok: false, skipReason: 'Image generation is not configured.' };
    } else {
      const record = (Array.isArray(slideRecords) ? slideRecords : [])
        .find((s, i) => (Number(s?.index) > 0 ? Number(s.index) : i + 1) === visualAt) || { index: visualAt };
      try {
        visual = await generateRequestedVisual({
          source: `SlideEdit:${label}#${visualAt}:visual`,
          request: ask,
          slide: record,
          existingPictures: [],
          brief: {},
          brand,
          userId,
          handle,
        });
      } catch (e) {
        console.warn(`[carouselRefine] visual agent failed — ${e.message}`);
        visual = { ok: false, skipReason: e.message };
      }
    }
    if (visual?.debugEntry) {
      logStep(debug, {
        source: 'Prompt edit · Visual agent (image brief)',
        model: visual.debugEntry.model,
        prompt: visual.debugEntry.prompt,
        output: visual.debugEntry.output,
        elapsedMs: visual.debugEntry.elapsedMs,
        usage: visual.debugEntry.usage,
      });
    }
    if (visual?.ok) {
      logStep(debug, {
        source: 'Prompt edit · Image render',
        model: visual.model,
        prompt: visual.finalPrompt,
        output: { key: visual.key, url: visual.src, placement: visual.placement, alt: visual.alt },
        elapsedMs: visual.usage?.imageElapsedMs,
        usage: { estimatedCostUsd: visual.usage?.imageCostUsd },
      });
    } else if (visual) {
      logStep(debug, { source: 'Prompt edit · Visual agent', output: `Skipped — ${visual.skipReason || 'no reason given'}` });
    }
  }

  // ── a picture operation on the selected image: done directly ────────────
  // `Generate a new image` / `Correct the perspective` change what ONE picture
  // shows, not the slide — so the new bytes go into the selected <img> in
  // place (same box, same classes) and the html agent is not called at all.
  const picAt = target || Number(focus?.slideIndex) || null;
  const picArticle = pictureOp && picAt ? composed.articles.find((a) => a.index === picAt) : null;
  const picTag = picArticle ? focusedImage(picArticle.html) : null;
  if (pictureOp && !picTag) throw err(400, 'Select the picture first, then choose what to do with it.');
  if (pictureOp) {
    const tp = Date.now();
    let made = null;
    if (pictureOp === 'perspective') {
      const key = attrOf(picTag.tag, 'data-asset-key');
      const src = attrOf(picTag.tag, 'src');
      if (!key && !/^https?:\/\//i.test(src)) throw err(400, 'This frame has no photo to straighten yet.');
      let bytes;
      if (key) {
        bytes = await getObjectBytes(key);
      } else {
        const r = await fetch(src);
        if (!r.ok) throw err(502, 'Could not read the photo to straighten.');
        bytes = { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || '' };
      }
      const vision = await toVisionImage(bytes.buffer, bytes.contentType, key || src);
      const edited = await editImage({ buffer: vision.buffer, mediaType: vision.mediaType, prompt: PERSPECTIVE_PROMPT });
      const stored = await persistGeneratedImage({ userId, handle, buffer: edited.buffer, mimeType: edited.mimeType, prompt: PERSPECTIVE_PROMPT, model: edited.model });
      let url = '';
      try { url = await getMediaUrl(stored.key); } catch { /* resolves client-side by key */ }
      made = { ok: true, key: stored.key, src: url, alt: attrOf(picTag.tag, 'alt'), placement: 'replace', model: edited.model, usage: { imageElapsedMs: edited.elapsedMs, imageCostUsd: edited.estimatedCostUsd, estimatedCostUsd: edited.estimatedCostUsd } };
      logStep(debug, {
        source: 'Prompt edit · Image edit (perspective)',
        model: edited.model,
        prompt: `${PERSPECTIVE_PROMPT}\n\nSource: ${key || src}`,
        output: { key: stored.key, url },
        elapsedMs: edited.elapsedMs,
        usage: { estimatedCostUsd: edited.estimatedCostUsd },
      });
    } else {
      if (!requestedVisualAvailable()) throw err(503, 'Image generation is not configured.');
      const record = (Array.isArray(slideRecords) ? slideRecords : [])
        .find((x, i) => (Number(x?.index) > 0 ? Number(x.index) : i + 1) === picAt) || { index: picAt };
      const wanted = attrOf(picTag.tag, 'data-image-request') || attrOf(picTag.tag, 'alt');
      made = await generateRequestedVisual({
        source: `SlideEdit:${label}#${picAt}:replace`,
        request: [ask, wanted ? `The picture this frame is for: ${wanted}` : ''].filter(Boolean).join('\n'),
        slide: record,
        existingPictures: [],
        brief: strategy || {},
        brand,
        userId,
        handle,
      });
      if (made?.debugEntry) {
        logStep(debug, {
          source: 'Prompt edit · Visual agent (image brief)',
          model: made.debugEntry.model,
          prompt: made.debugEntry.prompt,
          output: made.debugEntry.output,
          elapsedMs: made.debugEntry.elapsedMs,
          usage: made.debugEntry.usage,
        });
      }
      if (!made?.ok) throw err(422, made?.skipReason || 'Bauhly could not make a picture for this frame.');
      logStep(debug, {
        source: 'Prompt edit · Image render',
        model: made.model,
        prompt: made.finalPrompt,
        output: { key: made.key, url: made.src },
        elapsedMs: made.usage?.imageElapsedMs,
        usage: { estimatedCostUsd: made.usage?.imageCostUsd },
      });
    }
    const swapped = swapFocusedImage(picArticle.html, made);
    if (!swapped) throw err(422, 'Could not find the selected picture on the slide.');
    const i = composed.articles.findIndex((a) => a.index === picAt);
    const articles = composed.articles.map((a, j) => (j === i ? withIndex(swapped, a.index) : a.html));
    const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n<section data-direction="${composed.direction}">\n${composed.styles.join('\n')}\n${articles.join('\n')}\n</section>\n</body></html>`;
    const parsed = parseCarouselDocument(html, n);
    if (!parsed.slides.length) throw err(502, 'Bauhly returned a slide the editor cannot read — try again.');
    const slideKeys = { [picAt]: slotKeysOf(articles[i], keysAt(picAt), own) };
    logStep(debug, {
      source: 'Prompt edit · result (saved)',
      prompt: `${plan.pressed || ask} — picture ${pictureOp === 'perspective' ? 'straightened' : 'replaced'} on slide ${picAt}.`,
      output: { changed: [picAt], slideKeys, key: made.key },
      elapsedMs: Date.now() - tp,
      preview: previewOf(composed, [{ index: picAt, before: picArticle.html, after: articles[i] }]),
    });
    return {
      html: parsed.html,
      slides: parsed.slides,
      direction: composed.direction,
      changed: [picAt],
      slideKeys,
      visual: { ...made, placed: true },
      model: made.model || '',
      usage: { totalTokens: 0, estimatedCostUsd: Number(made.usage?.estimatedCostUsd) || 0 },
    };
  }

  // the pressed chip's meaning goes to the agent with the studio's sentence
  const agentAsk = plan.brief
    ? `${ask}\n\nWHAT WAS PRESSED: ${plan.pressed}\nWHAT IT MEANS: ${plan.brief}`
    : (plan.pressed ? `${ask}\n\nWHAT WAS PRESSED: ${plan.pressed}` : ask);

  // ── the Slide Edit agent: one slide's html + the change, per slide ───────
  const plain = (html) => String(html || '').replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const flowLines = target ? null : composed.articles.map((a) => plain(a.html));
  const todo = composed.articles.filter((a) => !target || a.index === target);
  const edited = await Promise.all(todo.map(async (a) => {
    try {
      const rec = (Array.isArray(slideRecords) ? slideRecords : [])
        .find((x, i) => (Number(x?.index) > 0 ? Number(x.index) : i + 1) === a.index) || {};
      const r = await editSlideHtml({
        instruction: agentAsk,
        html: a.html,
        newPicture: visual?.ok && a.index === visualAt ? visual : null,
        otherSlides: flowLines,
        strategy,
        brand,
        slide: { index: a.index, count: n, role: rec.role, purpose: rec.purpose || rec.contentGuidance },
        // a repair pass: problems the editor measured on this slide as rendered
        layoutIssues: target && a.index === target ? layoutIssues : null,
        // measured on the active slide only — the one the editor is drawing
        geometry: a.index === (target || visualAt || Number(focus?.slideIndex) || 0) ? geometry : null,
        slideCss: a.index === (target || visualAt || Number(focus?.slideIndex) || 0) ? slideCss : '',
      });
      logStep(debug, {
        source: `Prompt edit · Slide edit agent (slide ${a.index})${Array.isArray(layoutIssues) && layoutIssues.length ? ' · layout repair' : ''}`,
        model: r.model,
        prompt: r.prompt,
        output: r.staticIssues?.length
          ? `${r.output}\n\n[static layout check after ${r.attempts} attempt(s): ${r.staticIssues.join(' | ')}]`
          : `${r.output}${r.attempts > 1 ? `\n\n[static layout check: fixed on attempt ${r.attempts}]` : ''}`,
        elapsedMs: r.elapsedMs,
        usage: r.usage,
        preview: previewOf(composed, [{ index: a.index, before: a.html, after: r.html }]),
      });
      return { index: a.index, html: r.html, unchanged: r.unchanged, model: r.model, usage: r.usage };
    } catch (e) {
      logStep(debug, {
        source: `Prompt edit · Slide edit agent (slide ${a.index})`,
        model: e.debug?.model,
        prompt: e.debug?.prompt || `CHANGE: ${ask}\n\nSLIDE:\n${a.html}`,
        output: `Error — ${e.message}${e.debug?.output ? `\n\n${e.debug.output}` : ''}`,
        elapsedMs: e.debug?.elapsedMs,
        usage: e.debug?.usage,
      });
      return { index: a.index, error: e };
    }
  }));
  const done = edited.filter((x) => x.html && !x.unchanged);
  if (!done.length) {
    const firstErr = edited.find((x) => x.error)?.error;
    throw firstErr || err(422, 'That would leave the slide as it is — try saying it another way.');
  }
  const byIndex = new Map(done.map((x) => [x.index, x.html]));
  const articles = composed.articles.map((a) => (byIndex.has(a.index) ? withIndex(byIndex.get(a.index), a.index) : a.html));
  const changed = done.map((x) => x.index);

  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n<section data-direction="${composed.direction}">\n${composed.styles.join('\n')}\n${articles.join('\n')}\n</section>\n</body></html>`;
  const parsed = parseCarouselDocument(html, n);
  if (!parsed.slides.length) throw err(502, 'Bauhly returned a slide the editor cannot read — try again.');
  // each changed slide's pictures, in the order its image slots now hold them
  const slideKeys = {};
  changed.forEach((idx) => {
    const i = composed.articles.findIndex((a) => a.index === idx);
    slideKeys[idx] = slotKeysOf(articles[i], keysAt(idx), own);
  });
  if (visual?.ok) visual = { ...visual, placed: Object.values(slideKeys).some((ks) => ks.includes(visual.key)) };
  logStep(debug, {
    source: 'Prompt edit · result (saved)',
    prompt: `Slides edited: ${changed.join(', ')}. Every other slide keeps the studio's markup.`,
    output: {
      changed,
      failed: edited.filter((x) => x.error).map((x) => ({ index: x.index, error: x.error.message })),
      slideKeys,
      visual: visual ? (visual.ok ? { key: visual.key, placement: visual.placement, placed: visual.placed } : { skipped: visual.skipReason }) : null,
      slides: changed.map((idx) => ({ index: idx, html: byIndex.get(idx) })),
    },
    elapsedMs: Date.now() - t0,
    preview: previewOf(composed, changed.map((idx) => ({
      index: idx,
      before: composed.articles.find((a) => a.index === idx)?.html || '',
      after: articles[composed.articles.findIndex((a) => a.index === idx)],
    }))),
  });
  return {
    html: parsed.html,
    slides: parsed.slides,
    direction: composed.direction,
    changed,
    slideKeys,
    visual,
    model: done[0]?.model || '',
    usage: done.reduce((acc, x) => ({
      totalTokens: acc.totalTokens + (Number(x.usage?.totalTokens) || 0),
      estimatedCostUsd: acc.estimatedCostUsd + (Number(x.usage?.estimatedCostUsd) || 0),
    }), { totalTokens: 0, estimatedCostUsd: 0 }),
  };
}

module.exports = { refineCarouselFromEdits, composeCurrentCarousel, withIndex, slotKeysOf, logStep, previewOf };
