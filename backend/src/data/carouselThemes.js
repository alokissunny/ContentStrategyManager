/**
 * Catalog of Instagram carousel themes the studio can send to the Carousel
 * agent as a visual reference (Change theme). Ids are stable kebab-case slugs
 * used as `<section data-direction="…">` values.
 *
 * Source examples: instagram-carousel-themes.html (concept boards).
 */
// Each `reference` is VISUAL DIRECTION ONLY — ground, type, composition,
// framing devices, texture, mood. What a slide says, how many slides there
// are and the order of the story come from the narrative (strategy brief +
// content structure), never from the theme. Where a theme has a signature
// device (before/after panels, myth/reality columns, a panorama) it is listed
// as visual vocabulary to use only when the narrative already has that shape.
const CAROUSEL_THEMES = [
  {
    id: 'scrapbook-diary',
    image: 'single/scrapbook-diary.jpg',
    typography: "Headlines in a warm handwritten script — Google Font 'Caveat' 600–700 — dark ink (#2f2a24), sentence case, written across torn cream paper strips; small handwritten notes in 'Caveat' on taped cards; tiny page number in a quiet sans. No formal serif display. Ground: cream/kraft paper with soft grain, gingham and washi tape, sage-green paper scraps, a large warm photograph taped across the slide, a small line-drawn sprig or sun doodle.",
    imageStyle: 'Warm natural light, soft film grain, gently faded warm tones, candid and lived-in — like a personal print. (Finish only: the subject comes from the slide.)',
    name: 'Scrapbook diary',
    direction: 'scrapbook-diary',
    reference: [
      'Paper scrapbook / diary collage. The cream or kraft paper ground FILLS THE ENTIRE',
      '4:5 canvas edge-to-edge (full-bleed) — no surrounding desk, mat, border, or margin;',
      'the paper IS the slide background. On it: torn edges, washi tape, polaroid or taped',
      'photo frames, handwritten-style captions, ink underlines, and small ephemera (tickets,',
      'stamps, date marks). Soft shadows, imperfect alignment, warm intimate feel — not',
      'sterile corporate. Handwritten-script headlines and notes (see typography).',
    ].join(' '),
  },
  {
    id: 'editorial-magazine',
    image: 'single/editorial-magazine.jpg',
    typography: "Large high-contrast serif display — Google Font 'Playfair Display' (or 'Bodoni Moda') at 400, tight leading (~0.95), sentence case, set left and big (a third of the slide); tiny serif page number top right; supporting text, when present, in a light sans ('Inter' 300) small. Ground: a full-bleed, tactile, close-cropped photograph (fabric, material, still life) in muted burgundy / ivory / espresso, with calm negative space for the headline.",
    imageStyle: 'Magazine-grade photography: soft directional daylight, rich but muted tones, shallow depth of field, calm negative space, refined finish. (Finish only: the subject comes from the slide.)',
    name: 'Editorial magazine',
    direction: 'editorial-magazine',
    reference: [
      'High-end magazine editorial. Large display headlines, generous whitespace,',
      'asymmetric grids, pull-quote styling, thin rules, and one hero photograph or graphic',
      'per slide. Serif display + clean sans body. Premium, calm, print-like.',
    ].join(' '),
  },
  {
    id: 'before-process-after',
    image: 'single/before-process-after.jpg',
    typography: "Centred serif headline — Google Font 'DM Serif Display' 400, sentence case, dark ink; directly under it a small letter-spaced caps label ('Inter' 500, tracking ~0.2em, e.g. PROCESS) naming the stage; tiny centred page number at the foot. Ground: one full-bleed, warm, naturally lit interior photograph (work in progress, tidy desk, shelves), headline sitting in the calm upper wall area.",
    imageStyle: 'Honest documentary photography: neutral daylight, straight verticals, true-to-life colour, no styling gloss. (Finish only: the subject comes from the slide.)',
    name: 'Before → process → after',
    direction: 'before-process-after',
    reference: [
      'Sequential, documentary look. Clean panels, split frames, chapter numerals and small',
      'stage labels, progress markers or a thin timeline rule, and honest process imagery or',
      'concept studies when photos are missing. Visual vocabulary only: use split panels or',
      'stage labels where the narrative itself moves through stages — never relabel or',
      'reorder the story into before / process / after, and never imply a finished result',
      'the narrative does not state.',
    ].join(' '),
  },
  {
    id: 'myth-vs-reality',
    image: 'single/myth-vs-reality.jpg',
    typography: "Very heavy geometric sans — Google Font 'Poppins' 800 — white, sentence case, three short lines, left aligned; a lilac (#c9b3ff) brush-stroke sticker label in black 'Poppins' 900 caps above it; small handwritten asides in 'Caveat' with a hand-drawn arrow. Ground: flat deep purple (#4b1d8f); photographed objects as white-outlined cut-out stickers (laptop, cup), a taped note card.",
    imageStyle: 'Clean, bright, crisply lit photography with one clear subject on a simple uncluttered ground, bold enough to read beside big type. (Finish only: the subject comes from the slide.)',
    name: 'Myth vs. reality',
    direction: 'myth-vs-reality',
    reference: [
      'High-contrast typographic look on a strong two-tone ground (e.g. lilac and deep',
      'purple): bold display type, sticker-style labels, cut-out object photos, split',
      'columns or stacked panels, strike-through and correction marks.',
      'Visual vocabulary only: use split or crossed-out treatments where the narrative',
      'itself sets up a contrast — never invent a "myth" or add Myth / Reality labels the',
      'narrative does not have.',
    ].join(' '),
  },
  {
    id: 'moodboard-story',
    image: 'single/moodboard-story.jpg',
    typography: "Elegant light serif — Google Font 'Cormorant Garamond' 400–500 — in cream, sentence case, three short lines top left; no heavy type anywhere. Ground: warm terracotta flat-lay with soft window shadows: fabric swatches, a ceramic bowl with an olive sprig, a polaroid-style photo, a paint-chip card of three colour blocks.",
    imageStyle: 'Soft even light, warm earthy palette, tactile texture and a curated, calm composition. (Finish only: the subject comes from the slide.)',
    name: 'Moodboard story',
    direction: 'moodboard-story',
    reference: [
      'Interior moodboard look. Overlapping material swatches, colour chips, fabric and',
      'stone samples, dashed concept frames, sprig/leaf accents and short labels. Collage',
      'energy that stays curated, not chaotic.',
    ].join(' '),
  },
  {
    id: 'seamless-panorama',
    image: 'single/seamless-panorama.jpg',
    typography: "Thin, large serif — Google Font 'Cormorant Garamond' 300 — in white, sentence case, one line at the very top that continues across slides, with a thin arrow (→) pointing to the next slide. Ground: one continuous, richly coloured scene (golden-hour street or landscape) that runs edge to edge and across the frame boundaries.",
    imageStyle: 'Wide, calm composition with even light and a steady horizon, rich natural colour. (Finish only: the subject comes from the slide.)',
    name: 'Seamless panorama',
    direction: 'seamless-panorama',
    reference: [
      'Seamless panorama across slides. Shared background, continuous colour fields, or',
      'aligned elements that feel like one wide canvas cut into 4:5 frames, with strong',
      'horizontal continuity. Each frame must still be legible on its own.',
    ].join(' '),
  },
  {
    id: 'personal-field-notes',
    image: 'single/personal-field-notes.jpg',
    typography: "Typewriter headline — Google Font 'Courier Prime' 700 (or 'Special Elite') — deep forest green (#1f3d2b), sentence case, large, with a hand-drawn ink underline; handwritten notes and checklists in 'Caveat' in dark ink; small caps label 'FIELD NOTES' letter-spaced. Ground: light grid / ruled notebook paper, an open notebook with a checklist, a fountain pen, taped landscape photos, small pine-sprig ink drawings.",
    imageStyle: 'Natural observational daylight, candid and quiet, muted greens and warm neutrals — or a fine ink line sketch on paper. (Finish only: the subject comes from the slide.)',
    name: 'Personal field notes',
    direction: 'personal-field-notes',
    reference: [
      'Designer field notebook look. Ruled or grid paper, ink sketches, margin-note styling,',
      'small diagrams, date stamps and caption styling. Quiet, thoughtful, hand-marked —',
      'like a notebook from a site visit, not a marketing template.',
    ].join(' '),
  },
];

// Product decision: every generated post uses ONE fixed carousel theme. The
// strategy agent still emits a themeId, but the pipeline ignores it and pins this
// so the whole feed renders one cohesive look. (Manual "Change theme" on a post
// still overrides per-post — this only governs fresh generation.)
const DEFAULT_THEME_ID = 'scrapbook-diary';

const BY_ID = new Map(CAROUSEL_THEMES.map((t) => [t.id, t]));

function themeById(id) {
  const key = String(id || '').trim().toLowerCase();
  return BY_ID.get(key) || null;
}

/** Compact catalog for strategist prompts — id + name + one-line fit hint. */
function themesForStrategistPrompt() {
  return CAROUSEL_THEMES.map((t) => ({
    id: t.id,
    name: t.name,
    fit: t.reference.split(/[.!]/)[0].trim(),
  }));
}

/**
 * Normalize a strategist/studio theme pick. Unknown ids fall back by pillar so
 * the carousel agent still gets concrete visual guidance.
 */
function resolveThemeId(raw, { pillar } = {}) {
  const hit = themeById(raw);
  if (hit) return hit.id;
  const lens = String(pillar || '').trim().toLowerCase();
  if (lens === 'credibility') return 'before-process-after';
  if (lens === 'trust') return 'editorial-magazine';
  if (lens === 'discovery') return 'scrapbook-diary';
  return 'editorial-magazine';
}

function themeReferenceForPrompt(theme, { hasImage = false } = {}) {
  if (!theme) return 'None supplied — choose one cohesive look that fits the brand.';
  return [
    'VISUAL DIRECTION ONLY — how the carousel looks, never what it says. Slide count, order, story beats and every word come from the narrative (CONTENT STRUCTURE and the strategy brief), not from this theme.',
    hasImage && theme.image ? 'An example slide of this theme is attached as an image: match its look exactly — typography (typeface style, weight, case, size, placement), ground and texture, palette, framing devices and how pictures sit on the slide — never its words, subjects or story.' : '',
    `Theme id: ${theme.id}`,
    `Theme name: ${theme.name}`,
    `Use data-direction="${theme.direction}" on the wrapping <section>.`,
    `Visual reference: ${theme.reference}`,
    theme.typography ? `Typography and look (follow exactly; load the fonts with one Google Fonts <link> in <head>): ${theme.typography}` : '',
    theme.imageStyle ? `Pictures in this theme: ${theme.imageStyle}` : '',
  ].filter(Boolean).join('\n');
}

// The theme's example board, attached to the agents as an image so they can SEE
// the look (backend/assets/carousel-themes). Read once, cached.
const fs = require('fs');
const path = require('path');
const IMAGE_DIR = path.join(__dirname, '..', '..', 'assets', 'carousel-themes');
const imageCache = new Map();
function themeImageOf(theme) {
  const file = theme?.image;
  if (!file) return null;
  if (imageCache.has(file)) return imageCache.get(file);
  let out = null;
  try {
    out = {
      mediaType: 'image/jpeg',
      data: fs.readFileSync(path.join(IMAGE_DIR, file)).toString('base64'),
      // what the debug panel shows for this attachment (frontend/public has the same file)
      debug: { label: `Theme reference — ${theme.name}`, path: `/carousel-themes/${file}` },
    };
  } catch (err) {
    console.warn(`[carouselThemes] no example image for ${theme.id}: ${err.message}`);
  }
  imageCache.set(file, out);
  return out;
}

// What a generated picture must look like to sit inside this theme — for the
// Visual agents (plan-visual.md, plan-visual-request.md) and the image model.
function themeStyleForVisuals(theme) {
  if (!theme) return '';
  // FINISH ONLY. The theme decides how the picture is lit, coloured and
  // finished so it sits in the carousel — never what it shows. Its layout
  // description and example slide are deliberately NOT given to the Visual
  // agents: they copied the example's subjects (fabric, props) into slides
  // about something else.
  return [
    `Carousel theme: ${theme.name}.`,
    theme.imageStyle ? `Finish to match: ${theme.imageStyle}` : '',
  ].filter(Boolean).join('\n');
}

// A one-off "theme" built from a studio-uploaded photo (Change theme › Upload a
// reference) instead of the fixed catalog above. `analysis` is the vision
// analyzeImageAsset() result for that photo — its description/colours/mood
// become the carousel agent's visual reference, same shape as a catalog entry
// so writeCarousel() can use either interchangeably.
function customReferenceTheme(analysis) {
  const bits = [
    'Visual reference supplied by the studio: a photograph they like the look of, attached to this message — look at it directly (not part of this post’s own content — do not depict this exact scene).',
    analysis?.description || analysis?.summary
      ? `What the photo shows: ${analysis.description || analysis.summary}`
      : '',
    Array.isArray(analysis?.colors) && analysis.colors.length
      ? `Its dominant colours: ${analysis.colors.join(', ')}.`
      : '',
    analysis?.mood ? `Its mood/tone: ${analysis.mood}.` : '',
    'Read the attached photo yourself for the exact palette, materials/texture, lighting and composition — the notes above are a starting point, not a substitute. Design this carousel so its palette, mood, materials/texture and composition energy evoke this reference — adapt its aesthetic direction into an Instagram carousel design system; do not literally reproduce the photo.',
  ].filter(Boolean);
  return {
    id: 'custom-reference',
    name: 'Your reference photo',
    direction: 'custom-reference',
    reference: bits.join(' '),
    imageStyle: [
      'Match the studio reference photo\'s palette, light and mood (finish only — the subject comes from the slide)',
      Array.isArray(analysis?.colors) && analysis.colors.length ? `(colours: ${analysis.colors.join(', ')})` : '',
      analysis?.mood ? `— ${analysis.mood}` : '',
    ].filter(Boolean).join(' ') + '.',
  };
}

module.exports = {
  CAROUSEL_THEMES,
  themeImageOf,
  themeStyleForVisuals,
  DEFAULT_THEME_ID,
  themeById,
  themesForStrategistPrompt,
  resolveThemeId,
  themeReferenceForPrompt,
  customReferenceTheme,
};
