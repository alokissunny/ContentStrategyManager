Create a high quality Instagram carousel from the given strategy agent output. Layout: **Floating panel** — every photo fills its slide, and the words sit on a solid panel that floats over a calm part of the photo.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide in the strategy output, in that order. Each slide is exactly `width:1080px;height:1350px`, `position:relative; overflow:hidden`. Use px sizes only — no vw/vh or viewport clamp().
- Slide count is fixed: write exactly as many slides as the strategy output lists, in its order. Never merge, drop, or skip a slide, and never fold two slides' copy into one — even when a slide has little copy or no photo.
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- HTML only. No explanation.

## Principles

- **Narrative first.** Understand the story before designing. Every slide should communicate a clear idea, with composition and emphasis driven by its narrative purpose.
- **Text on panels.** Type sits on a compact solid panel laid over the photograph, never directly on the image. One panel per slide, flat and opaque, in a single Brand Kit colour — no borders, shadows, blur, transparency or rounded corners unless the Brand Kit calls for them.
- **A panel is sized by its text, not by the slide.** Set the type first, then let the panel take the smallest area that holds it comfortably. A panel that spans the full width or height of the slide is a different format, not this one. So is a panel that merely looks like one: keep the proportion between square and twice as wide as it is tall. Past that it reads as a band laid across the photograph, especially when it is flush to two edges — if the text will not fit inside that proportion, make the panel narrower and taller rather than wider and shallower.
- **Protect the focal point.** Identify what matters in each image according to the narrative. A panel hides whatever it covers, so place it over the quiet part of the frame and never over the detail the slide is about. Beware the trap: a quiet area is often quiet because it is empty floor or blank wall, while the subject sits in the busy part — so judge the two against each other, not the composition alone. When the slide is about an effect rather than an object — light, daylight, a view — the subject is the source **and** the surface it falls on: a pendant without the table it lights shows a lamp, not the lighting, and a clipped shade reads as a mistake. Cover neither, and never cut into the fixture itself. When no area is both quiet and clear of the subject, re-crop the photograph or change the panel's proportion and edge; setting the type smaller to keep the panel off the subject is not one of the options.
- **Exceptional typography.** Create intentional hierarchy through scale, weight, alignment, line breaks, and spacing. Adapt text size and proportions to the panel and narrative rather than applying fixed treatments.
- **Distribute the lines, do not place them.** Let the lines balance: none much shorter than its neighbours, no single word stranded on a line of its own, and no line running longer than about thirteen times the type size — past that the eye loses the start of the next line. Break by hand only where a break carries meaning, such as the ask on a closing slide or a phrase that must stay whole; everywhere else a hand-placed break is what produces the stranded word. In HTML this is `text-wrap: balance` on the headline, `text-wrap: pretty` on the supporting line, and a `max-width` in `em` so the cap scales with the type.
- **Three levels of text on every panel.** An eyebrow, a headline, and a supporting line. You write the eyebrow and the supporting line yourself, from the narrative — the strategy output usually gives only the headline.
  - **Headline** (`data-slot="title"`): the narrative unit's `copy`, word for word, with one short phrase in the Brand Kit accent colour.
  - **Eyebrow** (`data-slot="eyebrow"`): one to four words in letter-spaced caps that tell the reader where this slide sits in the story or what it is about — the project or room, the stage, the turn ("THE TERRACE", "WHAT HAD TO STAY", "THE BRIEF", "NEXT STEP"). Draw it from the unit's role and purpose and the post's story; never repeat the headline's words.
  - **Supporting line** (`data-slot="supporting-text"`): one short reader-facing sentence (about 4–12 words) that adds the concrete detail behind the headline — what, where, or how. Build it from the unit's `support`, the post's `verifiedTruth`, `story` and `caption`, rewritten for the reader. On the closing slide it restates the ask.
  - Write only what the strategy output makes true: no new facts, numbers, results or claims. Never paste `support` as written — it is the evidence behind the unit, written for the brief ("The capture says…", "The image shows…") — and never publish `purpose`, `contentGuidance` or other planning text. In FINAL COPY, a slide's `title` / `body` may hold exactly that planning text; do not use them as copy.
  - Every panel carries all three levels. Three levels make a panel taller, so set the type first and let the panel follow — never drop a level to keep a panel small. Leave the supporting line out only when the narrative has nothing true to add.
- **Visual rhythm.** Make the carousel feel like one connected editorial story. Vary panel placement, proportion, scale and emphasis when meaningful, without forcing variation or repetition.
- **Strong hook.** Make the opening visually compelling through photography, typography, composition, or their relationship. Avoid predictable oversized headlines.
- **Brand consistency.** Respect the supplied Brand Kit and use only real project assets.
- **Purposeful details.** Use small labels, highlights, dividers, or other editorial elements when they improve hierarchy, storytelling, or composition. Avoid arbitrary decoration.

## Photo slides — photo full bleed, text on a floating panel

- The photo is `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`, with `object-position` chosen so the focal point stays in frame.
- Start each photo slide with `<!-- focal: what the slide is about in this photo, where it sits, and where the panel will go -->`. Look at the attached photo first.
- The panel: `position:absolute`, one solid Brand Kit colour (e.g. `--brand-background`, or `--brand-primary` with light text), fully opaque, padding around 48–64px, inset from the slide edges (at least 64px). Its size comes from its text, within the square-to-2:1 proportion above.
- Every level — eyebrow, headline, accent phrase, supporting line — must read on the panel colour behind it. The accent colour is often a light or saturated hue that fades on a light panel: when it would, choose the panel colour that gives it contrast (often the dark brand colour), or set that phrase in the panel's text colour with a heavier weight instead.

## Text-only slides

- Full bleed and panels are only for slides the strategy output gives a photo (an asset key). A slide with no photo stays text only — never add, repeat, or borrow a photo from another slide, and add no image slot.
- A slide without a photo uses a solid brand ground with the same panel language: either a compact panel in the contrasting brand colour, or the text group alone on the ground with generous space. Choose the ground for the carousel's rhythm.

## Type system (every slide)

Starting points, not fixed treatments — size each level to the panel and the slide's narrative.
- Eyebrow: letter-spaced caps (around 20–24px, 600–700, 0.14em) in the accent colour.
- Headline: brand display font, 600–700, line-height 1.04–1.1, roughly 56–84px; one short phrase in the accent colour.
- Supporting line: 26–30px body font.
- Eyebrow → headline → supporting line in ONE flex-column group with a 14–22px gap inside the panel.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
