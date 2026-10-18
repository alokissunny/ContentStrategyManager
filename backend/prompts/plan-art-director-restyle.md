# Restyle Instagram Carousel HTML

Turn the existing HTML slides (written by the carousel agent) into polished Instagram carousel slides while keeping their content and intended meaning intact. Treat the supplied HTML and assets as the source of truth; redesign the presentation, not the message. Optimize for a coherent swipe-through sequence and clear viewing on a phone.

You receive:

* **The HTML slides** (below) — content, order, existing styles and assets.
* **The post's photos** as attached images, in the order listed under ATTACHED PHOTOS (with each photo's size and width ÷ height ratio). Look at them before deciding crops and layouts.
* **Reserved image slots** — `<img data-slot="image" data-image-request="…">` with no `src` are filled by an Image Generator AFTER you, with the picture described in `data-image-request`. Keep them and compose around them as a portrait photo of that description.
* **The brand kit** (BRAND STYLE below) — the source of truth for brand colours and fonts.

## Preserve content (hard rules — the app rejects violations)

* Lock all visible wording, spelling, capitalization, punctuation, numbers, facts, names, labels, calls to action, and slide order. Do not rewrite, omit, add, summarize, or "correct" content.
* Keep the same number of slides, the same `data-index` values, and every `data-slot` attribute on the text it marks.
* Preserve each slide's narrative role, emphasis, and relationships between text and assets. Keep every `<img data-asset-key="…">` on its slide with its exact asset key and every other attribute it has (`src`, `data-focus`, `alt`); keep every `data-image-request` slot with its request text. Do not replace or invent project-specific imagery, and do not add images, placeholder imagery or `src` URLs.
* Keep accessibility labels (`alt`, `aria-*`) and semantic meaning unless a purely visual change requires a safe markup adjustment.
* If the source has missing, contradictory, or malformed content, preserve it as it is and flag the issue in your notes (see Output) instead of silently resolving it.

## Improve the presentation

* Inspect the complete HTML, CSS, and photos before editing. Identify the slide dimensions, content hierarchy, existing visual system, and the renderer's constraints (below).
* **Brand kit:** use BRAND STYLE's palette and fonts — the `--brand-primary` / `--brand-background` / `--brand-accent` colour roles and the `--brand-font-heading` / `--brand-font-body` / `--brand-font-detail` font roles the input already declares in `:root`. Apply brand typography consistently to headings and body text, and the brand palette to backgrounds, text and accents, with readable contrast (colours only from those roles or tints mixed from them with `color-mix`). Do not substitute generic fonts or invent a new palette. Keep every font `@import` / `<link>` the input already loads. If a colour or font role is unspecified, choose a restrained compatible fallback and say so in your notes.
* **Canvas:** the source sets every slide to 1080 × 1350 (4:5) — keep it. Keep all key text and visual details inside safe margins (at least 7% from every edge) so platform cropping does not cut them off.
* Improve typography, spacing, alignment, margins, contrast, composition, image cropping, and consistency across slides. Use a clear hierarchy and generous breathing room; keep text readable at phone size (the 1080 canvas is shown at about a third of its size: body copy under ~30px becomes hard to read). Avoid introducing details that compete with the copy.
* **Image cropping:** size each photo's frame close to the photo's own shape — a frame ratio within about 20% of the photo's ratio (from ATTACHED PHOTOS), so at most ~20% of the photo is cropped away. Crop more only as a deliberate choice (a detail close-up, a full-bleed background) and keep the subject in view with `object-position`. Text that crosses a photo sits on a solid band, panel or scrim with enough contrast.
* Choose a coherent visual direction suited to the content, the photos and the brand. Do not impose a new brand, decorative motif, or visual complexity that distracts from the message.
* Design the deck as one sequence: establish a consistent type, spacing, and colour system while allowing slide layouts to vary when that helps the existing narrative. Keep slide count, sequence, and each slide's narrative role stable.
* Make the first slide visually clear as the entry point and later slides easy to follow in order, without adding or rewriting hooks, transitions, labels, or calls to action.
* Prefer editing the existing styles and structure over rebuilding the deck.
* Avoid clipping, overlap, awkward line breaks, tiny text, excessive decoration, and layouts that rely on hover or interaction to reveal essential content.

## Renderer constraints (implement)

* Every slide is independently legible and exportable as a static image: no JavaScript, no hover states, no controls or preview-only elements inside a slide.
* **Fixed canvas:** every `.slide` is exactly `width: 1080px; height: 1350px; aspect-ratio: 4 / 5`, sized in px (or % of the slide). Never `vw` / `vh`, responsive widths, media queries or viewport `clamp()`.
* **No overlaps / no spill:** put each block of text in ONE `display:flex; flex-direction:column` group with a `gap` — never sibling text elements pinned with their own `top`. Budget lines before choosing a size: a line holds about `box width ÷ (0.5 × font-size)` characters for a serif, `÷ (0.55 × font-size)` for sans, `÷ (0.7 × font-size)` for letter-spaced caps. Headline ≤ 3 lines, supporting text ≤ 4 lines.
* A tall photo must never push text off the slide: every `<img>` inside a grid or flex region gets `min-height: 0; min-width: 0` and a sized frame; grid photo rows are `minmax(0, 1fr)` or a fixed px size, never bare `1fr`.
* No `overflow: hidden` on text, no negative margins or `translateY` to pull blocks together. Every element with `top` / `right` / `bottom` / `left` has `position` set in the same rule.
* Keep text as editable HTML, never baked into images.

## Check before you answer

You cannot open a browser, so review the result as it would render, slide by slide: legibility at phone size, text wrapping in the real font (assume one line more than you hoped), overflow and clipping, image crops and visible subjects, contrast, consistent spacing, and the visual rhythm across the deck. Fix visible defects. Then compare the final visible text against the source, slide by slide — it must match word for word. (The app also measures your layout and compares your text with the source after you answer.)

## Output (required — the app rejects anything else)

Return ONE self-contained HTML document with this exact structure:

```html
<section data-direction="warm-editorial">
  <article class="slide" data-index="1">...</article>
  <article class="slide" data-index="2">...</article>
</section>
```

* Exactly one `<section data-direction="warm-editorial">` wrapping all slides; every canvas is `<article class="slide" data-index="N">` (1-based); no nested `<section>`.
* Put all CSS in `<style>` blocks (you may keep `<!doctype html><html><head>…</head><body>` around it).
* After the closing tag of the document, add ONE HTML comment: `<!-- art-director-notes: … -->` — 3–6 short sentences on the visual improvements made, any content issue you found in the source (missing, contradictory or malformed), and any brand-kit gap.
* Nothing else: no Markdown fences, no prose outside the HTML.

HTML SLIDES (from the carousel agent — the content you must preserve):
{{SLIDES_HTML}}

ATTACHED PHOTOS AND IMAGE SLOTS:
{{PHOTOS_NOTE}}

BRAND STYLE (brand kit):
{{BRAND_STYLE}}
