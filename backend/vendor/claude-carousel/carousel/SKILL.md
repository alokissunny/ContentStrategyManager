---
name: carousel
description: >-
  Generate multi-slide social-media carousel posts as ready-to-upload PNG image
  sets. Use when the user wants a carousel, slide post, swipe post, or
  multi-image post for LinkedIn, Instagram, X/Twitter, or Facebook — from a
  topic, an outline, or a URL/newsletter. Triggers: carousel, linkedin
  carousel, instagram carousel, slide post, swipe post, multi-image post,
  carousel template, educational carousel, carousel slides, make a carousel.
allowed-tools: Read, Write, Bash, Task
---

# Carousel

Turn a topic, outline, or URL into a numbered set of carousel slide PNGs.
Slides are authored as HTML/CSS and rendered locally with headless Chromium —
deterministic, free, no cloud account. The same HTML always yields the same
pixels. Every render is validated for clipped, off-slide, overlapping and
low-contrast text before the set is finalised.

## When to use

Any request for a LinkedIn / Instagram / X / Facebook carousel, slide post,
or swipe post.

## Resolving the style

The carousel's look comes from a **style**, resolved in this order:

1. **Inline-pasted spec** — the user pastes a design brief in their request.
   Use it for this run, then offer to save it as the agency default
   (`<agency>/brand/carousel-style.md`).
2. **Agency style spec** — if the carousel is for an agency, read
   `<agency>/brand/carousel-style.md` (a prose design brief). This is the
   default for that agency. It **overrides** `<agency>/brand/*_brand.json`
   for carousel *visuals*; still read the brand JSON's `voice` /
   `content_pillars` for on-brand copy.
3. **Generic theme** — no agency, no spec: use a built-in
   `templates/<theme>.html` (`default`, `bold`, `technical`).

When working in a multi-agency repo, an agency's style is discovered at
`<agency>/brand/carousel-style.md` — author it once per agency (a prose design
brief) and the skill compiles it to a reusable `carousel.css` +
`carousel-template.html` alongside it.

## Workflow

### 1. Gather inputs

Confirm with the user (ask only what's missing):

- **Topic / source** — a subject, a rough outline, or a URL to summarize.
- **Platform** — `linkedin` (default), `instagram`, `x`, or `facebook`.
- **Style** — resolved per the section above.

### 2. Research and record sources

If the carousel makes any factual claim or cites a statistic, research it and
write `carousel-out/<topic-slug>/sources.md` — one entry per claim with the
source URL and the exact supporting quote or figure. Every number that lands
on a slide must trace to an entry here. This file is the input to the content
audit in step 6. Skip this step only for pure opinion / how-to carousels with
no factual claims.

### 3. Plan the slides

Read `references/design-rules.md` for the structural framework, then follow
the slide structure the resolved style dictates (an agency spec may define its
own — e.g. ROSCODE's hook → setup → 4 findings → take → CTA). One idea per
slide; respect the platform's max-slide limit. **If the carousel cites
sources, the final slide is a dedicated Sources slide** listing the references
— readers must be able to see where the claims came from.

### 4. Author the HTML

Create a working directory `carousel-out/<topic-slug>/slides/`, then write one
`slide-NN.html` per slide (zero-padded — the renderer orders them by name).

**Agency style spec path:**
- If `<agency>/brand/carousel.css` + `carousel-template.html` exist, copy
  `carousel.css` into the `slides/` dir and write lean slide files that
  `<link rel="stylesheet" href="./carousel.css">` + one `.slide` block from
  the template's layout variants.
- If only the prose `carousel-style.md` exists, **compile it first**: generate
  `<agency>/brand/carousel.css` + `carousel-template.html` from the spec, then
  proceed as above.

**Generic theme path:**
- Copy `templates/<theme>.html` per slide; keep the `:root` brand variables
  identical across every slide.

Either way: set the layout class per slide, fill content, cap ~30–40 words per
slide, swipe cue on slide 1, CTA and Sources on the final slides, consistent
page indicator.

### 5. Render and auto-validate

```bash
python ".claude/skills/carousel/scripts/render_carousel.py" \
  --slides "carousel-out/<topic-slug>/slides" \
  --out    "carousel-out/<topic-slug>/out" \
  --platform linkedin
```

Options: `--aspect` (`1:1` | `4:5` | `16:9`); `--scale` (default `2`);
`--strict` (treat low-contrast warnings as blocking).
Output is `slide-01.png`, `slide-02.png`, … in `--out`.

Every render is **layout-audited** — each slide is checked for clipped text,
text running off the slide, overlapping text, and low-contrast text. The
command exits non-zero when a blocking **error** is found (the carousel is
**not finalised**): fix the flagged slide HTML/CSS — shrink the font, wrap or
shorten the text, reposition the element, raise the contrast — and re-render
until it passes. **Warnings** (text below WCAG AA but legible — often a brand
accent colour) do not block; review them and fix genuine readability problems.
See `references/validation-checklist.md`. Do not deliver with
`--skip-validation`.

### 6. Validate content — claims and sources

Once the layout audit passes, verify the carousel is truthful. Dispatch a
fresh-context subagent with the slide HTML text and
`carousel-out/<topic-slug>/sources.md`, following
`references/validation-checklist.md`: every factual claim must match a cited
source, no statistic may be unsourced, and the Sources slide must be present.
Fix any flagged claim before delivering.

### 7. Report

List the rendered PNG paths and slide count, and confirm both audits passed.
The set is ready to upload (LinkedIn: document/carousel; Instagram:
multi-image post).

## Renderer fallback

If Playwright is unavailable, render with the **agent-browser** skill: open
each `slide-NN.html` at the platform's pixel dimensions and screenshot it
full-viewport. See `references/design-rules.md` for per-platform dimensions.
The agent-browser path skips the automatic layout audit — run
`scripts/validate_carousel.py --slides … --platform …` separately so the
carousel is still validated before delivery.

## Layout

```
scripts/render_carousel.py   Playwright renderer + auto layout audit (primary)
scripts/validate_carousel.py slide audit — clipping, overflow, overlap, contrast
scripts/platforms.py         platform dimensions / limits / aspects
templates/{default,bold,technical}.html   generic fallback themes
references/design-rules.md   7-slide framework, hierarchy, specs, mistakes
references/validation-checklist.md  layout + content validation checklist
tests/                       pytest suite — python -m pytest tests/
```

Agency styles live with the agency, not here:
`<agency>/brand/carousel-style.md` + `carousel.css` + `carousel-template.html`.

## Constraints

- Local rendering only. Never route slides through a paid cloud service.
- An agency `carousel-style.md` is the source of truth for that agency's
  carousel visuals — never copy agency brand data into this skill.
- One idea per slide; consistent style across the whole set.
- Stay within the platform's max-slide limit (the renderer enforces it).
- **Validate before finalising.** A carousel with a blocking audit error
  (clipped, off-slide, overlapping, or unreadable text) or an unsourced claim
  is not done. Never deliver with `--skip-validation`.
- Every factual claim must trace to a source; the final slide lists sources.
