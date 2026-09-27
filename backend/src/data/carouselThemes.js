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
    image: '01-scrapbook-diary.jpg',
    imageStyle: 'Warm natural-light lifestyle photographs with a soft film feel — like prints you would tape into a diary: cosy, lived-in, slightly imperfect. A plain photo only; the slide itself adds the tape, frames and handwriting.',
    name: 'Scrapbook diary',
    direction: 'scrapbook-diary',
    reference: [
      'Paper scrapbook / diary collage. The cream or kraft paper ground FILLS THE ENTIRE',
      '4:5 canvas edge-to-edge (full-bleed) — no surrounding desk, mat, border, or margin;',
      'the paper IS the slide background. On it: torn edges, washi tape, polaroid or taped',
      'photo frames, handwritten-style captions, ink underlines, and small ephemera (tickets,',
      'stamps, date marks). Soft shadows, imperfect alignment, warm intimate feel — not',
      'sterile corporate. Serif display type mixed with casual handwritten accents.',
    ].join(' '),
  },
  {
    id: 'editorial-magazine',
    image: '02-editorial-magazine.jpg',
    imageStyle: 'Premium editorial still-life and interior photography: soft directional daylight, rich muted tones, tactile materials in close-up, calm negative space, magazine-grade.',
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
    image: '06-before-process-after.jpg',
    imageStyle: 'Honest documentary photography of spaces and work in progress: neutral daylight, straight verticals, true-to-life colour, no styling gloss.',
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
    image: '07-myth-vs-reality.jpg',
    imageStyle: 'Clean, bright photographs of one clear object or scene on a simple ground — crisp light, bold and uncluttered so they read beside big type and sticker labels.',
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
    image: '08-moodboard-story.jpg',
    imageStyle: 'Top-down flat-lay or close-up photographs of materials — stone, timber, fabric, paint chips — soft even light, tactile texture, a curated palette.',
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
    image: '09-seamless-panorama.jpg',
    imageStyle: 'One wide, continuous scene with even light and a steady horizon, calm and spacious, so it can run across frames.',
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
    image: '10-personal-field-notes.jpg',
    imageStyle: 'Natural, observational photographs in warm daylight — snapshots from a site visit — or fine ink line sketches on paper; quiet and thoughtful.',
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
    hasImage && theme.image ? 'An example board of this theme is attached as an image: read its look (ground, type, framing devices, texture, palette, how pictures sit on the slide) — never its words, subjects or story.' : '',
    `Theme id: ${theme.id}`,
    `Theme name: ${theme.name}`,
    `Use data-direction="${theme.direction}" on the wrapping <section>.`,
    `Visual reference: ${theme.reference}`,
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
    out = { mediaType: 'image/jpeg', data: fs.readFileSync(path.join(IMAGE_DIR, file)).toString('base64') };
  } catch (err) {
    console.warn(`[carouselThemes] no example image for ${theme.id}: ${err.message}`);
  }
  imageCache.set(file, out);
  return out;
}

// What a generated picture must look like to sit inside this theme — for the
// Visual agents (plan-visual.md, plan-visual-request.md) and the image model.
function themeStyleForVisuals(theme, { hasImage = false } = {}) {
  if (!theme) return '';
  return [
    `Carousel theme: ${theme.name} (${theme.id}).`,
    theme.imageStyle ? `How pictures look in this theme: ${theme.imageStyle}` : '',
    `The theme's look: ${theme.reference}`,
    hasImage ? 'An example of the theme is attached as an image — match its palette, light, medium and mood; do not copy its subjects, objects or words.' : '',
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
      'Match the attached reference photo\'s palette, light, materials and mood',
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
