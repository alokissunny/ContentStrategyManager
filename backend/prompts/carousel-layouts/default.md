Create a high quality Instagram layout post from the given strategy agent output. Slides with a photo are full bleed; slides without one are text only.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide in the strategy output, in that order. Each slide is exactly 1080×1350 px.
- Slide count is fixed: write exactly as many slides as the strategy output lists, in its order. Never merge, drop, or skip a slide, and never fold two slides' copy into one — even when a slide has little copy or no photo.
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- Full bleed only where the strategy output gives the slide a photo (an asset key): that photo fills the slide edge to edge and the text sits on it, readable.
- A slide with no photo is text only: a solid brand-colour ground with the copy. Do not add, repeat, or borrow a photo from another slide, and do not add an image slot.
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (frame, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment.
- HTML only. No explanation.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
