Design a high quality single-image Instagram feed post from the given format strategy. The Static post strategist has already decided the idea, the words and the photo (`formatStrategy` in the strategy output) — your job is the design: how that one image looks.

Return one self-contained HTML document only:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1" data-role="hook">...</article>
</section>
```

- Exactly ONE `<article class="slide" data-index="1" data-role="hook">`, exactly `width:1080px;height:1350px`, `position:relative; overflow:hidden`. Px sizes only — no vw/vh or viewport clamp(). Never a second slide.
- `data-slot` on every text run: `eyebrow`, `title`, `supporting-text`. The photo: `<img data-slot="image" data-asset-key="…">` with `formatStrategy.photo.assetKey` exactly — use no other photo.
- Compact HTML: one `<style>` block, no unused CSS, no comments except the photo's focal comment.
{{COMPOSITION_RULES}}
{{BRAND_ROLES}}
- HTML only. No explanation.

## Use the strategy's words exactly

- Headline = `formatStrategy.headline`, word for word, with `formatStrategy.accent` set in the Brand Kit accent colour (`<span class="accent">`). Eyebrow = `formatStrategy.eyebrow` and supporting line = `formatStrategy.supportingLine` — each only when not empty. Never add, rewrite or extend copy; never put the caption on the image.

## Design principles

- **One image, one read.** It is a poster, not a slide in a sequence: the whole composition serves the headline and the photo together. It must read at grid-tile size — the subject (`formatStrategy.photo.keepInFrame`) legible, the headline large and short-lined.
- **Full-bleed photo.** `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`, with `object-position` keeping `keepInFrame` in view. Start the slide with `<!-- focal: what the image is about, where it sits, and where the text will go -->`. Look at the attached photo before you place anything.
- **Text where the photo is calm.** Put the eyebrow → headline → supporting line in ONE flex-column group (16–24px gap) on `formatStrategy.photo.textArea` or another calm area — never over the subject. Light brand colour (`--brand-background`) on dark areas, dark (`--brand-primary`) on pale ones. Only where contrast still falls short, a soft gradient behind the group (`<div class="wash">`, fading ~200px beyond the text) — never a solid block, never a tint over the whole photo.
- **Exceptional typography.** Headline in the brand display font, 600–700 weight, tight tracking (-0.02em), line-height 1.02–1.08, roughly 84–120px (larger than a carousel slide — it is the only thing to read); `text-wrap: balance` and a `max-width` in `em` (about 11em). Eyebrow 20–24px letter-spaced caps in the accent colour. Supporting line 28–34px body font, `text-wrap: pretty`.
- **Every level reads on the pixels behind it**, accent phrase included: on pale sky or walls move the group to a darker area or lighten/darken the accent within its hue. Never bold or underline instead.
- **Safe margin.** Keep text 72px inside every edge.
- **No photo** (`assetKey` empty): a solid ground from the Brand Kit, the headline large and composed with intent — not centred by default.
- **Brand consistency.** Respect the Brand Kit; use only the real photo.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
