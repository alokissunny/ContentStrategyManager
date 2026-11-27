# Plan — the reel worker on AWS Lambda (one Lambda per reel)

**Status:** plan, 2026-11-27. Builds on `REEL_RENDER_LAMBDA.md`, which is live: frames already
render on Remotion Lambda. This supersedes `REEL_RENDER_FARGATE.md` for the reel worker.

## Why

Production may start **~100 reels at once**. Today every reel runs on one Render box
(`igsignal-reel-worker`, 1 CPU / 2 GB, `CAPTURE_REEL_CONCURRENCY=3`):

- Measured on the last 40 reels (2026-11-27): median wait 1 s, median run 70 s, but **6 failed**
  because the box died, and one waited 3 h 15 min while it kept dying.
- 100 at once on that box means 3 running and 97 waiting: the last one starts after **~50 min**.
- One box dying (out of memory, a deploy) kills every reel on it. Each push to `deploy/render`
  restarts it.

With the render on Remotion Lambda, a reel takes **1–3 min of mostly waiting on AI APIs**. That fits
a Lambda function (15-min limit), one per reel, scaled by AWS, and costing nothing when idle.

## Target

```
studio ─► API (Render) ─► CaptureReel (Mongo, queued) ─► SQS "capture-reels" (message = { reelId })
                                                            │  event source mapping:
                                                            │  batch 1, max concurrency N (e.g. 100)
                                                            ▼
                               Lambda "reel-worker" (container image, 4 GB, 15 min, eu-north-1)
                               loadRuntimeSettings → runCaptureReel(reelId) — unchanged pipeline:
                                 load material → direct → voice / music → design passes
                                 clip copies (ffmpeg, /tmp) → Remotion Lambda render (render-lambda.mjs)
                                 finish: MP4 → S3, poster, calendar, push "reel ready"
                               fails / times out ─► SQS redelivers once (resumes from the saved cut)
                                                 ─► after 2 receives: DLQ ─► reel marked failed
```

- **One reel per invocation.** It gets its own 4 GB, and a crash only affects that reel.
- **SQS, not BullMQ, delivers reels.** Lambda reads SQS natively: retries, a dead-letter queue and
  a concurrency cap come for free, and the reel path no longer needs Redis.
- **The pipeline code doesn't change.** `runCaptureReel()` already resumes from a saved cut, counts
  attempts on the reel, and hands off to the studio's browser when one is watching.

## Code changes

| Piece | Change |
|---|---|
| `src/lambda/reelWorker.js` (new) | Handler: connect Mongo once per container (`maxPoolSize` 3), `loadRuntimeSettings()`, then for the one SQS record → `runCaptureReel(reelId)`. A thrown error → SQS retry; a user-facing failure is already written to the reel, so return normally. Stop cleanly before the 15-min limit (`context.getRemainingTimeInMillis()` → throw a retryable error with ~60 s left, so the retry resumes from the saved cut). |
| `reelQueue.js` | `REEL_RUNNER = lambda \| queue` (default `queue`). `lambda` → `enqueueCaptureReel` does `SQS SendMessage { reelId }` (delay → `DelaySeconds`, max 900 s). `reelJobAlive` → lease check (below). `reelQueueDepth` → SQS `ApproximateNumberOfMessages*`. BullMQ stays for local dev and as the kill switch. |
| Lease (liveness) | The running Lambda sets `CaptureReel.leaseUntil = now + 90 s` every 30 s (the BullMQ lock today). The sweeper treats `working` + expired lease + no SQS message in flight as lost → re-sends it (fresh) or fails it when out of tries. |
| `captureReelAgent.js` | `REEL_RENDER_TIMEOUT_MS` (45 min today) capped to the Lambda's remaining time. The local Chrome fallback is off in Lambda (`REEL_LOCAL_FALLBACK=0`): a failed Remotion render retries once with bigger chunks (`framesPerLambda` ×3) instead. |
| `render-lambda.mjs` / `render-shared.mjs` | The code folder is read-only in Lambda: bundle cache dir from `REMOTION_CACHE_DIR` (default `.bundle-cache`, Lambda: `/tmp`), with the bundle **baked into the image** at build time. The site marker goes there too. |
| `reelRenderProxy.js` | Unchanged. `/tmp` holds the original + the copy; set ephemeral storage to 4–10 GB. |
| DLQ handler (small Lambda) | Messages that failed twice → `CaptureReel` status `error` ("This reel could not be made — try again"), plus an alarm. |
| `reelSweeper.js` | Lambda mode: lease-based (above). It still runs in the API. |
| API on Render | New env: `REEL_RUNNER=lambda`, `REEL_SQS_URL`, AWS keys for an IAM user allowed only `sqs:SendMessage` / `GetQueueAttributes` on that queue. |

The browser hand-off is unchanged: the offer and claim live on the reel in Mongo. When the studio's
upload lands, the finishing run is just another SQS message.

## AWS resources (eu-north-1, next to S3 and the Remotion functions)

| Resource | Settings |
|---|---|
| ECR `bauhly-reel-worker` | Image from `backend/Dockerfile.reel-lambda`: `public.ecr.aws/lambda/nodejs:22`, `npm ci` (backend + `remotion/`: `@remotion/lambda`, `@remotion/bundler`), Linux `ffmpeg-static` and `sharp`, bundle built at image build, **no Chrome**. |
| Lambda `reel-worker` | Image above, **4096 MB**, ephemeral storage 4–10 GB, timeout **900 s**, reserved concurrency N (start 50, then 100), arm64 if sharp/ffmpeg builds allow (cheaper), else x86_64. |
| SQS `capture-reels` + `capture-reels-dlq` | Visibility timeout **960 s** (> function timeout), `maxReceiveCount` 2, retention 1 day. |
| Event source mapping | Batch size 1, `ScalingConfig.MaximumConcurrency` = N. |
| Secrets Manager `bauhly/reel-worker` | `MONGO_URI`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, VAPID/APNs keys, `REMOTION_LICENSE_KEY`. Read once per cold start. |
| IAM role | S3 read/write on the media bucket (`projects/*`); Remotion render permissions (invoke the render function, its bucket, as `role-policy.json` + the user policy); SQS receive/delete; Secrets read; CloudWatch Logs. **No static keys inside the Lambda.** |
| CloudWatch | Log group (14-day retention); alarms: DLQ > 0, errors > 5 %, throttles > 0, daily Remotion render cost. |

Infra as code: one CDK or Terraform stack in `backend/aws/reel-worker/`, so a second region or a
rebuild is one command. The first deploy can be done by hand from the console with the same names.

## Limits at 100 reels at once (and what to do)

| Limit | Now | Needed / action |
|---|---|---|
| **Lambda concurrency** (account, eu-north-1; shared by reel workers and Remotion render functions) | 400 | ~100 workers + renders. A render uses ~30–40 functions (auto chunking) → 3,000+. **Request 5,000**, and set `REEL_LAMBDA_FRAMES_PER_LAMBDA` ≈ 150 (≈ 5–8 render functions per reel → ~800 at peak). |
| **ElevenLabs** (cloned voices) | A few to ~15 at once, depending on the plan | A shared limiter (Mongo or Redis counter, wait and retry), or a higher plan. Without it, voice reels fail at bursts. |
| **Anthropic** (every reel agent is on Sonnet 5.5) | Account tier, tokens per minute | Check the tier; 100 directors at once with images is a large burst. Retries with backoff already exist in `llmComplete`. Ask for a raise if needed. |
| **OpenAI** (Whisper, TTS, clip vision) | Tier limits | Same check. |
| **Lyria music** | Already returns empty sometimes | Expect more at bursts; the reel already finishes without music. |
| **Mongo Atlas connections** | Pool of 20 per process; M0 allows 500 | Pool 3 per Lambda → ~300 + API. Check the Atlas tier (M10+ recommended) and that the cluster's region is close to eu-north-1. |
| **Remotion licence** | — | Automators: $0.01 per render, $100/month minimum (companies over 3 people). Set `REMOTION_LICENSE_KEY`. |

## Cost

| | Render worker today | Lambda |
|---|---|---|
| Fixed | $25/month (standard), and 1 box only | ~$0 idle (ECR storage, logs: ~$1–2/month) |
| Per reel | included, until the box is full | worker ~**$0.006** (4 GB × ~90 s) + render ~$0.01–0.02 + SQS ~$0 |
| 1,000 reels/month | ~$40 (+ waiting at bursts) | ~$20 |
| 10,000 reels/month, bursts of 100 | ~33 boxes for the bursts ≈ $825+ | ~$200 |

## Phases

**Phase 0 — prepare (½ day, no prod change)**
1. Request the Lambda concurrency increase (5,000, eu-north-1). It can take days.
2. Check the Atlas tier, its region and the connection limit; check the Anthropic, OpenAI and ElevenLabs limits.
3. Decide x86_64 vs arm64 (build sharp + ffmpeg-static for arm64 in the image; fall back to x86).

**Phase 1 — image + handler (1 day)**
1. `Dockerfile.reel-lambda`, `src/lambda/reelWorker.js`, the bundle-cache dir, timeout capping,
   no local fallback in Lambda.
2. Run the image locally with the Lambda runtime emulator against a test reel (spec from Mongo),
   rendering on Remotion Lambda. Check memory: peak RSS < 2.5 GB on the six-4K-clip capture.

**Phase 2 — AWS stack (1 day)**
1. ECR, Lambda, SQS + DLQ, event source mapping (max concurrency 10 to start), IAM, Secrets,
   alarms, as a CDK/Terraform stack. **Needs an AWS user that can create these** (the current
   `remotion-renderer` user can't). Either you run the stack, or create a deploy user/role for it.
2. A deploy script: build → push to ECR → update the function (CI later).

**Phase 3 — switch the API (½ day)**
1. `REEL_RUNNER` in `reelQueue.js`, the SQS client, leases, sweeper changes, DLQ handler.
2. API env: `REEL_RUNNER=lambda`, `REEL_SQS_URL`, SQS-only keys.

**Phase 4 — rollout (½ day + watching)**
1. Admin accounts first (`REEL_LAMBDA_USERS`-style allow list on the runner), max concurrency 10.
2. Burst test: queue 20, then 50, then 100 test reels from one capture set (a script). Watch:
   throttles, ElevenLabs/Anthropic 429s, Atlas connections, DLQ, wall time per reel, cost.
3. Everyone. Kill switch: `REEL_RUNNER=queue` (the Render worker keeps running for a week, then
   goes to 0 instances).

**Phase 5 — afterwards**
- An ElevenLabs limiter if the burst test shows 429s.
- Move Theme Apply / video covers / plan generation onto the same pattern if they need to scale.

## Risks

| Risk | Mitigation |
|---|---|
| A reel needs > 15 min (very long clips, slow APIs) | Stops cleanly at ~14 min with a retryable error → SQS redelivers → resumes from the saved cut. Long steps (clip analysis) are already saved on the capture as they finish. |
| A cold start + 4 GB image | ~1–3 s per cold start; the bundle and Chrome-free image keep it small. Provisioned concurrency only if needed. |
| AI API rate limits at bursts | Event-source max concurrency throttles how many reels run; the limits table above; backoff already exists. |
| Duplicate delivery (SQS at-least-once) | New in Phase 3: the handler claims the reel with a conditional update (`queued`, or `working` with an expired lease → `working` + new lease) before `runCaptureReel`, so a duplicate exits early. Today's code only counts attempts. |
| Debugging moves to CloudWatch | The reel's debug rows (Mongo, debug panel) are unchanged; add the request id to the reel. |
| Region latency to Atlas / Render | Keep the Lambda in eu-north-1 (S3 + Remotion); check Atlas's region; the API only sends one SQS message per reel. |

## Estimate

Prepare ½ day (+ the AWS quota wait) · build 2½ days · rollout ½ day + a few days of watching.
