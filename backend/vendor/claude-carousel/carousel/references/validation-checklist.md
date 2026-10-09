# Carousel Validation Checklist

Every carousel passes two validators before delivery. A carousel that fails
either is not finished - fix and re-check.

## 1. Layout audit - automatic, mechanical

`scripts/render_carousel.py` runs this on every render (via
`scripts/validate_carousel.py`). Issues have two severities.

**Errors - block the carousel. The render command exits non-zero.**

| Check         | What it catches                                          |
|---------------|----------------------------------------------------------|
| Clipped       | Text cut off by an `overflow:hidden` box                 |
| Out-of-bounds | A text element runs off the edge of the slide            |
| Overlap       | Two text elements drawn on top of each other             |
| Low contrast  | (severe) Text vanishes into its background - too close   |
|               | in colour to read over a large part of its area          |

**Warnings - advisory. Reviewed, not auto-blocking.**

Text below the WCAG AA contrast target but still legible (often a brand
accent colour). Review every warning: fix genuine readability problems
(small text, text over busy photos); a brand-intentional muted accent may be
accepted. `--strict` promotes warnings to blocking errors.

When the audit fails: read the report, fix the slide HTML/CSS (shrink the
font, wrap or shorten the text, reposition the element, raise the contrast or
add a scrim behind text-on-photo), then re-render. Never deliver with
`--skip-validation`.

The contrast check samples the *actual rendered pixels* behind each text
element, so it works over photographs and gradients, not just solid colours.

## 2. Content audit - claims and sources

After the layout audit passes, verify the carousel is truthful and sourced.
Give a fresh-context subagent the slide HTML text and
`carousel-out/<slug>/sources.md`, and have it confirm:

- [ ] **Every factual claim or statistic on a slide is supported by a cited
      source** in `sources.md` - the slide text matches what the source says
      (no inflated numbers, no claim the source does not make).
- [ ] **No unsourced statistic.** A number with no source is a failure.
- [ ] **The carousel shows its sources.** The final slide is a dedicated
      Sources slide listing the references used.
- [ ] Claims keep the source's scope and qualifiers (dates, regions,
      "reported", "estimated" - do not strip hedges).

Scope: this checks fidelity to the cited sources, not whether the sources
themselves are correct. Pick reputable sources at research time.

Return a PASS / FAIL verdict naming the slide and claim for any failure. Fix
flagged claims (correct the text, add the missing source, or drop the claim)
before delivering.
