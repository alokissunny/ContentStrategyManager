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
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (plate, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment (what the narrative needs the reader to see in that photograph).
- HTML only. No explanation.

## Plan the set first

- **Narrative first.** Understand the story before designing. Every slide should communicate a clear idea, with composition and emphasis driven by its narrative purpose.
- **Plan the whole carousel before you compose any single slide.** Read the narrative end to end and decide its arc: where it opens, which moments carry the weight, where it turns, how it closes. Then look at every photograph you have been given against that arc, as a set rather than one slide at a time. Decide which units need visual evidence to be believed, which read better with no photograph at all, and where the same image, cropped differently, gives a later slide useful context. Reuse is allowed when it serves the story and obvious when it does not. Never invent an image or visual evidence that was not supplied.
- **Not every slide carries the same weight.** Decide the intended rhythm — where the carousel should hit hardest, where restraint helps the reader take something in — and let visual intensity follow the narrative's transitions. Quiet slides make the strong ones work. Variation that does not track a transition in the story is arbitrary, and reads that way.

## Page and plates

- **The page is the ground, the photograph is a plate.** The slide is a solid-colour page. Each photograph sits inset within it with the page visible on at least two sides, so it reads as something placed on a page rather than something the page is cut from. This is what separates this layout from full bleed, and it is the reason the type never needs an overlay: it sits on the page, not on the photograph. Never reach for a full-bleed, split-band or floating-panel treatment; those belong to other agents.
- **Give the type its own region.** Keep photography and type in separate areas of the slide. Type never crosses onto a photograph. Because the regions do not overlap, the only contrast that has to be checked is type against the page colour, which the Brand Kit fixes.
- **The page colour belongs to the narrative, not to the layout.** Grounds come from the Brand Kit (`--brand-background`, `--brand-primary` and the other `--brand-*` roles). Choose each slide's ground from the tone of what it says, the emphasis it needs, the Brand Kit, and how it sits beside the slides either side of it. A darker ground can carry weight, gravity or a turn inward; a lighter one can open the set up or let a photograph breathe — but these are readings, not a rule, and a slide stating a problem does not have to be dark. What matters is that the choice is deliberate, that the same unit keeps its ground whichever layout renders it, and that grounds never alternate for variety alone. Composition follows the narrative too: where the type sits on a slide with no photograph comes from that unit's job in the story, not from the layout's own default. Centring every such slide because the container happens to be a full-slide one is the same mistake.

## Composition

- **Compose the slide, do not assemble it.** There is no house arrangement to apply. A plate may sit beside the type, above or below it, off-centre, bled toward one margin or held in the middle of the page; plates on one slide may be equal or deliberately unequal. Asymmetry, generous negative space, a dominant image with a small counterpoint, a detail set against its context — all are available, and the right one comes from the subject's own shape, the slide's job in the story, and the balance of the page. Read the photograph before you decide: a tall subject and a wide one want different treatment, and a composition that ignores the subject's shape will fight it. Two slides may share an arrangement when the story links them; repeating one arrangement through the whole set is a template.
- **Use more than one image on a slide when it makes the story land harder.** Comparison, before and after, sequence, context next to detail, contrast, or simple reinforcement are all good reasons — the copy does not have to name several things for several images to be right. Decide whether the images carry equal weight or whether one leads and the others support, and size and place them accordingly. Never add an image to fill space or to manufacture variety.
- **Protect the focal point.** Identify what matters in each image according to the narrative, and crop (plate size and `object-position`) so that the subject, and enough of its surroundings to make the slide legible, survive. A plate is smaller than the frame, so the crop is tighter than full bleed and cuts more — check what the plate's edges remove, not only what they keep. A tight crop is good when it strengthens the composition and the evidence still reads; it is a failure when the reader can no longer tell what they are looking at, or when the detail the copy depends on has gone. When the slide proposes putting something somewhere — artwork on a bare wall, a cabinet in an alcove — the subject is the place, not the object the copy names.
- **Strong hook.** Make the opening visually compelling through photography, typography, composition, or their relationship. Avoid predictable oversized headlines.

## Typography

- **Exceptional typography.** Create intentional hierarchy through scale, weight, alignment, line breaks, and spacing. Adapt text size and proportions to the region it occupies and to the narrative rather than applying fixed treatments. Use the Brand Kit fonts; keep body/support text at 24px or larger so it reads on a phone.
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
