# Bauhly Content Generator

Multi-agent Instagram content generation. You give it a **high-level strategy** and
a folder of **photos and/or videos**; a team of AI agents interprets the strategy,
edits your assets, and produces ready-to-review **posts, carousels, reel covers,
and edited short-form videos** — each with a caption and hashtags — plus an HTML preview.

- **Photos** → post / carousel / reel-cover images (crop, colour grade, text overlays).
- **Videos** → a Video Director agent "watches" each clip, then trims, crops to 9:16,
  speed-ramps, and burns in timed captions to build a viral short — driven by your strategy.
  Upload several and each gets its own edit (up to `MAX_VIDEOS`, default 12); photos and
  videos in the same folder are all processed in one run.

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
  │ 2. Asset Planner Agent  (sees the photos)     │  brief + uploads → gaps →
  │    finds shots the strategy needs but the      │  text-to-image prompts;
  │    uploads lack → generates new photos         │  new photos join the pool
  ├──────────────────────────────────────────────┤
  │ 3. Creative Director Agent  (sees the photos) │  brief + assets → per-piece plan:
  │    which asset (uploaded OR generated), crop,  │  which photo, how to edit it,
  │    colour grade, overlay text, per format      │  what text to bake on
  ├──────────────────────────────────────────────┤
  │ 4. Hook Agent                                 │  writes the viral on-screen
  │    one scroll-stopping hook per piece →         │  HOOK, baked onto the hero
  │    baked onto the image / opening of the video │  image / video opening
  ├──────────────────────────────────────────────┤
  │ 5. Copywriter Agent                           │  brief + plan → captions:
  │    hook, body, CTA, hashtags per piece         │  hook / body / CTA / hashtags
  ├──────────────────────────────────────────────┤
  │ 6. QA Agent                                   │  audits every piece vs the
  │    scores each piece vs strategy, then         │  strategy → pass / edit
  │    EDITS the copy/overlays or REGENERATES      │  (rewrite) / regenerate
  │    the piece (before rendering)                │
  ├──────────────────────────────────────────────┤
  │ 7. Editor  (deterministic, sharp / ffmpeg)    │  executes the approved plan;
  │    crop to IG ratios, grade, text overlays,    │  video gets crossfade
  │    video crossfades + animated hook            │  transitions + hook fade
  └──────────────────────────────────────────────┘
                │
                ▼
   output/  → edited images + index.html preview + content-plan.json
```

The Strategy Agent also picks a brand-appropriate **caption style** — font family
(modern-sans / bold-impact / elegant-serif / editorial-serif / clean-rounded), weight,
case, text colour, and background treatment (scrim / box / outline). Both the image and
video renderers apply it, with a contrast outline baked in so captions stay legible over
any footage. See `src/captionStyle.ts` for the font registry.

Agents 1–6 run on the **Anthropic API** (Claude, with vision for the asset planner,
creative director and video director so they can actually see your assets; the QA
agent reviews the planned content and copy against your strategy and edits or
regenerates before anything is rendered). The Editor is deterministic image/video
processing with [`sharp`](https://sharp.pixelplumbing.com/) and
[ffmpeg](https://ffmpeg.org/), driven by the approved plan — so the same plan
always renders the same pixels. In video, segments are joined with **crossfade
transitions** and the hook and captions **fade in/out**.

### Generating new photos

When the uploads don't cover the strategy, the **Asset Planner** writes text-to-image
prompts and the **Asset Generator** creates the photos, which then flow to the
Creative Director like any uploaded asset. The generator is pluggable:

- **Real photos** — set `OPENAI_API_KEY` (uses an OpenAI-compatible `/images/generations`
  endpoint; override with `IMAGE_PROVIDER=openai`, `IMAGE_MODEL`, `OPENAI_BASE_URL`).
- **Branded placeholders** — the default when no image API is configured, so the pipeline
  always runs. Generated photos are tagged as such and listed in `content-plan.json`
  (`generatedAssets`) and the UI.

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

**Quality:** editing is tuned to preserve the source. Images are graded, composited and
encoded in a **single pass** (no lossy JPEG round-trip) at quality 95 / 4:4:4 / mozjpeg
with Lanczos scaling. Video encodes use **H.264 CRF 18** (visually lossless), a `medium`
preset, Lanczos scaling and 192 kbps AAC. Segments are concatenated with stream-copy where
possible so only genuinely-filtered passes re-encode.

Frame understanding uses Claude vision; cutting/cropping/overlays use
[ffmpeg](https://ffmpeg.org/) (bundled via `ffmpeg-static`, or your system ffmpeg).
Overlays are de-duplicated against the hook and forced to play sequentially so two
captions never collide.

## Web UI (upload → strategy → generate → download)

```bash
cd Bauhly-content-generator
npm install
npm run serve
# open http://localhost:5178
```

Upload photos and/or a video, write your strategy, tick the content types
(post / carousel / reel / video edit — the video option unlocks when a video is
added), and hit **Generate**. Each result shows inline with a **Download** button
and a copyable caption; each run is also saved under `runs/<id>/` with a full
`index.html` preview. Set `PORT` to change the port.

Every AI run reports its **token usage and estimated cost** (e.g. `7,193 tokens ·
~$0.0511`) in the UI, the CLI summary, and `content-plan.json` (`usage` field).
Cost is an estimate from the model's list price (input/output, with cache
read/write factors); offline `mock` runs are free and show no cost.

## Quick start (CLI)

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

### Stitch everything into ONE video (montage)

The `montage` format combines **all** your clips **and** photos into a single vertical
video. A Montage Director agent watches every clip and lays out one story — short
segments from each video, photos as Ken Burns stills — joined with crossfade
transitions and a burned-in hook:

```bash
npm run generate -- --strategy "..." --assets ./mixed-media --formats montage
```

(In the web UI this is the “Montage (all into one)” option; `video` instead makes one
reel per clip.)

### Set the output length

Add `--duration <seconds>` (3–120) to pin how long the video/montage should be. The
director plans to that target and the renderer enforces it exactly (rescales the
segments, then hard-trims):

```bash
npm run generate -- --strategy "..." --assets ./clips --formats montage --duration 15
```

In the web UI, a **“Video length (seconds)”** box appears once a video/montage is in
play; leave it blank to let the agent choose.

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
web/
  index.html           the upload/generate/download web UI
src/
  index.ts             CLI entry
  server.ts            Express server for the web UI (upload → generate → serve)
  orchestrator.ts      wires agents → editor, handles offline fallback
  anthropic.ts         Claude client + structured-JSON helper
  agents/
    strategyAgent.ts   prose → brand brief
    assetPlanner.ts    uploads vs strategy → prompts for missing photos (vision)
    creativeDirector.ts brief + photos → per-piece editing plan (vision)
    videoDirector.ts   brief + sampled video frames → video edit plan (vision)
    montageDirector.ts many clips + photos → one stitched montage plan (vision)
    hookAgent.ts       one viral on-screen hook per piece
    copywriter.ts      brief + plan → captions
    qaAgent.ts         audits pieces vs strategy → pass / edit / regenerate
  imageEditor.ts       sharp: crop, grade, text overlays
  assetgen/
    generate.ts        pluggable photo generator (image API or placeholder)
  video/
    ffmpeg.ts          ffmpeg binary resolution + runner
    probe.ts           duration / dimensions / fps / audio
    frames.ts          sample frames for the Director to "watch"
    editor.ts          trim → crop → crossfade → burn overlays → MP4 + cover
    montage.ts         stitch many clips + photos into one video (Ken Burns + crossfades)
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
