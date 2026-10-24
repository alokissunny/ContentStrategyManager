Create a high quality Instagram carousel from the given strategy agent output. Layout: **Editorial** — magazine spreads: framed photos on a paper ground, a clear type hierarchy, generous margins and small print details.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide in the strategy output, in that order. Each slide is exactly `width:1080px;height:1350px`, `overflow:hidden`. Use px sizes only — no vw/vh or viewport clamp().
- Slide count is fixed: write exactly as many slides as the strategy output lists, in its order. Never merge, drop, or skip a slide, and never fold two slides' copy into one — even when a slide has little copy or no photo.
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- HTML only. No explanation.

## Page

- Ground: the light brand colour (`--brand-background`) on most slides, one dark slide (`--brand-primary` ground, light text) for rhythm. Margins 80–96px on every side.
- A running head on every slide: small caps folio at the top (e.g. the kicker or brand name on the left, `03 / 08` on the right, 18–20px, 0.14em tracking) and a full-width hairline under it.

## Photo slides — framed, not full bleed

- The photo sits in a frame inside the margins with its ratio within ~20% of the photo's own ratio — no squeezing into thin columns. Look at the attached photo first; crop with `object-position` so the subject stays in frame.
- Vary the composition across slides: large photo top with text below; photo on one side with a text column; a smaller inset photo next to a big headline; one slide may break the margin and run the photo to one edge.
- A short caption (16–20px, italic or caps) may sit under a photo when the copy has one. Text never sits on the photo.

## Text-only slides

- Treat as a typographic page: a big headline set high or low, a hairline, the support text as a short column, or a pull-quote with oversized quotation marks in the accent colour.

## Type system (every slide)

- Headlines in the brand display font — a serif if the brand has one — 64–92px, 84–110px on the hook and final slide, line-height 1.02–1.1; use the italic for the turn or emphasis.
- Kicker: letter-spaced caps (18–22px, 600–700, 0.16em) in the accent colour.
- Body/support: 26–30px body font, line-height 1.4, max ~32 characters per line in columns.
- Kicker → headline → support in ONE flex-column group with a 16–24px gap. No `<br>` in copy; use `text-wrap: pretty`.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
