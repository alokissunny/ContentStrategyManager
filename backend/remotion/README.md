# Animated Carousel Cover Agent

Generates a **viral animated hook video** — the first frame of an Instagram carousel —
from the plan pipeline's Strategist + Content Structure output, and renders it to MP4 with
Remotion.

```
Strategist brief ─┐
                  ├─▶ Cover Agent (LLM) ─▶ cover spec (JSON) ─▶ Remotion ─▶ hook.mp4
Content structure ┘        plan-carousel-cover.md              AnimatedCover
```

## Pieces

| Piece | Path |
| --- | --- |
| Agent prompt | [`prompts/plan-carousel-cover.md`](../prompts/plan-carousel-cover.md) |
| Standalone module | [`src/services/carouselCoverAgent.js`](../src/services/carouselCoverAgent.js) |
| Model routing (`cover` kind) | [`src/services/planAgentLlm.js`](../src/services/planAgentLlm.js) |
| Remotion composition | `remotion/src/AnimatedCover.tsx` |
| Spec schema (contract) | `remotion/src/schema.ts` |
| Line-art primitives | `remotion/src/primitives.tsx` |
| Render entry (shell-out) | `remotion/render.mjs` |
| Test harness | [`scripts/test-carousel-cover.js`](../scripts/test-carousel-cover.js) |

The agent never emits code or SVG — it emits a bounded, validated **cover spec** (see
`schema.ts`). `AnimatedCover` is fixed, hand-written React that animates any valid spec
deterministically from `useCurrentFrame()`, so nothing the LLM produces can inject markup.

## Setup

```bash
cd backend/remotion && npm install     # one-time: Remotion + renderer (~260 pkgs)
```

The first render also downloads Remotion's headless Chromium automatically.

## Run

```bash
# render the built-in reference spec (no LLM, no API key) — proves the renderer
cd backend && node scripts/test-carousel-cover.js

# brief + structure → LLM cover spec → MP4  (needs OPENAI/ANTHROPIC key in .env)
node scripts/test-carousel-cover.js --llm

# LLM spec only, printed as JSON, no render
node scripts/test-carousel-cover.js --spec-only
```

Output MP4s land in `backend/remotion/out/`.

Design the spec visually in the Remotion Studio:

```bash
cd backend/remotion && npm run studio
```

## Programmatic use

```js
const { runCarouselCoverAgent, generateCoverSpec, renderCoverVideo }
  = require('./src/services/carouselCoverAgent');

// one-shot: brief + structure → MP4
const { spec, videoPath } = await runCarouselCoverAgent({ brief, structure, brand });

// or split the two steps
const { spec } = await generateCoverSpec({ brief, structure, brand });
const mp4 = await renderCoverVideo({ spec, outPath: '/tmp/hook.mp4' });
```

`brief` is a Strategist brief (see `coverBriefPayload` for the fields used); `structure`
is a Content Structure result (its first `slidesOrScenes` entry is the cover surface).

## Model

`cover` routes through `resolvePlanAgentLlm('cover')` like every other plan agent.
Override per environment:

```
PLAN_COVER_MODEL=gpt-5.6-terra      # or claude-sonnet-5, etc.
PLAN_COVER_PROVIDER=openai
```

## Wiring into the plan pipeline (next pass)

This module is intentionally standalone. To run it per post inside
`planOrchestrator.runMultiAgentPlan`, add an `attachCover(...)` step alongside
`attachLayout` / `attachGeneratedVisuals` in `finishDay()`: call `generateCoverSpec` with
the day's `brief` + `structure`, render (or defer render to a job/worker so the plan
response stays fast), upload the MP4 to S3, and stash `{ spec, videoKey }` under
`agentTrace.cover` so the frontend can show/play it. Rendering is CPU-heavy (headless
Chromium), so prefer a background job over inline rendering in the request path.
