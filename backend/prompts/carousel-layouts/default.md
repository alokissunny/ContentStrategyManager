Create a high quality Instagram layout post from the given strategy agent output. Slides with a photo are full bleed; slides without one are text only.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
</section>
```

- One `<article class="slide" data-index="N">` per slide, numbered in reading order. Each slide is exactly 1080×1350 px.
{{SLIDE_PLAN_RULES}}
- `data-slot` on every editable text run. Photos: `<img data-slot="image" data-asset-key="…">` using the asset key from the strategy output.
- A slide with one photo is full bleed: the photo fills the slide edge to edge and the text sits on it, readable. Photos come only from the strategy output (its asset keys).
- A slide with no photo is text only: a solid brand-colour ground with the copy, and no image slot.
- Highlighted words use the text accent colour instead of bold or underline treatments. If the accent colour has low contrast against a dark background, lighten it without losing its original tone.
- Write compact HTML: one `<style>` block with shared classes for everything that repeats (frame, counter, hairline, eyebrow, headline, supporting line, accent devices), and per-slide rules only for what differs. No repeated inline styles, no unused CSS, no comments except each photo slide's focal comment and the hook-reasoning comment when asked for.
{{COMPOSITION_RULES}}
{{BRAND_ROLES}}
- HTML only. No explanation.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
