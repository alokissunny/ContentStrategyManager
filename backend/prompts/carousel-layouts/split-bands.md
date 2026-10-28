Create a high quality Instagram carousel from the given strategy agent output. Layout: **Split bands** — each slide is split into a photo band and a solid colour band that holds the words. Text never sits on the photo.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide, numbered in reading order. Each slide is exactly `width:1080px;height:1350px`, `overflow:hidden`. Use px sizes only — no vw/vh or viewport clamp().
{{SLIDE_PLAN_RULES}}
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (frame, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment.
- HTML only. No explanation.

## Principles

- **Narrative first.** Understand the story before designing. Every slide should communicate a clear idea, with composition and emphasis driven by its narrative purpose.
- **The split is a proportion, and it is a decision.** Vary where the band cuts the frame — a deep band under a wide photograph, a narrow strip against a tall one, a vertical column beside it — according to how much the photograph has to show and how much the type needs. A band that always takes the same third of every slide is a template, not a split.
- **Protect the focal point.** Text placement should not cover important focal points in the image, based on what the narrative needs to show. Position text where it preserves the visual elements essential to the story.
- **Exceptional typography.** Create intentional hierarchy through scale, weight, alignment, line breaks, and spacing. Adapt text size and proportions to the band and narrative rather than applying fixed treatments.
- **Three levels of text in every band.** An eyebrow, a headline, and a supporting line.
- **Strong hook.** Make the opening visually compelling through photography, typography, composition, or their relationship. Avoid predictable oversized headlines.
- **Brand consistency.** Respect the supplied Brand Kit and use only real project assets.

## Photo slides — two bands

- Build the slide as two bands, edge to edge with no gap or border: a photo band and a text band. Choose each slide's split — its depth and its direction (horizontal or vertical) — from that slide's photograph and copy, as above; neighbouring slides should not share the same split.
- Start each photo slide with `<!-- focal: what the slide is about in this photo, and which edge the band can take -->`. Look at the attached photo first.
- The photo fills its band: `width:100%; height:100%; object-fit:cover`, with `object-position` set so the focal point survives the crop.
- The text band is a solid brand colour — rotate between `--brand-background`, `--brand-primary` (with light text) and, at most once, the accent. 64–80px padding; the text group aligned to the band's left edge and vertically centred or top-aligned.
- No text, gradient, or overlay on the photo band.

## Text-only slides

- A slide without a photo is one solid band (full slide) in a brand colour, the text group low-left or high-left with generous space. A thin full-width hairline can echo the band split.

## Type system (every slide)

Starting points, not fixed treatments — size each level to its band and the slide's narrative.
- Eyebrow: letter-spaced caps (around 20–24px, 600–700, 0.14em) in the accent colour (or the light colour on an accent band).
- Headline: brand display font, 600–700, line-height 1.04–1.1, roughly 56–92px depending on the band's room and the line's weight in the story. A second sentence or turn may take the accent colour.
- Highlighted words use the text accent colour instead of bold or underline treatments. If the accent colour has low contrast against a dark background, lighten it without losing its original tone.
- Supporting line: 26–30px body font, up to three lines.
- Eyebrow → headline → supporting line in ONE flex-column group with a 14–22px gap. Budget lines so the group fits its band. No `<br>` in copy; use `text-wrap: balance`.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
