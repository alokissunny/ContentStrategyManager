# Plan — server reel renders on Remotion Lambda

**Problem (2026-11-27).** When the studio's browser doesn't take a reel's
render, `igsignal-reel-worker` (Render standard, 1 CPU / 2 GB) renders it
itself: headless Chrome + Remotion in the same box as the AI pipeline. That is
~25 min for a 972-frame reel, and with more than one Chrome tab it runs out of
memory and Render restarts it. Most reels take this path today: nobody watching
(started from GenPill / Captures), phones, and every reel with explainer
drawings, motion, looks, overlays or annotations (`browserCanMatch`).

**Goal.** Only the frame render moves to AWS Lambda. It scales per render and
costs nothing when idle. Everything else stays as it is: the queue, the AI
steps, the browser hand-off, retries and resume. The reel worker becomes a
light orchestrator that can later move to a smaller plan.

This revisits the note in `REEL_RENDER_FARGATE.md` ("Revisit Lambda only for
the Remotion step if renders get slow"). The renders are now slow. Fargate
would still be the way to move the *whole* worker off Render. The two plans
work together.

```
studio ─► API ─► Redis "capture-reel" ─► reel worker (Render)
                                           load material → direct → voice/music → design
                                           render step:
                                             1. studio browser (watching + eligible)   unchanged
                                             2. Remotion Lambda  ◄── NEW (default server path)
                                                  renderMediaOnLambda → N Lambdas render frame
                                                  chunks in parallel → stitched MP4 in S3
                                             3. local Chrome (1 tab)                    last resort
                                           finish: MP4 → S3, poster, calendar           unchanged
```

---

## What the code has today (read 2026-11-27)

| Piece | Where | Lambda impact |
|---|---|---|
| Render call | `captureReelAgent.js` `renderReel()` spawns `node render.mjs <spec.json> <out.mp4>`, parses `[render] N%` from stderr for progress + the stall watchdog | Keep the contract: a new `render-lambda.mjs` with the **same args and the same stderr lines**, so `renderReel` only picks the script |
| Media in the timeline | scene `src`, `beforeSrc`, `voiceSrc`, `musicSrc`, `motion.media` are CDN URLs (`getMediaUrl`) or presigned URLs. `refreshTimelineUrls` re-signs them before a re-render | Lambda fetches them over the network, so no change. `_src` keys are stripped before the render |
| Bundle | `render.mjs cachedBundle()` webpack bundle keyed by a hash of `src/`, `package-lock.json`, `public/sfx`. Built at deploy by `scripts/setup-remotion.js` (`--bundle-only`) | Replace with `deploySite()` to S3 under **siteName = that same hash**, so the serve URL always matches the deployed code |
| Sound effects | `public/sfx` via `staticFile()` | Uploaded with the site (`publicDir`) |
| Fonts | `@remotion/google-fonts` (gstatic) + Brand Kit fonts via `brandFonts.ts` `new FontFace(url)` | Google fonts: fine. **Brand Kit fonts are a cross-origin fetch from the S3-hosted site → need CloudFront CORS** (same dependency as the browser render, `CLOUDFRONT_CDN.md`) |
| GL | `glBackend()`: `swiftshader` for CaptureReel, `swangle` otherwise | Lambda default is `swangle`. Check visual parity in the spike, and pass `chromiumOptions.gl` if swiftshader is supported there |
| Quality | `crf 21`, `jpegQuality 92`, `x264Preset veryfast` | Same options exist on `renderMediaOnLambda` |
| Motion grain | `render.mjs addGrain()`: ffmpeg pass after the render for motion reels | Run it in `render-lambda.mjs` after downloading the MP4 (ffmpeg-static is already in the workspace) |
| Poster, upload | `captureReelAgent.js` after the render, from the local `tmp` MP4 | Unchanged in v1 (the MP4 is downloaded to `tmp`) |
| Other caller | `carouselCoverAgent.js` spawns `render.mjs` for AnimatedCover | Out of scope for v1; it can use the same script later |
| Memory spike in the worker | `clipFile()` (`captureReelAgent.js:938`) buffers whole clips via `getObjectBytes` | Stream to disk (Phase 4). This matters once the box is downsized |

---

## Phase 0 — spike (½–1 day, no prod change)

1. Add `@remotion/lambda@4.0.523` (same version as the other Remotion packages)
   to `backend/remotion/package.json`.
2. AWS (in the **S3 bucket's region**, `AWS_REGION`): create the Remotion IAM
   user and role (`npx remotion lambda policies user|role`), then deploy one
   function:
   `npx remotion lambda functions deploy --memory=3008 --disk=2048 --timeout=240`.
3. `npx remotion lambda sites create src/index.ts --site-name=spike`.
4. Render 3 real saved timelines (from `CaptureReel.timeline`): a voiceover reel
   with video clips, a photo reel with explainer drawings, and a motion reel.
   Use `framesPerLambda` 60–120.
5. Compare with a local render of the same timeline. Check:
   - **Look:** frames side by side, especially SVG explainers, Brand Kit fonts
     and caption shadows (swangle vs swiftshader).
   - **Sound:** loudness (−16.8 LUFS target), voice/music sync, sound effects.
   - **Time and cost:** wall time, and `costs.accruedSoFar` from
     `getRenderProgress`.
6. Check the AWS account's Lambda concurrency quota (new accounts can be as low
   as 10). Request ≥ 200 if needed.
7. Check the Remotion company licence terms for cloud renders (remotion.pro).

**Go / no-go:** pixel and audio parity on all 3 reels, under 2 min wall time,
cost per reel in cents.

### Phase 0 results (2026-11-27, eu-north-1)

Setup: IAM role `remotion-lambda-role` + user `remotion-renderer` (policies in
`remotion-lambda/`), `policies validate` all green, concurrency quota **400**.
Function `remotion-render-4-0-523-mem3008mb-disk2048mb-240sec`, site
`reel-85d8c3037532872d` (bundle hash), bucket `remotionlambda-eunorth1-t9oubcpxee`.
Script: `backend/remotion/spike-lambda.mjs`.

| Reel | Local (Mac, 8 tabs) | Lambda | Cost | Parity vs local |
|---|---|---|---|---|
| Explainer (763 fr) | 32 s | **21.5 s** render + 7.5 s download, 39 Lambdas | $0.016 | SSIM 0.989, PSNR 40 dB avg; frames look identical; −16.8 LUFS both |
| Motion (565 fr) | 13 s + 4 s grain | **66 s**, 29 Lambdas | $0.024 | SSIM 0.971 (local has grain, Lambda copy doesn't yet); −15.0 LUFS both |
| Voiceover + clips (556 fr) | 14 s | failed: 403 on a clip | — | not a Lambda issue, see below |

Findings:

1. **4K HEVC originals break Lambda.** The explainer's clip is a 64 MB
   3840×2160 HEVC `.mov`. Every chunk downloads it and decodes it in software:
   the first run timed out at 240 s, and a run with 200 frames per Lambda failed
   with "Failed to fetch …/proxy" (disk or time). With a **1080p H.264 proxy**
   (19.5 MB, 6.5 s ffmpeg on a Mac) it rendered in 21.5 s. → Phase 1 must make a
   render proxy per clip (longest side 1920, H.264, `-g 24`, faststart), stored
   next to the original and used in the timeline. This also speeds up the browser
   and local renders, which read the same 4K files today.
2. **Deleted sources are only alive in CloudFront's cache.** The voiceover reel's
   clip `e0a4cf95….mp4` is a 404 in S3 but still a cache hit at the Delhi edge, so a
   local render works while Lambda (Stockholm edge, cache miss) gets an S3 403. The
   same reel would fail at any edge without the cache. Find what deletes clips that
   saved reels still reference. Not a Lambda blocker.
3. Motion reels: the grain pass (`addGrain`) has to run after the download in
   `render-lambda.mjs`, as planned. Motion was the slowest at 66 s: tune
   `framesPerLambda` there.
4. Fonts (Google + the reel's own fonts) and the SVG explainer drawing render the
   same under Lambda's default GL (swangle). No `chromiumOptions.gl` needed.
5. Still open: the Remotion company licence for cloud renders, and the zod
   version warning (zod 3.23.8 installed, Remotion wants 4.5.4; renders still
   worked).

**Verdict: go**, with the clip proxy added to Phase 1.

---

## Phase 1 + 2 — built 2026-11-27

| Piece | Where |
|---|---|
| Lambda renderer, same CLI + stderr as render.mjs, `[render:cost] $ · N lambdas`, exit 3 = Lambda not usable, grain pass after download, `deleteAfter: 1-day` | `remotion/render-lambda.mjs` |
| Shared bundle cache + grain pass | `remotion/render-shared.mjs` (moved out of render.mjs) |
| Site `reel-<bundle hash>` uploaded at build, last 3 kept (`--deploy-site`); also uploaded by the first render if missing | `scripts/setup-remotion.js`, `render-lambda.mjs site()` |
| 1080p H.264 clip copies `<name>.r1080.mp4` (HDR tone mapped, made once per clip, srcW/srcH follow) | `src/services/reelRenderProxy.js` |
| Switch + per-user rollout + one local fallback + ledger row | `captureReelAgent.js renderOnServer()` — `REEL_RENDER_BACKEND`, `REEL_LAMBDA_USERS` |
| Manual test (no DB writes) | `REEL_RENDER_BACKEND=lambda node scripts/test-reel-lambda.js <spec.json\|reelId> <out.mp4>` |

Measured end to end on the explainer reel: clip copy 42.5 s (once; Mac), Lambda 26 s / $0.016 /
39 Lambdas, SSIM 0.989 vs local. Fallback checked with a bad function name → rendered locally.

## Phases 3 + 4 — done 2026-11-27 (on for everyone)

- `render.yaml`: `REEL_RENDER_BACKEND=lambda` for all accounts (no `REEL_LAMBDA_USERS`), and
  `CAPTURE_REEL_CONCURRENCY=3`. **The worker needs `REMOTION_AWS_ACCESS_KEY_ID` /
  `REMOTION_AWS_SECRET_ACCESS_KEY` set in the Render dashboard.** Without them every reel falls back
  to the local render (exit 3), so it's slower but nothing breaks. Kill switch:
  `REEL_RENDER_BACKEND=local`.
- Clip copies start as soon as the reel worker knows the clips (`warmClipCopies` right after
  `loadMaterial`), so the encode overlaps the AI steps. At most 2 encodes per process,
  `-threads 2`. Not done at upload: the API box (512 MB) is too small for a 4K encode, and
  only reels need the copies.
- `clipFile()` streams clips to disk (no whole-clip Buffer).
- One local Chrome render per process at a time (`localRenderSlot`): the fallback can't stack
  two Chromes on 2 GB however many reels run.
- Per reel the worker logs `[reelWorkers] reel <id> · peak rss N MB · K other reel(s) running`. Check
  it before raising concurrency or downsizing the box.

## Remotion licence (checked 2026-11-27, remotion.dev/docs/license)

- Free only for individuals and companies of **up to 3 people** (total headcount). Otherwise a
  Company Licence is needed.
- Automated renders (renderMediaOnLambda, renderMedia, **and renderMediaOnWeb**, the browser
  render) fall under "Remotion for Automators": **$0.01 per render, minimum $100/month**.
  Stills don't count.
- `licenseKey` reports usage. It's voluntary before Remotion 5.0 and mandatory for Automators
  from 5.0. `render-lambda.mjs` passes `REMOTION_LICENSE_KEY` when it's set (worker env,
  `sync: false`).
- The browser render (`@remotion/web-renderer`) always sends telemetry (domain + IP). Remotion
  says it contacts domains that aren't licensed. Confirm with hi@remotion.dev whether those renders
  count as Automators renders.

## Phase 1 — `render-lambda.mjs` + switch (original plan)

`backend/remotion/render-lambda.mjs` (ESM, inside the Remotion workspace like
`render.mjs`; the backend never imports Remotion):

- Same CLI: `node render-lambda.mjs <spec.json> <out.mp4>`.
- `serveUrl` = the site for the current bundle hash (Phase 2). Function name =
  `getFunctions({ region, compatibleOnly: true })[0]`, so it follows the
  Remotion version.
- `renderMediaOnLambda({ composition, inputProps, codec: 'h264', crf, jpegQuality,
  x264Preset, chromiumOptions: { gl }, framesPerLambda, privacy: 'private',
  downloadBehavior, maxRetries: 1 })`. Large `inputProps` are put in S3 by
  Remotion automatically.
- Poll `getRenderProgress` every 2 s and print `[render] N%` every 5 % on stderr
  (the existing watchdog and the `renderPct` bar keep working). On
  `fatalErrorEncountered`, exit non-zero with the error tail.
- Download the output to `<out.mp4>` (stream). Motion reels: `addGrain`. Print
  `[render:timing] … render Xms` and `[render:cost] $Y` for the ledger.

`captureReelAgent.js renderReel()`:

- `REEL_RENDER_BACKEND = lambda | local` (default `local` until rollout).
  `lambda` → spawn `render-lambda.mjs`.
- Lambda failure (not a user-facing error) → **one local fallback render** at
  1 tab, so a Lambda outage only makes reels slower, not broken.
- Parse `[render:cost]` into the ledger (`Capture reel — Lambda render`), so
  the debug panel and backoffice cost show it.
- Stall window: Lambda reports often, so the 4-min `REEL_RENDER_STALL_MS` stays.

Config (worker env, `render.yaml`):

| Key | Value |
|---|---|
| `REEL_RENDER_BACKEND` | `lambda` |
| `REMOTION_AWS_REGION` | the bucket's region |
| `REMOTION_AWS_ACCESS_KEY_ID` / `REMOTION_AWS_SECRET_ACCESS_KEY` | the Remotion IAM user (render-only policy), `sync: false` |
| `REEL_LAMBDA_FRAMES_PER_LAMBDA` | from the spike (e.g. 80) |

---

## Phase 2 — site deploy at build (½ day)

In `scripts/setup-remotion.js`, when `REEL_RENDER_BACKEND=lambda`, after
`--bundle-only` run `node render-lambda.mjs --deploy-site`. That calls
`deploySite({ entryPoint, siteName: <bundle hash>, options: { publicDir } })`.
It is idempotent: an unchanged hash means no upload. Old sites are deleted
after N deploys (`getSites` + `deleteSite`, keep the last 3 so a render still
running on the previous deploy doesn't break).

The function itself is deployed by hand once per Remotion upgrade (documented
here). Its name includes the version, so `compatibleOnly` picks the right one.

---

## Phase 3 — rollout (½ day + watching)

1. Turn it on for admin reels first (`REEL_RENDER_BACKEND=lambda` plus a
   user-allow-list env, or the AI debug flag).
2. Compare the first ~20 reels: failures, wall time, cost, and studio reports on
   look and sound.
3. Turn it on for everyone. Kill switch: `REEL_RENDER_BACKEND=local`. The
   browser render stays first. Lambda only replaces the local Chrome.

---

## Phase 4 — slim the worker (1 day)

- `clipFile()`: stream to disk (`getObjectStream` + `pipeline`) instead of
  `getObjectBytes`.
- Log the peak RSS per reel (`process.memoryUsage().rss` sampled per stage),
  then pick the plan: likely Render **starter/standard without Chrome**. Keep
  local Chrome installed only if the fallback is still wanted.
- Raise `CAPTURE_REEL_CONCURRENCY` (the AI steps are mostly waiting on APIs) or
  `numInstances`. Several reels then run at once, each rendering on its own
  Lambdas.
- Later: `carouselCoverAgent.js` on the same script, and the Fargate plan if the
  orchestrator itself needs to scale with the queue.

---

## Risks

| Risk | Mitigation |
|---|---|
| Look differs (swangle vs swiftshader, SVG, fonts) | Phase 0 parity check per reel type. Per-type fallback to local if one type differs |
| Brand Kit fonts blocked by CORS | CloudFront CORS policy (already needed for the browser render) |
| Lambda concurrency quota | Request the increase in Phase 0. Tune `framesPerLambda` (fewer, longer chunks) |
| Presigned media URLs expire mid-render | Renders take minutes, and `refreshTimelineUrls` re-signs before a re-render. With the CDN configured, URLs don't expire |
| Remotion licence cost | Check before Phase 1 |
| Lambda outage / AWS error | One local fallback render per reel (Phase 1) |
| Cost runaway | `[render:cost]` in the ledger. Alert if the daily total is above a threshold |

## Estimate

Spike ½–1 day · build 2–3 days · rollout ½ day · worker slimming 1 day.
