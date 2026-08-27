/*
 * Drawable slide compositions the Layout Agent may choose from.
 * IDs, kinds, and slots match frontend/src/data/layouts.js so Week View can
 * render the chosen layout without a second composition system.
 *
 * Brand DNA and Layout Taste are not applied here yet.
 */

const LAYOUT_CATALOG = [
  { id: 'n-hook-corner', name: 'Corner to Corner', cat: 'hook', kind: 'corner', when: 'Words in one corner, picture in the other.', imageSlots: 0, levels: 2, supports: ['title', 'body'] },
  { id: 'e-hook-statement', name: 'Bold Statement', cat: 'hook', kind: 'statement', when: 'One sentence has to land before anything else.', imageSlots: 0, levels: 2, supports: ['title'] },
  { id: 'b-hook-bleed', name: 'Full-Bleed Cover', cat: 'hook', kind: 'bleed', when: 'Photograph strong enough to carry the headline on it.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'b-hook-statphoto', name: 'Number on a Picture', cat: 'hook', kind: 'stat-photo', when: 'A number is the hook, over a photograph.', imageSlots: 1, levels: 2, supports: ['stat', 'body', 'image'] },
  { id: 'q-hook-collage', name: 'Three Frames', cat: 'hook', kind: 'collage', when: 'Three pictures say more than one would.', imageSlots: 3, levels: 2, supports: ['title', 'image'] },
  { id: 'n-hook-modular', name: 'Modular Grid', cat: 'hook', kind: 'modular', when: 'Several pictures ordered into a grid.', imageSlots: 4, levels: 1, supports: ['title', 'image'] },
  { id: 'n-hook-asym', name: 'Off Balance', cat: 'hook', kind: 'asym', when: 'Deliberately off-centre: tall picture, words low and right.', imageSlots: 1, levels: 2, supports: ['title', 'body', 'image'] },
  { id: 'n-hook-sub', name: 'Statement & Subtitle', cat: 'hook', kind: 'hook-sub', when: 'A statement that needs a second line.', imageSlots: 0, levels: 2, supports: ['title', 'body'] },
  { id: 'n-hook-band', name: 'Statement over a Band', cat: 'hook', kind: 'hook-band', when: 'Statement on the ground, photograph as a horizon band.', imageSlots: 1, levels: 2, supports: ['title', 'body', 'image'] },

  { id: 'n-edu-columns', name: 'Two Columns', cat: 'edu', kind: 'columns', when: 'Two ideas read side by side.', imageSlots: 0, levels: 3, supports: ['title', 'body'] },
  { id: 'e-edu-framework', name: 'Framework', cat: 'edu', kind: 'steps', when: 'A method with named steps, no picture needed.', imageSlots: 0, levels: 2, supports: ['title', 'items'] },
  { id: 'e-edu-annotated', name: 'Annotated Drawing', cat: 'edu', kind: 'annotate', when: 'A drawing where the point is a specific line on it.', imageSlots: 1, levels: 2, supports: ['body', 'image'] },
  { id: 'e-edu-split', name: 'Materials, Side by Side', cat: 'edu', kind: 'split', when: 'Picture on one side, words on the other.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'q-edu-swatch', name: 'Swatch Note', cat: 'edu', kind: 'swatches', when: 'The palette or material set is the lesson.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'n-edu-callout', name: 'Feature Callout', cat: 'edu', kind: 'callout', when: 'One fact worth lifting out of the flow.', imageSlots: 0, levels: 3, supports: ['title', 'body'] },
  { id: 'n-edu-mood', name: 'Mood Board', cat: 'edu', kind: 'moodboard', when: 'The direction is a set of images, not a sentence.', imageSlots: 6, levels: 2, supports: ['title', 'image'] },
  { id: 'n-edu-textfirst', name: 'Text First', cat: 'edu', kind: 'text-first', when: 'Words lead; the picture supports at the foot.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'n-edu-legend', name: 'Marked Up', cat: 'edu', kind: 'annotate-multi', when: 'Several marks on one picture with a legend.', imageSlots: 1, levels: 2, supports: ['items', 'image'] },
  { id: 'n-edu-steps-photo', name: 'Steps with Pictures', cat: 'edu', kind: 'step-photo', when: 'A process where each step has its own photograph.', imageSlots: 3, levels: 2, supports: ['title', 'items', 'image'] },

  { id: 'e-story-title', name: 'Title & Subtitle', cat: 'story', kind: 'title-sub', when: 'A chapter title and one line under it.', imageSlots: 0, levels: 3, supports: ['title', 'body'] },
  { id: 'b-story-chapter', name: 'Chapter', cat: 'story', kind: 'index', when: 'A numbered stage opening.', imageSlots: 0, levels: 3, supports: ['stat', 'title', 'body'] },
  { id: 'e-story-hero', name: 'Picture & Story', cat: 'story', kind: 'hero', when: 'The room leads and the story runs beside it.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'q-story-frame', name: 'Framed Moment', cat: 'story', kind: 'frame', when: 'One moment, given a frame and room around it.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },
  { id: 'n-story-splittype', name: 'Title & Note', cat: 'story', kind: 'split-type', when: 'Title and note that should not share a column.', imageSlots: 0, levels: 2, supports: ['title', 'body'] },
  { id: 'n-story-airy', name: 'Room to Breathe', cat: 'story', kind: 'airy', when: 'A short line with silence around it.', imageSlots: 0, levels: 2, supports: ['title', 'body'] },
  { id: 'n-story-timeline', name: 'Timeline', cat: 'story', kind: 'timeline', when: 'A sequence of dated or ordered moments.', imageSlots: 0, levels: 2, supports: ['title', 'items'] },
  { id: 'n-story-magazine', name: 'Magazine Spread', cat: 'story', kind: 'magazine', when: 'Picture and long copy, set like a magazine.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'image'] },

  { id: 'b-res-metric', name: 'One Number', cat: 'results', kind: 'stat', when: 'The result is a single figure.', imageSlots: 0, levels: 2, supports: ['stat', 'body'] },
  { id: 'e-res-quote', name: 'Client Reaction', cat: 'results', kind: 'quote', when: 'A quote that needs to dominate the slide.', imageSlots: 0, levels: 2, supports: ['quote', 'title', 'body'] },
  { id: 'b-res-quotephoto', name: 'Quote on a Picture', cat: 'results', kind: 'quote-photo', when: 'A quote over the photograph it is about.', imageSlots: 1, levels: 2, supports: ['quote', 'title', 'body', 'image'] },
  { id: 'q-res-grid', name: 'Four Rooms', cat: 'results', kind: 'grid4', when: 'Four spaces from one project, seen together.', imageSlots: 4, levels: 2, supports: ['title', 'image'] },
  { id: 'n-res-quotenote', name: 'Quote & Comment', cat: 'results', kind: 'quote-note', when: 'A quote, and a comment beside it.', imageSlots: 0, levels: 3, supports: ['quote', 'title', 'body'] },
  { id: 'n-res-statcopy', name: 'Number & Note', cat: 'results', kind: 'stat-copy', when: 'A figure that needs a sentence to mean anything.', imageSlots: 0, levels: 3, supports: ['stat', 'body'] },
  { id: 'n-res-strip', name: 'Picture Strip', cat: 'results', kind: 'strip', when: 'Several results read across in one band.', imageSlots: 3, levels: 3, supports: ['title', 'body', 'image'] },

  { id: 'e-cmp-two', name: 'This or That', cat: 'compare', kind: 'compare', when: 'Two options, weighed in words.', imageSlots: 0, levels: 1, supports: ['comparison'] },
  { id: 'e-cmp-duo', name: 'Before & After', cat: 'compare', kind: 'duo', when: 'Before and after, in two frames.', imageSlots: 2, levels: 2, supports: ['title', 'comparison', 'image'] },
  { id: 'q-cmp-overlap', name: 'Overlapping Pair', cat: 'compare', kind: 'overlap', when: 'Two pictures that belong together but are not a sequence.', imageSlots: 2, levels: 2, supports: ['title', 'image'] },
  { id: 'n-cmp-columns', name: 'Two Columns, Compared', cat: 'compare', kind: 'compare-cols', when: 'Two specifications, compared line for line.', imageSlots: 0, levels: 2, supports: ['comparison', 'items'] },
  { id: 'n-cmp-diagonal', name: 'Split Down the Middle', cat: 'compare', kind: 'diagonal', when: 'Before and after in one frame, split on a diagonal.', imageSlots: 2, levels: 2, supports: ['title', 'comparison', 'image'] },
  { id: 'n-cmp-materials', name: 'Material Stack', cat: 'compare', kind: 'material-stack', when: 'Samples stacked and labelled.', imageSlots: 3, levels: 2, supports: ['title', 'items', 'image'] },

  { id: 'b-cta-book', name: 'Book a Call', cat: 'cta', kind: 'prose', when: 'A conversational ask that needs a paragraph.', imageSlots: 0, levels: 2, supports: ['title', 'body', 'action'] },
  { id: 'q-cta-caption', name: 'Quiet Ask', cat: 'cta', kind: 'caption', when: 'The ask sits quietly under the picture.', imageSlots: 1, levels: 2, supports: ['title', 'body', 'action', 'image'] },
  { id: 'e-cta-edge', name: 'Off the Edge', cat: 'cta', kind: 'edge', when: 'The ask runs off the edge so the eye follows it.', imageSlots: 1, levels: 3, supports: ['title', 'body', 'action', 'image'] },
  { id: 'n-cta-centered', name: 'Centred Ask', cat: 'cta', kind: 'centered', when: 'One ask, centred, with nothing competing.', imageSlots: 0, levels: 2, supports: ['title', 'body', 'action'] },
];

const BY_ID = new Map(LAYOUT_CATALOG.map((l) => [l.id, l]));

function layoutById(id) {
  return BY_ID.get(String(id || '').trim()) || null;
}

function filledList(value) {
  return Array.isArray(value) ? value.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

function slideHasVisual(slide) {
  const priority = String(slide?.visual?.priority || slide?.visualNeed?.priority || '').toLowerCase();
  if (priority && priority !== 'none') return true;
  if (String(slide?.assetKey || '').trim()) return true;
  if (String(slide?.image || '').toLowerCase() === 'placeholder') return true;
  const execution = String(slide?.visual?.execution || '').toLowerCase();
  return /supplied|generated|graphic/.test(execution);
}

function layoutCompatible(layout, slide) {
  if (!layout) return false;
  const supports = new Set(layout.supports || []);
  const items = filledList(slide?.items);
  const itemsA = filledList(slide?.itemsA);
  const itemsB = filledList(slide?.itemsB);
  const hasComparison = Boolean(String(slide?.comparisonA || '').trim() && String(slide?.comparisonB || '').trim());
  const hasStat = Boolean(String(slide?.stat || '').trim());
  const hasVisual = slideHasVisual(slide);

  if (hasComparison && !supports.has('comparison')) return false;
  if ((items.length >= 2 || itemsA.length || itemsB.length) && !supports.has('items') && !supports.has('comparison')) {
    return false;
  }
  if (hasStat && !supports.has('stat')) return false;
  if (!hasVisual && Number(layout.imageSlots) > 0) return false;
  return true;
}

module.exports = {
  LAYOUT_CATALOG,
  layoutById,
  layoutCompatible,
  slideHasVisual,
};
