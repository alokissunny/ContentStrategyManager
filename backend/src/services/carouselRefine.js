/**
 * Prompt-based carousel refinement — the backend of Editor mode's prompt band.
 *
 * The studio's CURRENT carousel is the reference the model recreates from:
 *   · the carousel document as it stands (every hand edit already baked in —
 *     moved / resized / rotated elements, restyled and retyped text, hidden
 *     elements), with any slide that carries its own html (a variation, an
 *     element slide) spliced in over the document's copy of that slide;
 *   · the pictures on every slide (asset keys, in slot order) and what each one
 *     shows — the project upload's stored analysis, a generated image's prompt,
 *     or a live vision read for the few that have neither;
 *   · the main picture of the slide in scope, attached as an image;
 *   · the instruction, its scope and the focused element (marked in the html).
 *
 * When the instruction asks for a visual (the band's `Add a visual`, or words
 * like "add a picture of…"), the Visual agent runs FIRST on the slide in scope:
 * it art-directs one picture from the request, the slide's words and what the
 * carousel's other pictures look like, renders it and stores it. That picture
 * is then handed to the carousel agent as a supplied asset — its key, what it
 * shows, how it should sit, and the image itself to look at — so the carousel
 * is composed AROUND the new visual rather than around an empty slot.
 *
 * The Carousel Refine agent (planOrchestrator.refineCarousel) returns the whole
 * carousel. For a one-slide instruction only that slide's new <article> is
 * taken — every other slide keeps the studio's markup byte for byte, whatever
 * the model did to it.
 */
const Project = require('../models/Project');
const User = require('../models/User');
const { refineCarousel, generateRequestedVisual, requestedVisualAvailable } = require('./planOrchestrator');
const { analyzeImageAsset, loadReferenceImage } = require('./imageAnalysis');
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
const MAX_LIVE_ANALYSES = 3; // vision reads for pictures with no stored description
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
  return { html, direction: dir, articles, styles };
}

/** What every picture on every slide shows. Keys must be the user's own. */
async function describePictures({ userId, slides }) {
  const own = `projects/${userId}/`;
  const bySlide = (Array.isArray(slides) ? slides : []).map((s, i) => ({
    index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
    keys: (Array.isArray(s?.assetKeys) ? s.assetKeys : [])
      .map((k) => String(k || '').trim())
      .filter((k) => k && k.startsWith(own))
      .slice(0, 6),
  }));
  const keys = [...new Set(bySlide.flatMap((s) => s.keys))];
  const said = new Map();
  if (keys.length) {
    const projects = await Project.find(
      { user: userId, 'captures.attachments.key': { $in: keys } },
      { 'captures.attachments': 1 },
    ).lean().catch(() => []);
    projects.forEach((p) => (p.captures || []).forEach((c) => (c.attachments || []).forEach((a) => {
      if (!keys.includes(a.key) || !a.analysis || a.analysis.status !== 'done') return;
      said.set(a.key, {
        shows: a.analysis.description || a.analysis.summary || '',
        subjects: (a.analysis.subjects || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).slice(0, 6),
        mood: a.analysis.mood || '',
        colors: (a.analysis.colors || []).slice(0, 5),
      });
    })));
    const missing = keys.filter((k) => !said.has(k));
    if (missing.length) {
      const user = await User.findById(userId, { generatedImages: 1 }).lean().catch(() => null);
      (user?.generatedImages || []).forEach((g) => {
        if (missing.includes(g.key) && g.prompt) said.set(g.key, { shows: `Generated image: ${g.prompt}` });
      });
    }
    const unread = keys.filter((k) => !said.has(k)).slice(0, MAX_LIVE_ANALYSES);
    await Promise.all(unread.map(async (k) => {
      try {
        const a = await analyzeImageAsset(k);
        said.set(k, { shows: a.description || a.summary || '', mood: a.mood || '', colors: (a.colors || []).slice(0, 5) });
      } catch { /* described as unknown below */ }
    }));
  }
  return bySlide.map((s) => ({
    slide: s.index,
    pictures: s.keys.map((k, n) => ({ slot: n + 1, assetKey: k, ...(said.get(k) || { shows: 'unknown' }) })),
  }));
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
async function refineCarouselFromEdits({
  userId, handle, label, instruction, slideIndex, focus, current, brand, themeId,
  visual: visualFlag, visualSlideIndex, brief, slideRecords,
}) {
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

  const pictures = await describePictures({ userId, slides });

  // ── the Visual agent, when a picture was asked for ──────────────────────
  let visual = null;
  let refineAsk = ask;
  const visualAt = Number(visualSlideIndex) > 0 ? Number(visualSlideIndex)
    : (target || Number(focus?.slideIndex) || null);
  if (asksForVisual(ask, visualFlag) && visualAt && composed.articles.some((a) => a.index === visualAt)) {
    if (!requestedVisualAvailable()) {
      visual = { ok: false, skipReason: 'Image generation is not configured.' };
    } else {
      const record = (Array.isArray(slideRecords) ? slideRecords : [])
        .find((s, i) => (Number(s?.index) > 0 ? Number(s.index) : i + 1) === visualAt) || { index: visualAt };
      try {
        visual = await generateRequestedVisual({
          source: `CarouselRefine:${label}#${visualAt}:visual`,
          request: ask,
          slide: record,
          existingPictures: pictures.flatMap((p) => p.pictures.map((x) => ({ slide: p.slide, shows: x.shows, mood: x.mood }))).slice(0, 8),
          brief,
          brand,
          userId,
          handle,
        });
      } catch (e) {
        console.warn(`[carouselRefine] visual agent failed — ${e.message}`);
        visual = { ok: false, skipReason: e.message };
      }
    }
    if (visual?.ok) {
      const entry = pictures.find((p) => p.slide === visualAt);
      const pic = {
        slot: 'new',
        assetKey: visual.key,
        shows: visual.alt || visual.imagePrompt,
        placement: visual.placement,
        madeForThisRequest: true,
      };
      if (entry) entry.pictures.push(pic);
      else pictures.push({ slide: visualAt, pictures: [pic] });
      refineAsk = `${ask}\n\nA new picture was made for this request (it is the attached image): asset key "${visual.key}" — ${visual.alt || 'see the attached image'}. `
        + `Put it on slide ${visualAt} as <img data-slot="image" data-asset-key="${visual.key}" alt="${String(visual.alt || '').replace(/"/g, "'")}"> `
        + (visual.placement === 'background'
          ? 'full-bleed behind the words (object-fit: cover), keeping the words legible over its calm area — add a soft scrim only if they would not be.'
          : 'as a framed inset beside or under the words (object-fit: cover), large enough to read on a phone.')
        + ' Compose the slide around it. Do not add any other empty picture slot for this request.';
    }
  }

  const leadKey = visual?.ok ? visual.key
    : (target ? pictures.find((p) => p.slide === target)?.pictures?.[0]?.assetKey : null);
  const image = leadKey ? await loadReferenceImage(leadKey).catch(() => null) : null;

  const scope = target
    ? `Slide ${target} of ${n} only. Every other slide comes back unchanged.`
    : `All ${n} slides.`;
  const cleanFocus = focus && typeof focus === 'object' ? {
    slide: Number(focus.slideIndex) || target,
    element: String(focus.tag || ''),
    slot: String(focus.slot || ''),
    currentText: String(focus.text || '').slice(0, 240),
  } : null;

  const result = await refineCarousel({
    source: `CarouselRefine:${label}${target ? `#${target}` : ''}`,
    currentHtml: composed.html,
    direction: composed.direction,
    instruction: refineAsk,
    scope,
    focus: cleanFocus,
    pictures,
    brand,
    themeId,
    image: image || undefined,
    expectedSlides: n,
  });
  if (result?.parsed?.status === 'failed' || !result?.parsed?.html) {
    throw err(422, result?.parsed?.failureReason || 'Bauhly could not recreate this carousel — try saying it another way.');
  }

  // The model's carousel, one article per index, focus markers off.
  const unmark = (h) => String(h || '').replace(/\sdata-bauhly-focus\s*=\s*("[^"]*"|'[^']*')/gi, '');
  const outDoc = unmark(stripDanger(result.parsed.html));
  const outBlock = blockForDirection(outDoc, composed.direction) || outDoc;
  const outArticles = slideArticles(outBlock);
  const newArticle = (index, i) => outArticles.find((a) => indexOfArticle(a) === index) || outArticles[i] || '';

  // Rules the model added travel with the result; the studio's own are kept.
  const styles = composed.styles.slice();
  outerStyles(outDoc).forEach((st) => { if (!styles.includes(st)) styles.push(st); });

  const articles = composed.articles.map((a, i) => {
    if (target && a.index !== target) return a.html;
    const fresh = newArticle(a.index, i);
    return fresh ? withIndex(fresh, a.index) : a.html;
  });
  const html = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body>\n<section data-direction="${composed.direction}">\n${styles.join('\n')}\n${articles.join('\n')}\n</section>\n</body></html>`;
  const parsed = parseCarouselDocument(html, n);
  if (!parsed.slides.length) throw err(502, 'Bauhly returned a carousel the editor cannot read — try again.');
  const changed = target ? [target] : composed.articles.map((a) => a.index);
  // each changed slide's pictures, in the order its image slots now hold them
  const own = `projects/${userId}/`;
  const slideKeys = {};
  composed.articles.forEach((a, i) => {
    if (!changed.includes(a.index)) return;
    const prev = (slides[i]?.assetKeys || []).filter((k) => String(k).startsWith(own));
    slideKeys[a.index] = slotKeysOf(articles[i], prev, own);
  });
  // the new picture must have landed — if the model dropped it, say so
  if (visual?.ok && !Object.values(slideKeys).some((ks) => ks.includes(visual.key))) {
    visual = { ...visual, placed: false };
  } else if (visual?.ok) {
    visual = { ...visual, placed: true };
  }
  return {
    html: parsed.html,
    slides: parsed.slides,
    direction: composed.direction,
    changed,
    slideKeys,
    visual,
    result,
  };
}

module.exports = { refineCarouselFromEdits, composeCurrentCarousel, describePictures };
