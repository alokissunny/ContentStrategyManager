Create a high quality Instagram carousel from the given strategy agent output. Layout: **Full bleed** — every photo fills its slide edge to edge, and the words sit directly on the photo where they read best.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide in the strategy output, in that order. Each slide is exactly `width:1080px;height:1350px`, `position:relative; overflow:hidden`. Use px sizes only — no vw/vh or viewport clamp().
- Slide count is fixed: write exactly as many slides as the strategy output lists, in its order. Never merge, drop, or skip a slide, and never fold two slides' copy into one — even when a slide has little copy or no photo.
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (frame, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment.
- HTML only. No explanation.

## Principles

- **Narrative first.** Understand the story before designing. Every slide should communicate a clear idea, with composition and emphasis driven by its narrative purpose.
- **Full-bleed photography.** Let project images occupy the entire canvas. Integrate typography directly into the photography, using its natural composition, geometry, and available visual space.
- **Protect the focal point.** Text placement should not cover important focal points in the image, based on what the narrative needs to show. Position text where it preserves the visual elements essential to the story.
- **Exceptional typography.** Create intentional hierarchy through scale, weight, alignment, line breaks, and spacing. Adapt text size and proportions to the image and narrative rather than applying fixed treatments.
- **Distribute the lines, do not place them.** Let the lines balance: none much shorter than its neighbours, no single word stranded on a line of its own, and no line running longer than about thirteen times the type size — past that the eye loses the start of the next line. Break by hand only where a break carries meaning, such as the ask on a closing slide or a phrase that must stay whole; everywhere else a hand-placed break is what produces the stranded word. In HTML this is `text-wrap: balance` on the headline, `text-wrap: pretty` on the supporting line, and a `max-width` in `em` so the cap scales with the type.
- **Three levels of text on every slide.** An eyebrow, a headline, and a supporting line. You write the eyebrow and the supporting line yourself, from the narrative — the strategy output usually gives only the headline.
  - **Headline** (`data-slot="title"`): the narrative unit's `copy`, word for word, with one short phrase in the Brand Kit accent colour.
  - **Eyebrow** (`data-slot="eyebrow"`): one to four words in letter-spaced caps that tell the reader where this slide sits in the story or what it is about — the project or room, the stage, the turn ("THE TERRACE", "WHAT HAD TO STAY", "THE BRIEF", "NEXT STEP"). Draw it from the unit's role and purpose and the post's story; never repeat the headline's words.
  - **Supporting line** (`data-slot="supporting-text"`): one short reader-facing sentence (about 4–12 words) that adds the concrete detail behind the headline — what, where, or how. Build it from the unit's `support`, the post's `verifiedTruth`, `story` and `caption`, rewritten for the reader. On the closing slide it restates the ask.
  - Write only what the strategy output makes true: no new facts, numbers, results or claims. Never paste `support` as written — it is the evidence behind the unit, written for the brief ("The capture says…", "The image shows…") — and never publish `purpose`, `contentGuidance` or other planning text. In FINAL COPY, a slide's `title` / `body` may hold exactly that planning text; do not use them as copy.
  - Every slide carries all three levels. Leave the supporting line out only when the narrative has nothing true to add — never to simplify a composition.
- **Visual rhythm.** Make the carousel feel like one connected editorial story. Vary text placement, scale, alignment, and emphasis when meaningful, without forcing variation or repetition.
- **Strong hook.** Make the opening visually compelling through photography, typography, composition, or their relationship. Avoid predictable oversized headlines.
- **Purposeful details.** Use small labels, highlights, dividers, or other editorial elements when they improve hierarchy, storytelling, or composition. Avoid arbitrary decoration.
- **Brand consistency.** Respect the supplied Brand Kit and use only real project assets.

## Photo slides — full bleed, text on the image

- The photo is `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`, with `object-position` chosen so the focal point stays in frame. No card, panel, band, border, or split layout.
- Start each photo slide with `<!-- focal: what the slide is about in this photo, where it sits, and where the text will go -->`. Look at the attached photo before you place anything.
- Text must read at a glance. On dark or mid-tone areas use the light brand colour (`--brand-background`); on pale areas use the dark one (`--brand-primary`). Where contrast still falls short, a soft gradient may sit behind the text group only (`<div class="wash">`, the matching brand colour, fading out ~200px beyond the text) — never a solid block, and never as a way to put text over the subject.
- Every level — eyebrow, headline, accent phrase, supporting line — must read on the pixels behind it. The accent colour is often a light or saturated hue that disappears on sky, windows or pale walls: when it would, move the text group to a darker, calmer area; on a dark area, lighten the accent without losing its original tone. Never fall back to bold or underline to mark the phrase.
- Keep text inside a 72px safe margin on every side.

## Text-only slides — solid ground

- Full bleed is only for slides the strategy output gives a photo (an asset key). A slide with no photo stays text only — never add, repeat, or borrow a photo from another slide, and add no image slot.
- A slide without a photo uses a solid brand ground (dark or light), chosen for the carousel's rhythm so neighbouring slides don't look alike. Let the empty ground breathe — never centre everything by default.

## Type system (every slide)

Starting points, not fixed treatments — size each level to the image and the slide's narrative.
- Eyebrow: small letter-spaced caps (around 20–24px, 600–700 weight, 0.14em tracking) in the accent colour.
- Headline: the brand display font, 600–700 weight, tight tracking (-0.02em), line-height 1.02–1.08, roughly 64–96px; one short phrase in the accent colour.
- Highlighted words use the text accent colour instead of bold or underline treatments. If the accent colour has low contrast against a dark background, lighten it without losing its original tone.
- Supporting line: 26–32px body font, regular weight, under the headline.
- Eyebrow → headline → supporting line in ONE flex-column group with a 16–24px gap.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
