/*
 * The studio's layout library — the shapes Bauhly builds posts from.
 *
 * WHY THESE ARE DATA, NOT PICTURES (Leon, Aug 4).
 *
 * A layout is not a photograph; it is an arrangement — where the line sits, how
 * much text it carries, what the ground is, and where the picture goes. So each
 * one is described rather than drawn, and the page renders it from that
 * description. Two things follow: every layout picks up the studio's own fonts
 * and colours from the brand profile the moment those change, and nothing here
 * is a screenshot that can go stale.
 *
 * ── ONE LAYOUT PER COMPOSITION (Leon, Aug 6) ─────────────────────────────
 *
 * **22 layouts, and no two of them are the same shape.** The set had reached 62
 * by treating a different sentence, a different ground or a mirrored side as a
 * different layout: five statements, three A|B comparisons, three big-number
 * slides, five full bleeds, four caption bars, three framed plates. A library
 * whose parts repeat is a library nobody can choose from — the same fault 447
 * found, at four times the size.
 *
 * The rule is now absolute, and it is the only reason a layout may exist:
 *
 *   **A layout earns its place by its COMPOSITION, its HIERARCHY or its IMAGE
 *   TREATMENT. A different sentence is not a layout. A different ground is not
 *   a layout. A mirror, a rotation, a re-spacing is not a layout.**
 *
 * So `split` absorbed its own mirror, `bleed` absorbed words-at-the-top, `duo`
 * absorbed the stacked version, `steps` absorbed the crossed list, and
 * `statement` absorbed the question — each pair differed by alignment or a
 * glyph, never by shape. Where a type repeated, the strongest version survived
 * and kept its id, so nothing a studio had turned off is forgotten.
 *
 * ── IMAGE-FIRST ──────────────────────────────────────────────────────────
 *
 * 14 of the 22 put a photograph in the composition, and the image treatments
 * are the variety: full bleed · framed plate · split · hero · caption bar ·
 * overlapping pair · three-up collage · four-up grid · before-and-after ·
 * annotated · swatch row · off the edge · a number and a quote over a picture.
 *
 * The photographs are the product's own placeholder stills — the same set the
 * plan's previews draw on (`/assets/photo`). Nothing is stock and nothing here
 * implies a studio owns a picture they have not taken: with mood visuals turned
 * off, every one of these compositions draws its picture as an empty ground,
 * which is exactly what an unphotographed slide looks like.
 *
 * ── THE SET ONLY GROWS (Leon, Aug 6) ─────────────────────────────────────
 *
 * The image-first pass rewrote this file rather than extending it, and four
 * layouts went out with the bathwater — Client Line, Teaser List, Design
 * Principle and the quiet Material Note. Nobody asked for them to go; they were
 * simply not carried across. They are back, and the rule that stops it
 * recurring is this:
 *
 *   **A layout leaves this file only when someone decides it should leave, and
 *   the decision is written down.** A UI change is never a reason. Adding
 *   compositions means APPENDING to the array, and an id, once shipped, is
 *   never renamed — the store keeps the studio's choices per id (`layoutsOff`,
 *   `layoutsGone`), so a renamed id silently forgets what they turned off.
 *
 * If a layout genuinely has to go, delete it in its own change, say why here,
 * and record it in PROJECT_HANDOFF's decision log — the way 447 removed the
 * near-duplicates.
 *
 * ── THE FIELDS ───────────────────────────────────────────────────────────
 *
 *   kind    the composition — what the layout does with its space
 *   tone    WHICH of the theme's grounds it stands on — `ground`, `accent` or
 *           `photo`. A role, never a colour: the theme decides what each role
 *           is actually painted (see the palette note above)
 *   imgs    the photographs the composition holds. `[]` is a text-only layout,
 *           and that is the fact the "with / without images" filter reads
 *   levels  how many levels of typography it sets: 1 title · 2 title + body ·
 *           3 title + subtitle + body. The brief asked for layouts that carry a
 *           display title AND supporting text, so this is declared, not guessed
 *   art     the words, so the preview is a real slide rather than grey bars
 *
 * Nothing here is per-project. These are the reusable parts; the plan fills them.
 */

/* ── ONE PALETTE (Leon, Aug 7 — replaces the Aug 6 rule, which replaced Aug 4)
 *
 * There are no themes. There was one set of layouts and three palettes to paint
 * them in, then two, and the honest end of that road is one: a studio has ONE
 * visual identity, and a product that offers three is asking them to pick a mood
 * for their brand every time they open a page.
 *
 * So the palette is not a choice between named sets any more — it is three
 * colours the studio edits directly in Library Settings (background, text,
 * accent), and everything else in the system is derived from them. The word
 * "theme" is gone from the UI and from this file.
 *
 * `tone` still names WHICH of the palette's grounds a layout stands on, because
 * that is a property of the layout and not of the colours:
 *
 *   ground    the base — sixteen of the twenty-two... (see the tone counts below)
 *   accent    the one filled colour, and ONE layout stands on it: the slide
 *             whose whole content is a single number
 *   photo     the photograph is the ground; the words sit on it under a wash
 */

export const CATEGORIES = [
  { id: 'hook', label: 'Hook', lead: 'Strong openings that stop the scroll.' },
  { id: 'edu', label: 'Educational', lead: 'Teach, explain and provide value.' },
  { id: 'story', label: 'Story', lead: 'The project, in the order it happened.' },
  { id: 'results', label: 'Results', lead: 'What changed, and what it took.' },
  { id: 'compare', label: 'Comparison', lead: 'Two ways of doing the same thing.' },
  { id: 'cta', label: 'CTA', lead: 'One clear ask at the end of a post.' },
];

/* ── THE PHOTOGRAPHS ──────────────────────────────────────────────────────
 * The product's own stills, named for what is actually in them so a layout can
 * never caption a picture it is not showing. `/assets/photo/ph` is the Quiet
 * Studio placeholder set the plan's previews already use; the canal-house four
 * are the demo project's rooms. */
const IMG = {
  plan: '/assets/photo/ph/ph-mon-1.jpg', // a sketched floor plan on oak, linen beside it
  notebook: '/assets/photo/ph/ph-mon-2.jpg', // an open notebook and a pencil, window light
  drawing: '/assets/photo/ph/ph-mon-3.jpg', // a drawing close up, brass compass on it
  materials: '/assets/photo/ph/ph-mon-4.jpg', // oak, stone, linen and plaster, laid out
  hand: '/assets/photo/ph/ph-mon-5.jpg', // a hand flat on a stone sample
  light: '/assets/photo/ph/ph-mon-6.jpg', // light across a plaster wall, nothing else
  swatches: '/assets/photo/ph/ph-tue-1.jpg', // fabric and paint swatches on a wall
  floor: '/assets/photo/ph/ph-tue-2.jpg', // an oak floor with the window's shadow on it
  sketch: '/assets/photo/ph/ph-tue-3.jpg', // a lamp sketch under tracing paper
  niche: '/assets/photo/ph/ph-tue-4.jpg', // a plaster niche, one vase in it
  twoSamples: '/assets/photo/ph/ph-tue-5.jpg', // two linen samples held up, one in each hand
  notes: '/assets/photo/ph/ph-tue-6.jpg', // a dotted notebook and a pencil
  room: '/assets/photo/ph/ph-sat.jpg', // an empty room, oak floor, a paper lamp on it
  calm: '/assets/photo/ph/ph-sun.jpg', // a notebook, tea and linen
  finished: '/assets/photo/canal-house-01-hero.jpg', // the finished room, through the door
  ash: '/assets/photo/canal-house-02-detail-ash.jpg', // the ash joinery, close
  site: '/assets/photo/canal-house-03-site.jpg', // the same house mid-work, timber against the wall
  desk: '/assets/photo/canal-house-04-desk.jpg', // the desk the drawings are made at
};

/* one layout, as an object: there are eight facts about it now and a positional
   list of eight arguments is a line nobody can read or safely edit */
const L = (o) => ({ imgs: [], levels: 1, ...o });

/* Default composition per library category. Used whenever a slide has no
   layout of its own yet. Every default has a heading AND a supporting line so
   a slide's subtitle is never dropped because the composition has no slot. */
export const DEFAULT_LAYOUT_BY_CAT = {
  hook: 'n-hook-sub',
  edu: 'n-edu-callout',
  results: 'n-res-quotenote',
  cta: 'n-cta-centered',
  story: 'n-story-magazine',
};
export const DEFAULT_LAYOUT_ID = DEFAULT_LAYOUT_BY_CAT.hook;

/** True when the composition can draw both the headline and a supporting line. */
export function layoutShowsAllCopy(layout) {
  const art = layout?.art || {};
  return typeof art.head === 'string' && typeof art.body === 'string';
}

export const LAYOUTS = [
  /* ── Hook ── */
  L({
    /* reading flow: top-left to bottom-right, diagonally across an empty middle */
    id: 'n-hook-corner', cat: 'hook', name: 'Corner to Corner',
    when: 'The words hold one corner and the picture the other.',
    kind: 'corner', tone: 'ground', levels: 2,
    art: { head: 'Everyone wants the after.', body: 'Almost nobody wants the six weeks in between.' },
  }),
  L({
    id: 'e-hook-statement', cat: 'hook', name: 'Bold Statement',
    when: 'One sentence has to land before anything else does.',
    kind: 'statement', tone: 'ground', levels: 2,
    art: { head: 'Beautiful projects aren’t enough', accent: 'anymore.' },
  }),
  L({
    id: 'b-hook-bleed', cat: 'hook', name: 'Full-Bleed Cover',
    when: 'The photograph is strong enough to carry the headline on it.',
    kind: 'bleed', tone: 'photo', levels: 3, imgs: [IMG.floor],
    art: { eyebrow: 'Week six', head: 'The light was the whole brief.', body: 'Everything else was arranged around it.' },
  }),
  L({
    id: 'b-hook-statphoto', cat: 'hook', name: 'Number on a Picture',
    when: 'A number is the hook, and there is a room to say it over.',
    kind: 'stat-photo', tone: 'photo', levels: 2, imgs: [IMG.room],
    art: { big: '2×', body: 'the daylight, without moving a window.' },
  }),
  L({
    id: 'q-hook-collage', cat: 'hook', name: 'Three Frames',
    when: 'Three pictures say more about the project than one would.',
    kind: 'collage', tone: 'ground', levels: 2, imgs: [IMG.finished, IMG.materials, IMG.drawing],
    art: { head: 'A room, a material, a drawing.' },
  }),

  /* ── Educational ── */
  L({
    /* hierarchy: a title over two columns of body — eyebrow, headline, supporting copy */
    id: 'n-edu-columns', cat: 'edu', name: 'Two Columns',
    when: 'Two ideas that have to be read side by side.',
    kind: 'columns', tone: 'ground', levels: 3,
    art: {
      eyebrow: 'How we work',
      head: 'Why the drawings come before the shopping.',
      body: 'A room is a set of decisions that depend on each other. Move the door and the sofa moves; move the sofa and the light you were designing around stops working.',
      bodyB: 'So the plan is finished before anything is bought. It is slower for three weeks and faster for the three months after that.',
    },
  }),
  L({
    id: 'e-edu-framework', cat: 'edu', name: 'Framework',
    when: 'A method with named steps, and no picture needed.',
    kind: 'steps', tone: 'ground', levels: 2,
    art: { head: 'The 4-step concept that clients love.', items: ['Discover', 'Design', 'Refine', 'Deliver'] },
  }),
  L({
    id: 'e-edu-annotated', cat: 'edu', name: 'Annotated Drawing',
    when: 'A drawing where the point is a specific line on it.',
    kind: 'annotate', tone: 'photo', levels: 2, imgs: [IMG.drawing],
    art: { eyebrow: 'Detail 04', body: 'The line that decides whether the door can open all the way.' },
  }),
  L({
    id: 'e-edu-split', cat: 'edu', name: 'Materials, Side by Side',
    when: 'Two materials, judged against each other.',
    kind: 'split', tone: 'ground', levels: 3, imgs: [IMG.materials],
    art: { eyebrow: 'Materials', head: 'Four samples, one room.', body: 'Oak, stone, linen and plaster — chosen together or not at all.' },
  }),
  L({
    id: 'q-edu-swatch', cat: 'edu', name: 'Swatch Note',
    when: 'The palette is the lesson.',
    kind: 'swatches', tone: 'ground', levels: 3, imgs: [IMG.swatches],
    /* the chips carry no hexes of their own (Leon, Aug 6). Four hard-coded
       stones were the last colours in the library that came from nowhere — they
       sat unchanged under a lime theme and a near-black one. The row is drawn
       from the active palette; a real project's colours arrive with the project. */
    art: { eyebrow: 'Palette', head: 'Four tones, one room.', body: 'They are not the same in the morning.', swatches: 4 },
  }),

  /* ── Story ── */
  L({
    id: 'e-story-title', cat: 'story', name: 'Title & Subtitle',
    when: 'The chapter needs a title and one line under it.',
    kind: 'title-sub', tone: 'ground', levels: 3,
    art: { eyebrow: 'Case study', head: 'Three rooms, two kids, one impossible staircase.', body: 'What we changed, and what we refused to.' },
  }),
  L({
    id: 'b-story-chapter', cat: 'story', name: 'Chapter',
    when: 'A new stage of the project opens over its own photograph.',
    kind: 'index', tone: 'ground', levels: 3,
    art: { big: '03', head: 'The week we lost the staircase.', body: 'And the drawing that got it back.' },
  }),
  L({
    id: 'e-story-hero', cat: 'story', name: 'Picture & Story',
    when: 'The room leads and the story runs beside it.',
    kind: 'hero', tone: 'ground', levels: 3, imgs: [IMG.site],
    art: { eyebrow: 'Week six', head: 'Nothing looked like a room yet.', body: 'This is the week the drawings stop being drawings.' },
  }),
  L({
    id: 'q-story-frame', cat: 'story', name: 'Framed Moment',
    when: 'One moment, given a frame and room around it.',
    kind: 'frame', tone: 'ground', levels: 3, imgs: [IMG.sketch],
    art: { eyebrow: 'Tuesday', head: 'The lamp, drawn eleven times.', body: 'The eleventh is the one in the room.' },
  }),

  /* ── Results ── */
  L({
    id: 'b-res-metric', cat: 'results', name: 'One Number',
    when: 'The result is a single figure.',
    kind: 'stat', tone: 'accent', levels: 2,
    art: { big: '2×', body: 'the daylight, without moving a window.' },
  }),
  L({
    id: 'e-res-quote', cat: 'results', name: 'Client Reaction',
    when: 'The client said it better than you could.',
    kind: 'quote', tone: 'ground', levels: 2,
    art: { head: 'The first morning, nobody wanted to leave the kitchen.', body: 'Client, Prinsengracht' },
  }),
  L({
    id: 'b-res-quotephoto', cat: 'results', name: 'Quote on a Picture',
    when: 'A quote about a room, over that room.',
    kind: 'quote-photo', tone: 'photo', levels: 2, imgs: [IMG.finished],
    art: { head: 'We didn’t want it to look designed.', body: 'Client, Prinsengracht' },
  }),
  L({
    id: 'q-res-grid', cat: 'results', name: 'Four Rooms',
    when: 'Four spaces from one project, seen together.',
    kind: 'grid4', tone: 'ground', levels: 2, imgs: [IMG.finished, IMG.niche, IMG.floor, IMG.ash],
    art: { head: 'One house, four rooms.' },
  }),

  /* ── Comparison ── */
  L({
    id: 'e-cmp-two', cat: 'compare', name: 'This or That',
    when: 'Two options, weighed in words.',
    kind: 'compare', tone: 'ground', levels: 1,
    art: { a: 'Pendant', b: 'Recessed' },
  }),
  L({
    id: 'e-cmp-duo', cat: 'compare', name: 'Before & After',
    when: 'Before and after, in two frames.',
    kind: 'duo', tone: 'ground', levels: 2, imgs: [IMG.site, IMG.finished],
    art: { head: 'Ten weeks apart.', labels: ['Before', 'After'] },
  }),
  L({
    id: 'q-cmp-overlap', cat: 'compare', name: 'Overlapping Pair',
    when: 'Two pictures that belong together but are not a sequence.',
    kind: 'overlap', tone: 'ground', levels: 2, imgs: [IMG.twoSamples, IMG.swatches],
    art: { eyebrow: 'Two options', head: 'Both right. Only one is right here.' },
  }),

  /* ── CTA ── */
  L({
    id: 'b-cta-book', cat: 'cta', name: 'Book a Call',
    when: 'The ask is a conversation, and it needs a room behind it.',
    kind: 'prose', tone: 'ground', levels: 2,
    art: { head: 'Thinking about your own?', body: 'The first call is a conversation, not a quote. Tell us which room and we will tell you what it needs.' },
  }),
  L({
    id: 'q-cta-caption', cat: 'cta', name: 'Quiet Ask',
    when: 'The ask should be quiet and sit under the picture.',
    kind: 'caption', tone: 'photo', levels: 2, imgs: [IMG.calm],
    art: { head: 'Thinking about yours?', body: 'The first call is a conversation.' },
  }),
  L({
    id: 'e-cta-edge', cat: 'cta', name: 'Off the Edge',
    when: 'The ask runs off the edge, so the eye follows it.',
    kind: 'edge', tone: 'ground', levels: 3, imgs: [IMG.finished],
    art: { eyebrow: 'The whole house', head: 'In the highlights.', body: 'Room by room, in the order we built them.' },
  }),

  /* ══ ADDED Aug 6 ══ Twenty-one compositions, and not one of them is an
     existing shape with different words, a different ground or a mirrored side.
     Each is listed with the thing that makes it its own layout. ═════════════ */

  /* ── Hook ── */
  /* ── "IMAGE FIRST" IS GONE (Leon, Aug 7 — decision 555) ─────────────────
   * `min-caption`: a photograph filling the slide with "Prinsengracht, 08:40"
   * under it. Its own note called the words a footnote, and that is what it
   * was — a picture with a timestamp, carrying no line anyone could retell.
   * Every layout in this set now either combines real typography with imagery
   * or is deliberately text-only; a slide that is only a photograph says
   * nothing, and a set that offers one is offering a way to post nothing.
   * Hook keeps eight compositions, so nothing opens a gap. */
  L({
    /* composition: a nine-cell grid mixing photographs, a filled block and one
       cell of type — the only modular layout in the set */
    id: 'n-hook-modular', cat: 'hook', name: 'Modular Grid',
    when: 'Several pictures, ordered into a grid rather than a pile.',
    kind: 'modular', tone: 'ground', levels: 1, imgs: [IMG.niche, IMG.floor, IMG.ash, IMG.materials],
    art: { head: 'One house.' },
  }),
  L({
    /* composition: deliberately unbalanced — a tall picture off the centre line,
       the words hanging low and right of it */
    id: 'n-hook-asym', cat: 'hook', name: 'Off Balance',
    when: 'The composition should feel deliberately off centre.',
    kind: 'asym', tone: 'ground', levels: 2, imgs: [IMG.room],
    art: { head: 'The room was the easy part.', body: 'The staircase took nine weeks.' },
  }),

  /* THE HOOK WITH ITS EXPLANATION UNDER IT (Leon, Aug 6). `statement` is the
     claim alone — one line, one accent word, nothing to read after it. These two
     are the claim WITH the sentence that earns it, and they are a pair: the same
     hierarchy with and without a photograph, so a studio can use the shape either
     way. The block is anchored to the FOOT of the frame and grows upward, which
     is what lets one layout carry both a four-word subtitle and a thirty-word
     one without the statement having to shrink or the slide having to crowd. */
  L({
    id: 'n-hook-sub', cat: 'hook', name: 'Statement & Subtitle',
    when: 'A statement that needs a second line to be understood.',
    kind: 'hook-sub', tone: 'ground', levels: 2,
    art: { head: 'Posting more won’t grow your studio.', body: 'Strategy will. Six posts a month with a point beat twenty without one, and the difference shows up in who calls you.' },
  }),
  L({
    /* image treatment: a HORIZON — the statement on the ground, a photograph
       filling the bottom third edge to edge, and the subtitle sitting on it.
       Nothing else in the set does a partial bleed. */
    id: 'n-hook-band', cat: 'hook', name: 'Statement over a Band',
    when: 'The statement sits on a band of colour, not on a picture.',
    kind: 'hook-band', tone: 'ground', levels: 2, imgs: [IMG.floor],
    art: { head: 'Good design isn’t an upgrade.', body: 'It’s the foundation.' },
  }),

  /* ── Educational ── */
  L({
    /* composition: a panel inset on the ground — the only layout that puts a
       surface inside the frame rather than dividing it */
    id: 'n-edu-callout', cat: 'edu', name: 'Feature Callout',
    when: 'One fact worth lifting out of the flow.',
    kind: 'callout', tone: 'ground', levels: 3,
    art: { eyebrow: 'Worth knowing', head: 'Radiators are a lighting problem.', body: 'They decide where the furniture cannot go, which decides where the light has to come from.' },
  }),
  L({
    /* image treatment: six pictures at mixed sizes and offsets — a board, not a
       grid, and the only layout that overlaps more than two */
    id: 'n-edu-mood', cat: 'edu', name: 'Mood Board',
    when: 'The direction is a set of images, not a sentence.',
    kind: 'moodboard', tone: 'ground', levels: 2,
    imgs: [IMG.materials, IMG.swatches, IMG.ash, IMG.light, IMG.twoSamples, IMG.niche],
    art: { eyebrow: 'Direction', head: 'Where this house is going.' },
  }),
  L({
    /* hierarchy: text-first, with the photograph as a supporting note at the
       foot — the inverse of every other picture layout here */
    id: 'n-edu-textfirst', cat: 'edu', name: 'Text First',
    when: 'The words lead and the picture supports them.',
    kind: 'text-first', tone: 'ground', levels: 3, imgs: [IMG.drawing],
    art: { eyebrow: 'Detail', head: 'A door needs 90mm you never see.', body: 'The frame, the stop, the hinge and the room to swing it.' },
  }),
  L({
    /* image treatment: several marks on one picture with a numbered legend —
       distinct from the single pin and its note */
    id: 'n-edu-legend', cat: 'edu', name: 'Marked Up',
    when: 'Several things on one picture, each needing a name.',
    kind: 'annotate-multi', tone: 'photo', levels: 2, imgs: [IMG.plan],
    art: { eyebrow: 'The plan', items: ['Wall out', 'Door moved', 'Light added'] },
  }),
  L({
    /* composition: each step carries its own picture — a process shown, not
       listed */
    id: 'n-edu-steps-photo', cat: 'edu', name: 'Steps with Pictures',
    when: 'A process where each step has its own photograph.',
    kind: 'step-photo', tone: 'ground', levels: 2, imgs: [IMG.sketch, IMG.site, IMG.finished],
    art: { head: 'Drawn, built, lived in.', items: ['The drawing', 'The site', 'The room'] },
  }),

  /* ── Story ── */
  L({
    /* reading flow: title left, supporting text set right and below it, against
       the opposite margin */
    id: 'n-story-splittype', cat: 'story', name: 'Title & Note',
    when: 'A title and a note that should not share a column.',
    kind: 'split-type', tone: 'ground', levels: 2,
    art: { head: 'We kept the staircase.', body: 'It is the reason the hall still feels like the house it was.' },
  }),
  L({
    /* hierarchy INVERTED: the smallest type in a deliberately empty field, with
       a single mark. The only layout where scale is not the emphasis */
    id: 'n-story-airy', cat: 'story', name: 'Room to Breathe',
    when: 'The line is short and the silence around it is the point.',
    kind: 'airy', tone: 'ground', levels: 2,
    art: { eyebrow: 'Week eleven', body: 'Nothing happened this week, and that was the plan.' },
  }),
  L({
    /* composition: dated rows joined by a line — a process with time in it,
       which a numbered list has no way to show */
    id: 'n-story-timeline', cat: 'story', name: 'Timeline',
    when: 'The project as a sequence of dated moments.',
    kind: 'timeline', tone: 'ground', levels: 2,
    art: {
      head: 'Ten weeks.',
      items: ['Week 1 — Strip back', 'Week 3 — Structure in', 'Week 6 — Surfaces', 'Week 10 — Handover'],
    },
  }),
  L({
    /* composition: the magazine spread — eyebrow and title across the top, then
       a picture and a body column side by side beneath */
    id: 'n-story-magazine', cat: 'story', name: 'Magazine Spread',
    when: 'A spread — picture and long copy, set like a magazine.',
    kind: 'magazine', tone: 'ground', levels: 3, imgs: [IMG.site],
    art: { eyebrow: 'Issue 04', head: 'The week the house stopped being a building site.', body: 'Nine weeks in, the dust sheets come off and everyone remembers what they agreed to in March.' },
  }),

  /* ── Results ── */
  L({
    /* hierarchy: the quote large on the left, a commentary column beside it —
       two voices in one slide */
    id: 'n-res-quotenote', cat: 'results', name: 'Quote & Comment',
    when: 'A quote, and your own comment beside it.',
    kind: 'quote-note', tone: 'ground', levels: 3,
    art: { head: 'It feels like it was always like this.', body: 'Which is the whole job. A room that looks designed is a room you notice; this one they just live in.' },
  }),
  L({
    /* hierarchy: the numeral hangs in the margin and the paragraph runs beside
       it — not a number centred over a caption */
    id: 'n-res-statcopy', cat: 'results', name: 'Number & Note',
    when: 'A figure that needs a sentence to mean anything.',
    kind: 'stat-copy', tone: 'ground', levels: 3,
    art: { big: '9', eyebrow: 'Weeks on site', body: 'Two of them were spent on the staircase nobody was going to keep, and it is the first thing everyone mentions.' },
  }),
  L({
    /* image treatment: three pictures in a band across the middle, type above
       and below it — a horizontal read, not a grid */
    id: 'n-res-strip', cat: 'results', name: 'Picture Strip',
    when: 'Several results, read across in one band.',
    kind: 'strip', tone: 'ground', levels: 3, imgs: [IMG.site, IMG.ash, IMG.finished],
    art: { eyebrow: 'Three rooms', head: 'Same house, ten weeks apart.', body: 'Hall, kitchen, the room at the back.' },
  }),

  /* ── Comparison ── */
  L({
    /* composition: two headed columns, each carrying its own list — a
       comparison with reasons, not two words either side of a rule */
    id: 'n-cmp-columns', cat: 'compare', name: 'Two Columns, Compared',
    when: 'Two specifications, compared line for line.',
    kind: 'compare-cols', tone: 'ground', levels: 2,
    art: {
      a: 'Bespoke', b: 'Off the shelf',
      itemsA: ['Fits the wall', 'Six weeks', 'One maker'],
      itemsB: ['Fits the budget', 'Two weeks', 'Ten reviews'],
    },
  }),
  L({
    /* image treatment: two pictures in ONE frame divided on a diagonal — the
       before and the after in the same room, not in two frames */
    id: 'n-cmp-diagonal', cat: 'compare', name: 'Split Down the Middle',
    when: 'Before and after in ONE frame, split on a diagonal.',
    kind: 'diagonal', tone: 'photo', levels: 2, imgs: [IMG.site, IMG.finished],
    art: { labels: ['Before', 'After'], head: 'The same wall.' },
  }),
  L({
    /* image treatment: material samples as overlapping cards, each labelled —
       a stack you could pick up, not a row of chips under a photograph */
    id: 'n-cmp-materials', cat: 'compare', name: 'Material Stack',
    when: 'Material samples, stacked the way you would hand them over.',
    kind: 'material-stack', tone: 'ground', levels: 2,
    imgs: [IMG.ash, IMG.materials, IMG.twoSamples],
    art: { head: 'Three finishes, one room.', items: ['Ash', 'Stone', 'Linen'] },
  }),

  /* ── CTA ── */
  L({
    /* composition: the line centred on both axes with a caption pinned to the
       foot — the only centred layout in the set */
    id: 'n-cta-centered', cat: 'cta', name: 'Centred Ask',
    when: 'One ask, centred, with nothing competing.',
    kind: 'centered', tone: 'ground', levels: 2,
    art: { head: 'Start with one room.', body: 'Tell us which one.' },
  }),
];

/* ── what a card says about itself ────────────────────────────────────────
 * Nothing, beyond its name. The foot carried "4:5 · 1 photo · 2 type levels"
 * (and before that "Low text · Minimal") until Aug 6: three facts under every
 * card, none of which anyone chooses on. The ratio is the same on all 62; the
 * photograph count and the type levels are both plainly visible in the drawing
 * directly above the words. `photoLabel` and `levelLabel` went with the line.
 *
 * `imgs` and `levels` stay in the data — they are true properties of a layout,
 * and `hasImage` is what the "with / without images" filter reads, which is
 * where those facts do real work. */
export const hasImage = (l) => l.imgs.length > 0;

/* the theme no longer selects layouts, so it is no longer an argument here */
export const countOf = (cat) => LAYOUTS.filter((l) => l.cat === cat).length;

/* ── EVERY COMPOSITION THE RENDERER CAN DRAW ──────────────────────────────
 *
 * (Leon, Aug 7 — for adding layouts to a category.)
 *
 * A `kind` is a composition: where the picture sits, where the words go, what
 * the hierarchy is. The set above uses 44 of them across six categories, and no
 * category uses more than ten — so every category has thirty-odd compositions
 * the library already knows how to draw and that category does not yet have.
 *
 * This is DERIVED from the set rather than written beside it, so it can never
 * claim a composition the renderer cannot draw. The first layout using a kind
 * supplies the template: its tone, its depth, and how many photographs it takes.
 *
 * It is also what makes "meaningfully different" a fact instead of a promise —
 * see `lib/addlayouts.js`. A new layout in a category is a composition that
 * category did not have. Not a re-worded copy, not a mirror: a different shape.
 */
export const COMPOSITIONS = (() => {
  const seen = new Map();
  LAYOUTS.forEach((l) => {
    if (seen.has(l.kind)) return;
    seen.set(l.kind, {
      kind: l.kind,
      name: l.name,
      tone: l.tone,
      levels: l.levels,
      imgs: l.imgs.length,
    });
  });
  return [...seen.values()];
})();

/* the compositions a given category is already using */
export const kindsIn = (layouts, cat) =>
  new Set((layouts || []).filter((l) => l.cat === cat).map((l) => l.kind));

/* ── WHAT THE WEEKLY PLAN NEEDS TO KNOW ABOUT A LAYOUT ────────────────────
 *
 * (Leon, Aug 7 — decision 517, the merge.) The plan used to draw from its own
 * set, which carried `shots` and `needs` as hand-written fields. Both are
 * FACTS ABOUT THE COMPOSITION and can be read off it, so they are derived here
 * rather than written twice and kept in step by hand:
 *
 *   shots  how many photographs it takes — literally `imgs.length`
 *   needs  which Visual-Brand dimensions must hold something before Bauhly can
 *          build it honestly: a layout with a picture needs `photography`, one
 *          that sets type ON a picture needs `layout`, and a comparison needs
 *          `comparison`. Nothing else gates a slide.
 *
 * `when` is the one thing that cannot be derived — it says why Bauhly would
 * reach for this shape rather than another — so it is written on each layout.
 */
export const shotsOf = (l) => (l.imgs?.length || 0);
export function needsOf(l) {
  const n = [];
  if (shotsOf(l) > 0) n.push('photography');
  if (l.tone === 'photo') n.push('layout');
  if (l.cat === 'compare') n.push('comparison');
  return n;
}

/* which library category a slide's job belongs to. The plan used to have its
   own five groups (hook/educational/project/results/details) beside the
   library's six; one taxonomy now, and it is the one the studio browses. */
const CAT_FOR_ROLE = {
  Hook: 'hook', Cover: 'hook', Poll: 'hook', Premise: 'hook',
  Setup: 'edu', Process: 'edu', Problem: 'edu', Tension: 'edu',
  Observation: 'edu', Evidence: 'edu', Reason: 'edu', Insight: 'edu',
  Context: 'edu', Exploration: 'edu', Decision: 'edu', Change: 'edu',
  Contrast: 'edu', Beat: 'edu',
  Result: 'results', Implication: 'results', Lesson: 'results',
  Takeaway: 'results', Resolution: 'results', Solution: 'results',
  'Why it matters': 'edu',
  WhyItMatters: 'edu',
  Action: 'cta',
  CTA: 'cta',
};
export const catForRole = (role) => CAT_FOR_ROLE[role] || 'hook';

/* ── THE ONE THAT IS NOT A COMPOSITION ────────────────────────────────────
 *
 * (Leon, Aug 7.) It came from the plan's own set and stays, because it is a
 * real answer a slide can need — but it is not a layout, which is why it is not
 * in `LAYOUTS` and does not appear in the Visual Library:
 *
 *   Create image  the slide needs a picture nobody took. Deliberately last in
 *                 the carousel — generation is the optional mode, and the
 *                 product's whole argument is that most slides do not need it.
 *
 * ── "IMAGE ONLY" IS GONE (decision 555) ──────────────────────────────────
 * It was the other one: a photograph published untouched, `art: {}`, the only
 * entry in the product with no typography at all. The argument for it was that
 * sometimes the picture IS the post — which is true of a photographer's feed
 * and not of this product, whose whole case is that a studio's posts have to
 * SAY something. A slide with no words carries no story, no takeaway and
 * nothing to retell, and offering it as a shape made it look like a legitimate
 * answer to "which layout should this slide take?".
 *
 * It carries the library's shape so one renderer draws everything.
 */
export const SPECIALS = [
  L({
    id: 'GEN', cat: 'any', name: 'Create image', special: 'gen',
    when: 'Bauhly makes the picture, in your visual brand.',
    kind: 'centered', tone: 'ground', levels: 1, art: { head: 'Create image' },
  }),
];
