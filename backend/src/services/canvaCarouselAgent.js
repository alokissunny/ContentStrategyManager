// Design in Canva (experimental), through Canva's MCP server and the studio's
// own Canva account. Two ways in:
//  · importCarouselToCanva (default): the carousel agent's output — the post's
//    slide HTML — is imported as ONE editable multi-page Canva design
//    (import-design-from-url, each slide a page), then exported page by page.
//  · designCarouselInCanva (source 'brief'): the strategy brief + each slide's
//    copy go to Canva's AI, one generate-design per slide.
// Either way each page comes back as a `themed-` picture in S3, so the slide
// slots into the carousel exactly like a Theme Apply render (Remove theme puts
// the carousel agent's design back), and refreshCanvaDesign re-exports the
// design after the studio edits it in Canva.
const crypto = require('node:crypto');
const sharp = require('sharp');
const { withCanva } = require('./canvaMcp');
const { uploadBytes, getPresignedDownloadUrl, getMediaUrl, publicMediaUrl, deleteObjects } = require('./s3Client');
const { HTML_THEME_FONTS_URL } = require('./htmlThemes');

const CONCURRENCY = Math.max(1, Number(process.env.CANVA_CONCURRENCY) || 2);
const INTENT = 'Design one slide of an Instagram carousel from a content strategy brief';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const textOf = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return clean(v);
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join('; ');
  if (typeof v === 'object') return clean(v.text || v.title || v.label || v.value || [v.title, v.body].filter(Boolean).join(' — '));
  return '';
};
const listOf = (v) => (Array.isArray(v) ? v.map(textOf).filter(Boolean) : []);

// One look for every slide of the carousel: the studio's Brand Kit colours and
// fonts and Business memory's visual style, else the app's Warm editorial look.
function styleLine(brand = {}) {
  const parts = [];
  const p = brand.palette;
  if (p?.background || p?.primary || p?.accent) {
    parts.push(`colours ${[p.background && `background ${p.background}`, p.primary && `text ${p.primary}`, p.accent && `accent ${p.accent}`].filter(Boolean).join(', ')}`);
  }
  const f = brand.fonts || {};
  const fonts = ['heading', 'body'].map((r) => f[r]?.family && `${r} font ${f[r].family}`).filter(Boolean);
  if (fonts.length) parts.push(fonts.join(', '));
  if (brand.visualStyle) parts.push(clean(brand.visualStyle).slice(0, 240));
  if (!parts.length) parts.push('warm editorial: cream background, serif headlines, terracotta accent, generous margins, calm and premium');
  return parts.join('. ');
}

// What Canva is asked for one slide (it sees no earlier call, so every query
// carries the whole context).
function slideQuery({ brief = {}, brand = {}, slide = {}, index, total, hasPhoto }) {
  const role = index === 1 ? 'cover / hook slide' : index === total ? 'closing slide' : 'content slide';
  const words = [
    slide.title && `Headline: "${textOf(slide.title)}"`,
    slide.subtitle && `Subheading: "${textOf(slide.subtitle)}"`,
    slide.stat && `Big number: "${textOf(slide.stat)}"`,
    slide.quote && `Quote: "${textOf(slide.quote)}"`,
    slide.body && `Body: "${textOf(slide.body)}"`,
    listOf(slide.items).length && `List:\n${listOf(slide.items).map((t) => `- ${t}`).join('\n')}`,
    listOf(slide.itemsA).length && `Column A:\n${listOf(slide.itemsA).map((t) => `- ${t}`).join('\n')}`,
    listOf(slide.itemsB).length && `Column B:\n${listOf(slide.itemsB).map((t) => `- ${t}`).join('\n')}`,
    slide.action && `Call to action: "${textOf(slide.action)}"`,
  ].filter(Boolean);
  const context = [
    brand.offer && `Brand: ${clean(brand.offer).slice(0, 200)}`,
    (brief.audienceLens || brand.audience) && `Audience: ${textOf(brief.audienceLens || brand.audience).slice(0, 200)}`,
    brief.angle && `Post angle: ${textOf(brief.angle).slice(0, 300)}`,
    brief.centralFact && `Central fact: ${textOf(brief.centralFact).slice(0, 200)}`,
    brand.voice && `Tone: ${clean(brand.voice).slice(0, 160)}`,
  ].filter(Boolean);
  return [
    `Slide ${index} of ${total} (${role}) of an Instagram carousel post.`,
    ...context,
    `Visual style, identical on every slide of this carousel: ${styleLine(brand)}.`,
    'Text on this slide — use exactly these words, do not rewrite them and add no other text, tags or labels:',
    ...(words.length ? words : ['(no text — a visual slide)']),
    hasPhoto ? 'Use the provided photo as the main image of the slide; do not cover its subject with text.' : 'No photo is provided; use simple shapes or texture, no stock people.',
    index < total ? 'Keep the layout clean so the next slide feels like the same series.' : '',
  ].filter(Boolean).join('\n');
}

// ── the carousel agent's slides, as a page Canva can import ─────────────────
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system',
  'blinkmacsystemfont', 'inherit', 'initial', 'ui-sans-serif', 'ui-serif', 'georgia', 'arial', 'helvetica', 'times new roman']);
const attrOf = (tag, name) => {
  const m = String(tag).match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// one Google Fonts link per family the slides name (the studio's browser loads
// these itself; Canva fetches the page cold) — an unknown family only fails its own link
function fontLinksOf(html, extra = []) {
  const families = new Set();
  for (const m of String(html).matchAll(/font-family\s*:\s*([^;}"]+)/gi)) {
    m[1].split(',').forEach((f) => {
      const name = f.trim().replace(/^['"]|['"]$/g, '').trim();
      if (name && !name.startsWith('var(') && !GENERIC_FONTS.has(name.toLowerCase())) families.add(name);
    });
  }
  for (const m of String(html).matchAll(/--brand-font-[\w-]+\s*:\s*([^;}]+)/gi)) {
    m[1].split(',').forEach((f) => {
      const name = f.trim().replace(/^['"]|['"]$/g, '').trim();
      if (name && !GENERIC_FONTS.has(name.toLowerCase())) families.add(name);
    });
  }
  const links = [...families].map((f) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,500&display=swap`);
  return [...new Set([...extra.filter(Boolean), ...links])];
}

/**
 * The carousel document (content.carouselHtml) made self-contained for Canva's
 * HTML import: every slide <article> is a page (data-document-role="page"),
 * each photo frame gets a public URL for its picture (frames bound by key, the
 * rest in order from the slide's own photos, as the studio binds them), photo
 * focus becomes object-position, fonts are linked, scripts dropped.
 * @param {string} doc
 * @param {object} p
 * @param {string[][]} p.slideKeys   each slide's photo keys (1-based slide i → [i-1])
 * @param {(key:string)=>Promise<string>} p.urlOf  a public URL for an S3 key
 * @param {string[]} [p.fontLinks]   stylesheets to link besides the ones read from the CSS
 * → { html, pages } (pages = the slides' data-index in page order)
 */
async function canvaImportDocument(doc, { slideKeys = [], urlOf, fontLinks = [] }) {
  let html = String(doc || '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const pages = [];
  // slide articles → pages, each with its own photo frames bound
  const urls = new Map();
  const url = async (key) => {
    if (!urls.has(key)) urls.set(key, await urlOf(key).catch(() => ''));
    return urls.get(key);
  };
  const articles = [...html.matchAll(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi)];
  let out = '';
  let last = 0;
  for (const m of articles) {
    const block = m[0];
    const open = block.match(/^<article\b[^>]*>/i)[0];
    const index = Number(attrOf(open, 'data-index')) || pages.length + 1;
    pages.push(index);
    const keys = Array.isArray(slideKeys[index - 1]) ? slideKeys[index - 1] : [];
    const taken = new Set();
    const imgs = [...block.matchAll(/<img\b[^>]*>/gi)].map((x) => x[0]);
    const bound = [];
    for (const tag of imgs) {
      let key = attrOf(tag, 'data-asset-key');
      if (key) taken.add(key);
      bound.push({ tag, key });
    }
    for (const b of bound) {
      if (!b.key && /data-slot\s*=\s*["'](?:image|illustration)["']/i.test(b.tag)) {
        b.key = keys.find((k) => !taken.has(k)) || '';
        if (b.key) taken.add(b.key);
      }
    }
    let body = block.replace(/^<article\b/i, `<article data-document-role="page" data-label="Slide ${index}"`);
    for (const b of bound) {
      let tag = b.tag.replace(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
      const src = b.key ? await url(b.key) : '';
      const focus = attrOf(tag, 'data-focus').split(/[\s,]+/).map(Number);
      if (focus.length === 4 && focus.every(Number.isFinite) && !/object-position/i.test(attrOf(tag, 'style'))) {
        const pos = `object-position:${Math.round(focus[0] + focus[2] / 2)}% ${Math.round(focus[1] + focus[3] / 2)}%;`;
        tag = /\sstyle\s*=/i.test(tag)
          ? tag.replace(/\sstyle\s*=\s*"([^"]*)"/i, (_, st) => ` style="${escAttr(`${st};${pos}`)}"`)
          : tag.replace(/^<img\b/i, `<img style="${pos}"`);
      }
      if (src) tag = tag.replace(/^<img\b/i, `<img src="${escAttr(src)}"`);
      body = body.replace(b.tag, tag);
    }
    out += html.slice(last, m.index) + body;
    last = m.index + block.length;
  }
  html = out + html.slice(last);
  const links = fontLinksOf(html, fontLinks).map((h) => `<link rel="stylesheet" href="${escAttr(h)}">`).join('\n');
  const base = '<style>html,body{margin:0;padding:0;background:#fff}[data-document-role="page"]{position:relative;width:1080px;height:1350px;overflow:hidden;flex:none}</style>';
  html = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (h) => `${h}\n<meta charset="utf-8">\n${links}\n${base}`)
    : `<!DOCTYPE html><html><head><meta charset="utf-8">\n${links}\n${base}</head><body>${html}</body></html>`;
  return { html, pages };
}

// the slide's own photos (never an earlier themed render)
function photoKeysOf(slide, own) {
  return [...(Array.isArray(slide?.assetKeys) ? slide.assetKeys : []), slide?.assetKey]
    .map((k) => String(k || '').trim())
    .filter((k, i, all) => k.startsWith(own) && !/\/themed-/.test(k) && all.indexOf(k) === i);
}

// one exported Canva page → the slide's picture in S3 (4:5 JPEG; the export
// is a large lossless PNG)
async function storeExportedPage(url, own) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`export download ${res.status}`);
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(1080, 1350, { fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const key = `${own}themed-canva-${crypto.randomUUID()}.jpg`;
  await uploadBytes(key, jpeg, 'image/jpeg', { immutable: true });
  return { key, src: await getMediaUrl(key).catch(() => '') };
}

// A URL Canva can fetch: the media CDN (answers HEAD as well as GET — a
// presigned S3 GET URL 403s Canva's HEAD and the import fails "fetch_failed").
async function canvaFetchableUrl(key) {
  return publicMediaUrl(key) || getPresignedDownloadUrl(key);
}

// Export every page of `designId` and store the ones mapped to slides.
// `pages`: { [slideIndex]: pageNumber } → { [slideIndex]: { key, src } | { error } }
async function exportDesignPages(call, designId, pages, own) {
  const exp = await call('export-design', {
    design_id: designId,
    format: { type: 'png', width: 1080 },
    user_intent: 'Export each carousel page as an image for the post',
  });
  const job = exp?.job || exp;
  const urls = job?.urls || [];
  if (!urls.length) throw new Error(`Canva export ${job?.status || 'gave no files'}${job?.error?.message ? ` — ${job.error.message}` : ''}`);
  const out = {};
  await pool(Object.entries(pages), CONCURRENCY + 1, async ([index, page]) => {
    const url = urls[Number(page) - 1];
    try {
      if (!url) throw new Error(`page ${page} is no longer in the Canva design`);
      out[index] = await storeExportedPage(url, own);
    } catch (err) {
      out[index] = { error: err.message };
    }
  });
  return out;
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

/**
 * @param {object} p
 * @param {string} p.userId
 * @param {object} p.brief    agentTrace.strategyBrief
 * @param {object} p.brand    carouselBrandOf(...)
 * @param {object[]} p.slides the post's stored slides
 * @param {number[]} p.indexes 1-based slides to design
 * @param {string} [p.brandKitId] a Canva brand kit to design with
 * → { results: { [index]: { key, src, designId, editUrl, viewUrl, query, candidates, photo, elapsedMs } | { error } }, elapsedMs }
 */
async function designCarouselInCanva({ userId, brief = {}, brand = {}, slides = [], indexes = [], brandKitId = '' }) {
  const started = Date.now();
  const own = `projects/${userId}/`;
  const total = slides.length;
  const results = {};
  await withCanva(userId, async ({ call, tools }) => {
    if (tools.size && !tools.has('generate-design')) {
      throw Object.assign(new Error('This Canva account\'s MCP server does not offer design generation.'), { status: 502 });
    }
    await pool(indexes, CONCURRENCY, async (index) => {
      const t0 = Date.now();
      const slide = slides[index - 1] || {};
      const photoKey = photoKeysOf(slide, own)[0] || '';
      try {
        // the slide's photo goes to Canva first (a short-lived signed URL)
        let assetId = '';
        if (photoKey && tools.has('upload-asset-from-url')) {
          try {
            const up = await call('upload-asset-from-url', {
              url: await getPresignedDownloadUrl(photoKey),
              name: `bauhly-${photoKey.split('/').pop()}`,
              user_intent: 'Import the post photo to place it in the carousel slide',
            });
            assetId = String(up?.media_id || up?.asset?.id || up?.id || up?.job?.asset?.id || '');
          } catch (err) {
            console.warn(`[canva] photo import skipped for slide ${index}: ${err.message}`);
          }
        }
        const query = slideQuery({ brief, brand, slide, index, total, hasPhoto: Boolean(assetId) });
        const ask = (withAsset) => call('generate-design', {
          query,
          design_type: 'instagram_post',
          ...(withAsset && assetId ? { asset_ids: [assetId] } : {}),
          ...(brandKitId ? { brand_kit_id: brandKitId } : {}),
          user_intent: INTENT,
        });
        let gen;
        try { gen = await ask(true); } catch (err) {
          if (!assetId) throw err;
          console.warn(`[canva] slide ${index} generation with the photo failed, retrying without: ${err.message}`);
          gen = await ask(false);
        }
        const job = gen?.job || gen;
        const candidates = job?.result?.generated_designs || [];
        if (!job?.id || !candidates.length) throw new Error(job?.status && job.status !== 'success' ? `generation ${job.status}` : 'Canva returned no designs');
        const made = await call('create-design-from-candidate', { job_id: job.id, candidate_id: candidates[0].candidate_id, user_intent: INTENT });
        const design = made?.design_summary || made?.design || made;
        if (!design?.id) throw new Error('Canva did not save the design');
        const exp = await call('export-design', { design_id: design.id, format: { type: 'png', width: 1080 }, user_intent: 'Export the slide as an image for the carousel' });
        const url = (exp?.job?.urls || exp?.urls || [])[0];
        if (!url) throw new Error(`export ${exp?.job?.status || 'gave no file'}`);
        const { key, src } = await storeExportedPage(url, own);
        results[index] = {
          key,
          src,
          designId: design.id,
          editUrl: design.urls?.edit_url || '',
          viewUrl: design.urls?.view_url || '',
          query,
          candidates: candidates.length,
          photo: photoKey ? { key: photoKey, sentToCanva: Boolean(assetId) } : null,
          elapsedMs: Date.now() - t0,
        };
      } catch (err) {
        console.warn(`[canva] slide ${index} failed: ${err.message}`);
        results[index] = { error: err.message || 'failed', elapsedMs: Date.now() - t0 };
      }
    });
  });
  return { results, elapsedMs: Date.now() - started };
}

/**
 * The carousel agent's output → one Canva design. The post's carousel document
 * (only the slides asked for) is made self-contained (canvaImportDocument),
 * served from the studio's media storage for Canva to fetch, imported as an
 * Instagram post design with one page per slide, and exported back.
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.doc         content.carouselHtml
 * @param {object[]} p.slides    the post's stored slides (their photo keys bind empty frames)
 * @param {number[]} p.indexes   1-based slides to send
 * @param {string} [p.title]     the Canva design's name
 * @param {string[]} [p.fontLinks] Brand Kit font stylesheets
 * → { design: { id, editUrl, viewUrl, pages: { [slideIndex]: pageNumber } }, results: { [index]: { key, src } | { error } }, importHtmlBytes, elapsedMs }
 */
async function importCarouselToCanva({ userId, doc, slides = [], indexes = [], title = '', fontLinks = [] }) {
  const started = Date.now();
  const own = `projects/${userId}/`;
  const wanted = new Set(indexes.map(Number));
  // slides not asked for are left out of the import
  const only = String(doc || '').replace(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi, (block) => {
    const index = Number(attrOf(block.match(/^<article\b[^>]*>/i)[0], 'data-index'));
    return wanted.has(index) ? block : '';
  });
  const { html, pages } = await canvaImportDocument(only, {
    slideKeys: slides.map((sl) => photoKeysOf(sl, own)),
    urlOf: canvaFetchableUrl,
    fontLinks: [...fontLinks, ...(/data-html-theme=/.test(only) ? [HTML_THEME_FONTS_URL] : [])],
  });
  if (!pages.length) throw Object.assign(new Error('None of those slides are in the carousel document — run Fix layout first.'), { status: 400 });
  const htmlKey = `${own}canva-import/${crypto.randomUUID()}.html`;
  await uploadBytes(htmlKey, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
  try {
    return await withCanva(userId, async ({ call, tools }) => {
      if (tools.size && !tools.has('import-design-from-url')) {
        throw Object.assign(new Error('This Canva account\'s MCP server does not offer design import.'), { status: 502 });
      }
      const imported = await call('import-design-from-url', {
        url: await canvaFetchableUrl(htmlKey),
        name: clean(title).slice(0, 120) || 'Bauhly carousel',
        intended_design_type: 'instagram_post',
        user_intent: 'Import the carousel slides the app designed as an editable Canva design',
      });
      const job = imported?.job || imported;
      const made = job?.result?.designs?.[0] || job?.design || imported?.design_summary;
      if (!made?.id) {
        throw Object.assign(new Error(`Canva could not import the carousel${job?.error?.message ? ` — ${job.error.message}` : job?.status ? ` (${job.status})` : ''}`), { status: 502 });
      }
      const pageOf = Object.fromEntries(pages.map((index, n) => [index, n + 1]));
      if (made.page_count && Number(made.page_count) !== pages.length) {
        console.warn(`[canva] import made ${made.page_count} pages for ${pages.length} slides`);
      }
      const results = await exportDesignPages(call, made.id, pageOf, own);
      return {
        design: { id: made.id, editUrl: made.urls?.edit_url || '', viewUrl: made.urls?.view_url || '', pages: pageOf, pageCount: Number(made.page_count) || pages.length },
        results,
        importHtmlBytes: Buffer.byteLength(html),
        elapsedMs: Date.now() - started,
      };
    });
  } finally {
    // Canva has fetched it (or failed to) — the page is not kept
    deleteObjects([htmlKey]).catch(() => {});
  }
}

// Refresh from Canva: the design (edited by the studio in Canva) exported again
// → { results: { [index]: { key, src } | { error } }, elapsedMs }
async function refreshCanvaDesign({ userId, design }) {
  const started = Date.now();
  if (!design?.id || !design.pages || !Object.keys(design.pages).length) {
    throw Object.assign(new Error('This post has no Canva design to refresh from.'), { status: 409 });
  }
  const results = await withCanva(userId, ({ call }) => exportDesignPages(call, design.id, design.pages, `projects/${userId}/`));
  return { results, elapsedMs: Date.now() - started };
}

module.exports = {
  importCarouselToCanva, refreshCanvaDesign, designCarouselInCanva,
  slideQuery, styleLine, canvaImportDocument, fontLinksOf,
  // shared with canvaReimagineAgent
  canvaFetchableUrl, exportDesignPages, pool, photoKeysOf, attrOf, clean, textOf, listOf, CONCURRENCY, GENERIC_FONTS,
};
