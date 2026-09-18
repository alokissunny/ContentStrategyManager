/**
 * Catalog of Instagram carousel themes the studio can send to the Carousel
 * agent as a visual reference (Change theme). Ids are stable kebab-case slugs
 * used as `<section data-direction="…">` values.
 *
 * Source examples: instagram-carousel-themes.html (10 concept boards).
 */
const CAROUSEL_THEMES = [
  {
    id: 'scrapbook-diary',
    name: 'Scrapbook diary',
    direction: 'scrapbook-diary',
    reference: [
      'Paper scrapbook / diary collage. Cream or kraft paper grounds, torn edges,',
      'washi tape, polaroid or taped photo frames, handwritten captions, ink underlines,',
      'and small ephemera (tickets, stamps, date marks). Soft shadows, imperfect alignment,',
      'warm intimate tone — not sterile corporate. Mix serif display with casual notes.',
    ].join(' '),
  },
  {
    id: 'editorial-magazine',
    name: 'Editorial magazine',
    direction: 'editorial-magazine',
    reference: [
      'High-end magazine editorial. Large display headlines, generous whitespace,',
      'asymmetric grids, pull quotes, thin rules, and one hero photograph or graphic',
      'per slide. Serif display + clean sans body. Premium, calm, and print-like.',
    ].join(' '),
  },
  {
    id: 'annotated-photo-dump',
    name: 'Annotated photo dump',
    direction: 'annotated-photo-dump',
    reference: [
      'Casual photo dump with designer annotations. Large photos dominate; overlay',
      'handwritten labels, thin arrows, circled details, and short callouts that',
      'point at what matters. Feels like a designer marking up a site photo — raw,',
      'specific, and personal rather than template-polished.',
    ].join(' '),
  },
  {
    id: 'notes-app-confessions',
    name: 'Notes-app confessions',
    direction: 'notes-app-confessions',
    reference: [
      'Phone Notes app aesthetic. Soft yellow or off-white note paper, system-like',
      'sans type, short confessional lines, occasional bold for emphasis, minimal chrome.',
      'Feels intimate and typed-on-a-phone — not designed as a brand poster.',
    ].join(' '),
  },
  {
    id: 'bold-mini-guide',
    name: 'Bold mini-guide',
    direction: 'bold-mini-guide',
    reference: [
      'Bold instructional mini-guide. Huge numerals or short titles, high-contrast',
      'blocks of colour, punchy one-line tips, clear hierarchy. Educational and',
      'swipeable — each slide is one step or one rule, not a paragraph essay.',
    ].join(' '),
  },
  {
    id: 'before-process-after',
    name: 'Before → process → after',
    direction: 'before-process-after',
    reference: [
      'Sequential transformation story. Clear Before / Process / After framing',
      '(labels, split panels, or ordered chapters). Emphasize the decision and the',
      'change — never invent a finished result that is not in the brief. Honest',
      'process imagery and concept studies when photos are missing.',
    ].join(' '),
  },
  {
    id: 'myth-vs-reality',
    name: 'Myth vs. reality',
    direction: 'myth-vs-reality',
    reference: [
      'Myth vs reality contrast layout. Split columns or stacked “Myth” / “Reality”',
      'panels, crossed-out assumptions, corrected takeaway. Strong typographic contrast;',
      'one myth corrected per slide or a short arc ending on the reality.',
    ].join(' '),
  },
  {
    id: 'moodboard-story',
    name: 'Moodboard story',
    direction: 'moodboard-story',
    reference: [
      'Interior moodboard story. Overlapping material swatches, colour chips, fabric',
      'and stone samples, dashed concept frames, sprig/leaf accents, and short labels.',
      'Collage energy with a clear narrative through the swipe — curated, not chaotic.',
    ].join(' '),
  },
  {
    id: 'seamless-panorama',
    name: 'Seamless panorama',
    direction: 'seamless-panorama',
    reference: [
      'Seamless panorama across slides. Shared background, continuous colour fields,',
      'or aligned elements that feel like one wide canvas cut into 4:5 frames. Strong',
      'horizontal continuity; each slide still readable alone.',
    ].join(' '),
  },
  {
    id: 'personal-field-notes',
    name: 'Personal field notes',
    direction: 'personal-field-notes',
    reference: [
      'Designer field notebook. Ruled or grid paper, ink sketches, margin notes,',
      'small diagrams, date stamps, and observational captions. Quiet, thoughtful,',
      'hand-marked — like notes from a site visit, not a marketing template.',
    ].join(' '),
  },
];

const BY_ID = new Map(CAROUSEL_THEMES.map((t) => [t.id, t]));

function themeById(id) {
  const key = String(id || '').trim().toLowerCase();
  return BY_ID.get(key) || null;
}

function themeReferenceForPrompt(theme) {
  if (!theme) return 'None supplied — choose one cohesive look that fits the brand.';
  return [
    `Theme id: ${theme.id}`,
    `Theme name: ${theme.name}`,
    `Use data-direction="${theme.direction}" on the wrapping <section>.`,
    `Visual reference: ${theme.reference}`,
  ].join('\n');
}

module.exports = {
  CAROUSEL_THEMES,
  themeById,
  themeReferenceForPrompt,
};
