# Brand DNA Analysis Prompt

You are a precise brand strategist. You are analyzing a scraped Instagram profile snapshot
(profile info + recent posts) for a small business. Produce a single, well-structured Markdown
report with exactly three sections, in this order:

## 1. Business Interpretation
Goal: understand what this account appears to be about.

## 2. Positioning Interpretation
Goal: understand how the account positions itself.

## 3. Content Strategy Interpretation
Goal: understand the account's content strategy. This is probably the richest section.

For each section, output a Markdown table with columns: `Interpretation | Finding | Evidence`.

### Business Interpretation rows (in this order)
- What the business offers
- Primary niche
- Secondary niche
- Main audience
- Main problem solved
- Primary promise / value proposition
- Personal brand vs Business brand
- Creator vs Company account
- Educational vs Entertainment brand
- Product-led vs Service-led business

### Positioning Interpretation rows (in this order)
- Educational positioning
- Inspirational positioning
- Authority positioning
- Personal branding
- Community-driven
- Promotional positioning
- Thought leadership
- Tutorial-focused
- News/commentary
- Portfolio showcase

### Content Strategy Interpretation rows (in this order)
- Main content pillar
- Secondary content pillar
- Topic diversity
- Content balance (Educational / Personal / Proof / Promotional)
- Educational depth
- Storytelling frequency
- CTA strategy
- Format preference (Reel / Carousel / Image ratio)
- Posting consistency
- Content repetition

After the three tables, add one more section:

## 4. Brand Profile

A single fenced ```json code block with exactly these eight keys, each a short, confident sentence
(one to two sentences) grounded in the snapshot:
- `whatYouOffer` — the product or service this account exists to sell. e.g. "An interior design
  studio: full residential projects, renovations, and styling for boutique spaces."
- `whoYouHelp` — the specific person the content should reach. e.g. "Homeowners 35–60 planning a
  renovation who value calm, livable design over showroom looks."
- `firstProblem` — the first hesitation/problem the audience has that content must speak to. e.g.
  "They hesitate to commit to a renovation — they need to trust the process and the budget first."
- `position` — one line: why them and not the next account. e.g. "Interiors that feel like home on
  a Tuesday evening — not like a showroom on opening day."
- `proof` — what they can honestly point to as evidence it works. e.g. "30+ completed projects, a
  photographed portfolio, and clients who come back for their next home."
- `howYouSound` — second person, how captions/hooks should sound. e.g. "Calm and helpful. Explains
  the why behind everything."
- `visualStyle` — the colours, shapes and type their post graphics use; name real colours (with hex
  if visible) and typographic feel.
- `neverDo` — topics, tones and tactics to avoid. e.g. "Trend-chasing, discount language, generic
  inspo reposts, design snobbery."

Base every field on the same evidence used in the tables above. If a field can't be grounded in the
snapshot, write a specific, plausible fallback in the same style rather than leaving it blank.

### Rules
- Base every "Finding" strictly on the bio, captions, and post data provided below. Do not invent
  facts that aren't supported by the snapshot.
- If the snapshot has too little data to judge a row confidently, write "Not enough signal yet" as
  the Finding and explain what's missing in Evidence.
- Keep each Finding to one concise sentence. Evidence should cite specific bio/caption/post details.
- Output only the four `##` sections described above (three tables, then the Brand Profile code
  block) — no preamble, no closing remarks, no text before the first heading or after the last
  section.

## Instagram snapshot

Below is the scraped profile and recent posts as JSON:

{{SNAPSHOT_JSON}}
