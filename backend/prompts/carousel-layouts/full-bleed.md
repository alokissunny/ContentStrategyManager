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
- HTML only. No explanation.

## Photo slides — full bleed, text on the image

- The photo is `position:absolute; inset:0; width:100%; height:100%; object-fit:cover`. No card, panel, band, border, or split layout.
- Start each photo slide with `<!-- focal: what the subject is and where it sits -->`. Look at the attached photo before you place anything.
- Put the text group on the calmest area of the photo, away from the subject: a dark floor, a shadowed wall, an empty ceiling, a plain foreground. Top-left or bottom-left are usual; pick per photo, never by habit. Never cross a face, a product, or the slide's focal object.
- Text must read at a glance. On dark or mid-tone areas use the light brand colour (`--brand-background`); on pale areas use the dark one (`--brand-primary`). If the area is busy, add a soft gradient behind the whole text group only (`<div class="wash">`, the matching brand colour at 45–65%, fading out ~200px beyond the text). Never a solid block.
- Keep text inside a 72px safe margin on every side.

## Text-only slides — solid ground

- Full bleed is only for slides the strategy output gives a photo (an asset key). A slide with no photo stays text only — never add, repeat, or borrow a photo from another slide, and add no image slot.
- A slide without a photo uses a solid brand ground: the dark brand colour for the hook/opening rhythm, the light ground for takeaway and CTA slides. Alternate so neighbouring slides don't look alike.
- Place the text group low-left (hook, takeaway, CTA) or high-left (context slides); let the empty ground breathe — never centre everything.

## Type system (every slide)

- Kicker: small letter-spaced caps (20–24px, 600–700 weight, 0.14em tracking) in the accent colour. Optionally a 56px hairline rule in the accent above it on the hook and CTA.
- Headline: the brand display font, 600–700 weight, tight tracking (-0.02em), line-height 1.02–1.08; 76–96px on photo slides, 84–108px on the hook and final slide. When the headline has two sentences or a turn, set the second in the accent colour.
- Support line: 26–32px body font, regular weight, one or two lines, under the headline.
- Kicker → headline → support in ONE flex-column group with a 16–24px gap. No `<br>` in copy; use `text-wrap: balance`.

STRATEGY AGENT OUTPUT:
{{CONTENT_STRUCTURE_JSON}}

FINAL COPY:
{{DAY_WRITER_OUTPUT}}

BRAND STYLE:
{{BRAND_STYLE}}

BRAND:
{{BRAND_JSON}}
