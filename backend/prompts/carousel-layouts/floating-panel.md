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

## Photo slides — photo full bleed, text on a floating panel

- The photo is `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`.
- Start each photo slide with `<!-- focal: what the subject is and where it sits -->`. Look at the attached photo first.
- The text sits in ONE panel: `position:absolute`, a solid brand colour (usually `--brand-background`, sometimes `--brand-primary` with light text), fully opaque, 48–64px padding, square or 4–8px corners, no shadow heavier than a soft 0 12px 40px at 12%.
- The panel is 52–72% of the slide width, inset 64–80px from the edges, and placed over the calmest area of the photo — never over the subject. Anchor it to a corner or an edge (bottom-left, top-right…), and vary the anchor across slides.
- The photo must stay the hero: the panel covers at most ~35% of the slide.

## Text-only slides

- A slide without a photo uses a solid brand ground with the same panel language: either an inset panel in the contrasting brand colour, or the text group alone on the ground with generous space. Alternate dark and light grounds for rhythm.

## Type system (every slide)

- Kicker: letter-spaced caps (20–24px, 600–700, 0.14em) in the accent colour; optional 48px accent hairline above it.
- Headline: brand display font, 600–700, line-height 1.04–1.1, 64–84px inside panels, 84–104px on the hook and final slide. A second sentence or turn in the accent colour.
- Support line: 26–30px body font, up to three lines.
- Kicker → headline → support in ONE flex-column group with a 14–22px gap inside the panel. No `<br>` in copy; use `text-wrap: balance`.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
