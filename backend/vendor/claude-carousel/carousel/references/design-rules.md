# Carousel Design Rules

Reference for authoring high-engagement carousel posts. The framework is
adapted from the open-source `inferen-sh/skills` `social-media-carousel` skill;
all rendering here is local (Playwright), with no cloud dependency.

## Platform specs

| Platform  | Default size      | Aspects           | Max slides |
|-----------|-------------------|-------------------|------------|
| LinkedIn  | 1080 x 1350 (4:5) | 4:5, 1:1          | 20         |
| Instagram | 1080 x 1350 (4:5) | 4:5, 1:1, 16:9    | 20         |
| X / Twitter | 1080 x 1080 (1:1) | 1:1, 16:9       | 4          |
| Facebook  | 1080 x 1080 (1:1) | 1:1, 4:5          | 10         |

Width is always 1080px. Prefer **4:5 (1080 x 1350)** on LinkedIn and Instagram —
it claims more vertical feed space than square. Practical slide counts: 6–10.

## The 7-slide framework

| Slide | Role     | Content                                              |
|-------|----------|------------------------------------------------------|
| 1     | Hook     | Bold claim, question, or number+promise — stops the scroll |
| 2     | Context  | Why this matters; set up the problem                 |
| 3–6   | Value    | One point per slide, numbered                        |
| 7     | CTA      | Follow, save, share, comment, or visit a link        |

Scale to the topic: a 5-slide carousel is hook + 3 value + CTA. Never pad.

## Slide 1: the hook

The single most important slide. If it fails, nobody swipes.

| Hook type        | Example                                          |
|------------------|--------------------------------------------------|
| Bold claim       | "90% of landing pages make this mistake"         |
| Question         | "Why do your ads get clicks but no conversions?" |
| Number + promise | "7 Python tricks I wish I learned sooner"        |
| Contrarian       | "Stop writing blog posts (do this instead)"      |
| Before / after   | Show the transformation                          |

Always put a swipe cue on slide 1 ("Swipe →" or an arrow).

## Text hierarchy (at 1080px width)

| Element       | Size       | Weight        |
|---------------|------------|---------------|
| Slide number  | 96–150px   | Black (900)   |
| Heading       | 48–72px    | Bold (800–900)|
| Body text     | 24–30px    | Regular (400) |
| Caption / tag | 18–22px    | Medium (500)  |

## Readability

| Rule                | Value                              |
|---------------------|------------------------------------|
| Max words per slide | 30–40                              |
| Max body lines      | 4–5                                |
| Line height         | 1.5–1.6                            |
| Font                | Sans-serif (Inter, Montserrat, Poppins) |
| Text contrast       | 4.5:1 minimum (WCAG AA)            |

## Visual consistency — keep identical on every slide

Background palette · font family · text alignment · margins/padding ·
accent color · numbering format (`01, 02` or `1., 2.`). The theme templates
enforce this through shared `:root` brand variables — set them once, copy
unchanged to every slide.

## Why carousels work

- **Numbered progress** ("3 / 7") creates a completion drive.
- **Visual continuity** signals "there's more".
- **Increasing value** — save the best point for last; it rewards finishing.
- **Swipe cue** on slide 1 tells people there's more to see.

## Common mistakes

| Mistake                     | Fix                                          |
|-----------------------------|----------------------------------------------|
| Weak hook on slide 1        | Bold claim, question, or number + promise    |
| Too much text per slide     | Cap at 30–40 words                           |
| No visual consistency       | Same colors, fonts, margins throughout       |
| No swipe indicator          | Add "Swipe →" / arrow on slide 1             |
| No CTA on the last slide    | Ask to save, follow, share, or comment       |
| Inconsistent numbering      | Same format on every content slide           |
| 2+ ideas crammed per slide  | One point per slide, always                  |
| Square format on IG/LinkedIn| Use 1080 x 1350 (4:5) for more feed space    |
| Text cut off / off the edge | Validate every render (see below)            |
| Claims with no source shown | End with a dedicated Sources slide           |

## Sources slide

A carousel that states facts or statistics ends with a **dedicated Sources
slide** — the last slide, listing every reference used. Readers must be able
to see where the claims came from. Each on-slide number must trace to an entry
in `carousel-out/<slug>/sources.md`.

## Pre-publish validation

Every render is audited by `scripts/validate_carousel.py` for four defects:

- **Clipped** — text cut off by an `overflow:hidden` box.
- **Out-of-bounds** — a text element runs off the edge of the slide.
- **Overlap** — two text elements drawn on top of each other.
- **Low contrast** — text too close in colour to its real background.

Clipped / off-slide / overlap and *severe* low contrast (text vanishing into
its background) are **blocking errors**. Sub-AA-but-legible contrast is a
**warning**. Fix every error before finalising; review warnings for genuine
readability problems. See `validation-checklist.md` for the full checklist,
including the claims-and-sources content audit.
