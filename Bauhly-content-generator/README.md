# Bauhly Content Generator

Multi-agent Instagram content generation. You give it a **high-level strategy** and
a folder of **photos and/or videos**; a team of AI agents interprets the strategy,
edits your assets, and produces ready-to-review **posts, carousels, reel covers,
and edited short-form videos** — each with a caption and hashtags — plus an HTML preview.

- **Photos** → post / carousel / reel-cover images (crop, colour grade, text overlays).
- **Videos** → a Video Director agent "watches" your clip, then trims, crops to 9:16,
  speed-ramps, and burns in timed captions to build a viral short — driven by your strategy.

## How it works — the agents

```
  strategy (prose) + your photos
                │
                ▼
  ┌──────────────────────────────────────────────┐
  │ 1. Strategy Agent                             │  prose → structured brand brief
  │    audience, tone, pillars, hashtags,         │
  │    CTA, brand colour kit                       │
  ├──────────────────────────────────────────────┤
  │ 2. Creative Director Agent  (sees the photos) │  brief + assets → per-piece plan:
  │    which asset, crop, colour grade,            │  which photo, how to edit it,
  │    overlay text, per format                    │  what text to bake on
  ├──────────────────────────────────────────────┤
  │ 3. Copywriter Agent                           │  brief + plan → captions:
  │    hook, body, CTA, hashtags per piece         │  hook / body / CTA / hashtags
  ├──────────────────────────────────────────────┤
  │ 4. Editor  (deterministic, sharp)             │  executes the plan on pixels:
  │    crop to IG ratios, grade, text overlays     │  1080×1080 / 1080×1350 / 1080×1920
  └──────────────────────────────────────────────┘
                │
                ▼
   output/  → edited images + index.html preview + content-plan.json
```

Agents 1–3 run on the **Anthropic API** (Claude, with vision for the creative
director so it can actually see your photos). Agent 4 is deterministic image
processing with [`sharp`](https://sharp.pixelplumbing.com/), driven by the plan —
so the same plan always renders the same pixels.

### Video pipeline (when a video asset is present)

```
  uploaded video (mp4/mov/m4v/webm)
                │
                ▼
  ┌──────────────────────────────────────────────┐
  │ Video Director Agent  (Claude vision)         │  samples N frames (each
  │   watches sampled frames + probe metadata     │  timestamped) → an edit plan:
  │   → picks the best moments, order, speed,      │  segments to keep, per-clip
  │     9:16 crop, timed on-screen text, a hook    │  speed, overlays, hook
  ├──────────────────────────────────────────────┤
  │ Video Editor  (deterministic, ffmpeg)         │  trim → crop 1080×1920 →
  │   cut segments, normalise, concat, burn        │  concat → burn captions →
  │   overlays, export MP4 + cover frame           │  MP4 (H.264/AAC) + poster
  └──────────────────────────────────────────────┘
```

Frame understanding uses Claude vision; cutting/cropping/overlays use
[ffmpeg](https://ffmpeg.org/) (bundled via `ffmpeg-static`, or your system ffmpeg).
Overlays are de-duplicated against the hook and forced to play sequentially so two
captions never collide.

## Quick start

```bash
cd Bauhly-content-generator
npm install

# Zero-setup demo: generates sample photos, then a post + carousel + reel.
npm run demo
```

Open `output/index.html` in a browser to see the results.

### Use your own photos and strategy

```bash
npm run generate -- \
  --strategy "Grow a warm, minimal specialty-coffee brand for young urban professionals. Educational + aspirational. Drive footfall to our new store." \
  --assets ./my-photos \
  --formats post,carousel,reel
```

Or read the strategy from a file:

```bash
npm run generate -- --strategy-file ./strategy.txt --assets ./my-photos
```

### Edit a video into a viral short

Drop a video (`.mp4/.mov/.m4v/.webm`) into your assets folder. Formats are inferred
from what's in the folder, so this just works:

```bash
npm run generate -- \
  --strategy "Punchy launch teaser for FashDeck AI. Fast cuts, bold text, Gen-Z energy." \
  --assets ./my-clips
```

Or ask for it explicitly (and mix with image formats):

```bash
npm run generate -- --strategy "..." --assets ./mixed-media --formats video,carousel
```

Requires **ffmpeg** — it's bundled via the `ffmpeg-static` npm dependency, so no
install is needed on most platforms. To use a specific binary, set
`FFMPEG_PATH=/path/to/ffmpeg`. If ffmpeg can't be found, video is skipped with a
warning and the image formats still run.

### CLI options

| Flag | Description | Default |
|------|-------------|---------|
| `--strategy <text>` | High-level strategy prose | — |
| `--strategy-file <path>` | Read strategy from a text file | — |
| `--assets <dir>` | Folder of source photos (jpg/png/webp) and/or videos (mp4/mov/m4v/webm) | `./sample-assets` |
| `--formats <list>` | Comma list of `post,carousel,reel,video` | inferred from asset types |
| `--out <dir>` | Output folder | `./output` |

## Credentials

Set one of the following so the Claude agents can run:

- `export ANTHROPIC_API_KEY=...`, **or**
- run `ant auth login` (the SDK picks up the profile automatically).

**No credentials?** The generator automatically falls back to a deterministic
**offline pipeline** (`engine: mock` in the output) so you still get fully rendered
images and a preview — just without the AI-authored strategy and copy. Force it
anytime with `MOCK=1`.

Override the model with `MODEL=claude-opus-4-8` (default) — e.g. `MODEL=claude-sonnet-5`.

## Output

```
output/
  index.html          # visual preview gallery (open this)
  content-plan.json   # the full structured plan: brief, per-piece plans, captions
  images/
    1-post-slide-1.jpg
    2-carousel-slide-1.jpg
    3-video.mp4           # edited short-form video
    3-video-cover.jpg     # its poster/cover frame
    ...
```

## Project layout

```
src/
  index.ts             CLI entry
  orchestrator.ts      wires agents → editor, handles offline fallback
  anthropic.ts         Claude client + structured-JSON helper
  agents/
    strategyAgent.ts   prose → brand brief
    creativeDirector.ts brief + photos → per-piece editing plan (vision)
    videoDirector.ts   brief + sampled video frames → video edit plan (vision)
    copywriter.ts      brief + plan → captions
  imageEditor.ts       sharp: crop, grade, text overlays
  video/
    ffmpeg.ts          ffmpeg binary resolution + runner
    probe.ts           duration / dimensions / fps / audio
    frames.ts          sample frames for the Director to "watch"
    editor.ts          trim → crop → concat → burn overlays → MP4 + cover
  mock.ts              deterministic offline fallback
  preview.ts           HTML gallery
  assets.ts, config.ts, types.ts
scripts/
  make-sample-assets.ts  placeholder photos for the demo
```

## Roadmap

- Auto audio transcription (Whisper) so the Video Director can cut on speech + auto-caption.
- Beat-synced cuts and licensed background music selection.
- Per-slide asset upscaling / background removal.
- Direct scheduling/publish integration.
