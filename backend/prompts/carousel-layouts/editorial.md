Create a high quality Instagram carousel from the given strategy agent output. Layout: **Editorial** — magazine spreads: photographs set as plates on a solid-colour page, a clear type hierarchy, generous margins and small print details.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide, numbered in reading order. Each slide is exactly `width:1080px;height:1350px`, `overflow:hidden`. Use px sizes only — no vw/vh or viewport clamp().
{{SLIDE_PLAN_RULES}}
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (plate, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment (what the narrative needs the reader to see in that photograph) and the hook-reasoning comment when asked for.
{{COMPOSITION_RULES}}
{{BRAND_ROLES}}
- HTML only. No explanation.

## Plan the set first

- **Narrative first.** Understand the story before designing. Every slide should communicate a clear idea, with composition and emphasis driven by its narrative purpose.
- **Plan the whole carousel before you compose any single slide.** Read the narrative end to end and decide its arc: where it opens, which moments carry the weight, where it turns, how it closes. Then look at every photograph you have been given against that arc, as a set rather than one slide at a time. Decide which units need visual evidence to be believed, which read better with no photograph at all, and where the same image, cropped differently, gives a later slide useful context. Reuse is allowed when it serves the story and obvious when it does not. Never invent an image or visual evidence that was not supplied.
- **Not every slide carries the same weight.** Decide the intended rhythm — where the carousel should hit hardest, where restraint helps the reader take something in — and let visual intensity follow the narrative's transitions. Quiet slides make the strong ones work. Variation that does not track a transition in the story is arbitrary, and reads that way.

## Page and plates

- **The page is the ground, the photograph is a plate.** The slide is a solid-colour page. Each photograph sits inset within it with the page visible on at least two sides, so it reads as something placed on a page rather than something the page is cut from. This is what separates this layout from full bleed, and it is the reason the type never needs an overlay: it sits on the page, not on the photograph. Never reach for a full-bleed, split-band or floating-panel treatment; those belong to other agents.
- **Give the type its own region.** Type never sits on photo pixels: every letter is set on the page colour (or on a solid Brand Kit block), so the only contrast to check is type against a Brand Kit colour. The regions may still touch and layer — a solid page-coloured type block may overlap the edge of a plate, and plates may overlap each other (see "Choose the arrangement" below) — as long as no letter lands on the photograph.
- **The page colour belongs to the narrative, not to the layout.** Grounds come from the Brand Kit (`--brand-background`, `--brand-primary` and the other `--brand-*` roles). Choose each slide's ground from the tone of what it says, the emphasis it needs, the Brand Kit, and how it sits beside the slides either side of it. A darker ground can carry weight, gravity or a turn inward; a lighter one can open the set up or let a photograph breathe — but these are readings, not a rule, and a slide stating a problem does not have to be dark. What matters is that the choice is deliberate, that the same unit keeps its ground whichever layout renders it, and that grounds never alternate for variety alone. Composition follows the narrative too: where the type sits on a slide with no photograph comes from that unit's job in the story, not from the layout's own default. Centring every such slide because the container happens to be a full-slide one is the same mistake.

## Composition

- **Compose the slide, do not assemble it.** There is no house arrangement to apply. A plate may sit beside the type, above or below it, off-centre, bled toward one margin or held in the middle of the page; plates on one slide may be equal or deliberately unequal. Asymmetry, generous negative space, a dominant image with a small counterpoint, a detail set against its context — all are available, and the right one comes from the subject's own shape, the slide's job in the story, and the balance of the page. Read the photograph before you decide: a tall subject and a wide one want different treatment, and a composition that ignores the subject's shape will fight it. Two slides may share an arrangement when the story links them; repeating one arrangement through the whole set is a template.
- **Choose the arrangement for each slide — stacked is not the default.** A portrait page makes "photo on top, text below" the easy answer; that is exactly why it must be chosen, not assumed. For every photo slide, consider the options and pick the one that serves this slide best:
  - **Side by side** — a tall plate on the left or right running most of the page height, the type group in the column beside it. The natural choice for portrait photos and tall subjects (a doorway, a wardrobe run, a shower, a tall window), and when the focal point sits to one side.
  - **Stacked** — plate above or below the type, spanning the live width. The natural choice for wide, landscape photos and horizontal subjects (a vanity run, a kitchen counter, a long room).
  - **Offset / corner** — a plate pushed into one corner or bled off one or two page edges, the type group in the opposite field. Good for a strong diagonal, an asymmetric subject, or a detail that wants space around it.
  - **Layered** — a solid page-coloured type block that overlaps the plate's edge by roughly 60–160px, or a smaller plate overlapping a larger one (detail over context, before over after). Good for linking words and image tightly, or a detail to its room. The overlap never covers the focal point.
  - **Unequal pair** — two plates, one leading and one supporting, with the type tucked beside or between them.
  Decide from: the photo's proportion and the subject's shape; where the focal point sits (the type goes on the side away from it); the text length (a short headline is happy in a narrow column, a long one may need width); and the slide's job in the story (a turn or a reveal can earn a bolder, layered composition; a quiet step can stay simple). Write the choice and its reason in the slide's focal comment: `<!-- focal: … · arrangement: side by side, because the wardrobe is tall and sits on the left -->`.
  There is no quota and no rotation: the goal is that every slide's arrangement is the best one for it, not an even spread of types. But when every photo slide in your plan is stacked, re-check each one — that is only right when every photo is wide and every subject horizontal.
- **The photograph leads on a photo slide.** A plate is evidence, not a thumbnail: on a slide with a photo, the plate (or plates together) takes at least about 40% of the slide's area — roughly 580,000px², e.g. 900×650 stacked or 520×1120 side by side — and more on the cover, where the photo is the thumbnail. A stacked plate spans most of the live width; a side-by-side plate runs most of the live height. Shrink the type and its region before you shrink the photograph.
- **Every empty area is chosen, not left over.** Negative space works when it is one deliberate field that frames the plate or the type — a generous outer margin, a calm band above a headline. It fails when it is a gap a layout simply did not fill: a column beside a plate holding only a small label, a strip between the plate and the page edge wider than the margin. Before writing each slide, check every part of the page: if a region larger than about 300×300px holds nothing but a running head or a caption, either widen or enlarge the plate into it, or move the headline group into it. Small print (running heads, captions, labels) sits in the margins or against an edge of the plate; it never stands alone in the middle of an empty column.
- **Balance the page.** The plate and the type group are the two weights on the page; set them so the slide feels settled rather than top-heavy or lopsided — a large plate with a compact type block, or a smaller plate beside a type group that fills its column. A half-width plate with an empty half beside it, above a full-width headline, is the arrangement to avoid.
- **Use more than one image on a slide when it makes the story land harder.** Comparison, before and after, sequence, context next to detail, contrast, or simple reinforcement are all good reasons — the copy does not have to name several things for several images to be right. Decide whether the images carry equal weight or whether one leads and the others support, and size and place them accordingly. Never add an image to fill space or to manufacture variety.
- **Protect the focal point.** Identify what matters in each image according to the narrative, and crop (plate size and `object-position`) so that the subject, and enough of its surroundings to make the slide legible, survive. A plate is smaller than the frame, so the crop is tighter than full bleed and cuts more — check what the plate's edges remove, not only what they keep. A tight crop is good when it strengthens the composition and the evidence still reads; it is a failure when the reader can no longer tell what they are looking at, or when the detail the copy depends on has gone. When the slide proposes putting something somewhere — artwork on a bare wall, a cabinet in an alcove — the subject is the place, not the object the copy names.
- **Strong hook.** Make the opening visually compelling through photography, typography, composition, or their relationship. Avoid predictable oversized headlines.

## Typography

- **Exceptional typography.** Create intentional hierarchy through scale, weight, alignment, line breaks, and spacing. Adapt text size and proportions to the region it occupies and to the narrative rather than applying fixed treatments. Use the Brand Kit fonts; keep body/support text at the phone-readable size in "Give the words room" above.
- **Narrow columns are allowed here.** In a side-by-side or offset arrangement the type column may be narrower than the general 520px guide — down to about 360px — when the headline is sized to it (around 48–60px) and still breaks into lines of two or more words. Do not fall back to a stacked layout just because the type column would be narrow; shorten the line length and size the type to the column instead.
- **Keep the levels in proportion.** The headline leads but must not dwarf the rest. On photo slides set the headline around 56–76px and the supporting line around 28–34px — the headline about 2–2.4× the supporting line, never more than 2.6×. Running heads, captions and labels stay at least 20px and clearly readable, not hairline-thin print that disappears at phone size. On text-only slides the headline can go larger, and the supporting line grows with it so the ratio holds. When the headline needs to be smaller to fit beside a larger plate, make the supporting line smaller with it only down to its 26px floor.
- **Distribute the lines, do not place them.** Let the lines balance: none much shorter than its neighbours, no single word stranded on a line of its own, and no line so long that the eye loses the start of the next one (`text-wrap: balance` on headlines, `pretty` on support text, and a measure that suits the region). Break by hand (`<br>`) only where a break carries meaning, such as the ask on a closing slide or a phrase that must stay whole; everywhere else a hand-placed break is what produces the stranded word.
- **Let the narrative set the text hierarchy. Use the accent colour where it does work.** The Brand Kit accent is for emphasis that means something — the turn in a sentence, the phrase the slide is really about, a tie to an element elsewhere in the composition. Use it where it sharpens the hierarchy or carries the narrative, and leave it off where it would only decorate. Not every headline needs an accented phrase, and a set in which every headline has one reads as a formula. If the accent has low contrast against a dark ground, lighten it without losing its tone.

## Details and consistency

- **Purposeful details.** Use small labels, highlights, dividers, running heads, captions or other editorial elements when they improve hierarchy, storytelling, or composition. Avoid arbitrary decoration.
- **Hold the set together.** However much the compositions differ, the carousel has to read as one piece of work: a consistent type treatment, a consistent way of handling margins and editorial detailing, and grounds that belong to the same palette. Variation lives inside that, not against it.
- **Brand consistency.** Respect the supplied Brand Kit and use only real project assets. Never invent images, project details, or design decisions.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
