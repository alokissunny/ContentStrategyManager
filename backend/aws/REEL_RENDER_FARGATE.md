# Plan — move reel rendering to AWS (ECS Fargate)

**Problem.** Capture reels never start in prod: `igsignal-api` runs on Render
`starter` (512 MB) and the reel worker refuses to start below
`REEL_RENDER_MIN_MEMORY_MB` (1536 MB) — see `src/workers/reelWorkers.js`. Reels
wait in the BullMQ queue (`capture-reel`) for a worker that never comes, and the
sweeper fails them after `CAPTURE_REEL_MAX_WAIT_MS` (45 min).

**Goal.** Reels (and later Theme Apply / video covers / plan generation) run on
AWS workers that scale with the queue, down to zero when idle. The API stays on
Render and keeps only queueing. **No change to the reel pipeline itself** —
the worker is the same `node src/workers/index.js` the code already has.

```
Browser ──► Render: igsignal-api (512 MB) ──► Redis queue "capture-reel"
                                                   │
                         AWS ECS Fargate: reel-worker task(s) (2 vCPU / 4 GB)
                         node src/workers/index.js  REEL_WORKERS=1 PLAN_WORKERS=0
                             │ Mongo Atlas (CaptureReel state)
                             │ S3 + CloudFront (clips in, MP4 out)
                             └ OpenAI / ElevenLabs / Gemini (director, voice, music)
```

Why Fargate (not Remotion Lambda): a reel is far more than the Remotion render —
director agents, Whisper, voice clean-up, ffmpeg cuts, sharp, music, then
`remotion/render.mjs` as a child process. Fargate runs that whole pipeline
unchanged; Lambda would mean splitting it apart (15-min cap, 10 GB /tmp, Chrome
layer). Revisit Lambda only for the Remotion step if renders get slow.

---

## Phase 0 — decide (½ day)

| Decision | Recommendation |
|---|---|
| AWS region | `us-west-2` (Oregon) — same area as Render `oregon`, low Redis/API latency. Check the S3 bucket's region too; keep the worker next to it. |
| Redis | **Option A (start here):** keep Render Key Value, allow external access (TLS + password) from the AWS NAT IP. **Option B (later):** move the queue to ElastiCache or Upstash so both sides reach it without opening Render's Redis. |
| Networking | Fargate tasks in private subnets + one NAT gateway (static egress IP for the Redis / Atlas allow-lists). Cheaper alternative: public subnets + public IP, but then the IP changes per task — only workable with Upstash/Atlas `0.0.0.0/0` + strong auth. |
| Spot | Use `FARGATE_SPOT` as the main capacity provider with `FARGATE` fallback. A reel interrupted mid-render is re-delivered once (`maxStalledCount: 1`) and resumes from its saved cut. |

## Phase 1 — container image (1 day)

1. Add `backend/Dockerfile.worker`:
   - Base `node:22-bookworm-slim`.
   - `apt-get install` Chrome headless-shell libraries (`libnss3 libatk1.0-0
     libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1
     libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
     fonts-liberation fonts-noto-color-emoji`) — whatever Remotion's
     `ensureBrowser()` needs on Debian.
   - `COPY backend/ .` → `npm ci` (postinstall `scripts/setup-remotion.js`
     installs `remotion/` and downloads Chrome **at build time**, so a task
     never downloads it on start).
   - ffmpeg comes from `ffmpeg-static`; no system ffmpeg needed.
   - `CMD ["node", "src/workers/index.js"]`.
2. Add `.dockerignore` (`node_modules`, `remotion/node_modules`, `remotion/out`, `test`, `.env`).
3. Smoke test locally:
   ```bash
   docker build -f backend/Dockerfile.worker -t bauhly-reel-worker backend
   docker run --rm -m 3g --env-file backend/.env -e REEL_WORKERS=1 -e PLAN_WORKERS=0 bauhly-reel-worker
   ```
   Log must say `[reelWorkers] listening on capture-reel · … memory limit 3072 MB`
   (`memoryLimitMb()` reads the cgroup limit, which works on Fargate too).
   Make one reel against a **dev** Redis and check it renders.

## Phase 2 — AWS resources (1 day)

Build with Terraform/CDK under `backend/aws/` (or the console the first time):

1. **ECR** repo `bauhly-reel-worker`.
2. **Secrets Manager** secret `bauhly/worker` holding every key the reel path
   reads: `MONGO_URI`, `REDIS_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
   `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`, `APIFY_TOKEN`, VAPID/APNs keys (push
   on "reel ready" if used). Plain env vars: `NODE_ENV=production`,
   `PLAN_QUEUE=1`, `REEL_QUEUE=1`, `REEL_WORKERS=1`, `PLAN_WORKERS=0`,
   `CAPTURE_REEL_CONCURRENCY=1`, `S3_BUCKET_NAME`, `AWS_REGION`,
   `MEDIA_CDN_BASE_URL`, model overrides (`REEL_*_MODEL`) matching the API.
3. **IAM**
   - Task execution role: pull from ECR, read the secret, write CloudWatch Logs.
   - Task role: `s3:GetObject`/`PutObject` on `projects/*` (and whatever prefix
     reels write to) in the media bucket. **No static AWS keys** in the task —
     the SDK picks up the task role.
4. **ECS cluster** `bauhly-workers`, capacity providers `FARGATE_SPOT` (weight 4)
   + `FARGATE` (weight 1, base 0).
5. **Task definition** `reel-worker`: 2 vCPU / 4 GB, ephemeral storage 40 GB
   (clips + frames in `/tmp`), `stopTimeout` 120 s (max on Fargate), awslogs to
   `/ecs/reel-worker` (30-day retention).
6. **Service** `reel-worker`, desired count 0–N, private subnets, SG with
   egress only.

## Phase 3 — scale on queue depth (½–1 day)

Fargate can't see BullMQ, so publish the depth as a metric:

1. Small scheduled Lambda (every 1 min, EventBridge) or a tiny loop in the API:
   `LLEN bull:capture-reel:wait` + `ZCARD bull:capture-reel:active` →
   CloudWatch metric `Bauhly/ReelQueue/Backlog`.
2. Application Auto Scaling on the service:
   - Step scaling: backlog ≥ 1 → desired = min(backlog, MAX), MAX = 5 to start.
   - Scale in to 0 after 10 min of backlog 0 (cooldown 600 s).
3. Cold start is ~60–90 s (image pull + Chrome). If that's too slow, keep
   `min = 1` during working hours (scheduled action) and 0 overnight.

## Phase 4 — code changes (small)

1. **Queue tag.** `reelQueue.queueTag()` hashes `REDIS_URL`; Render's internal URL
   and the external TLS URL differ, so set the **same `REEL_QUEUE_TAG`** on the
   API and the AWS worker (e.g. `prod`) so the sweeper treats their reels as one
   queue.
2. **TLS Redis.** `redisConnection()` passes the URL straight to IORedis;
   `rediss://` works as-is — just confirm the external URL scheme.
3. **Graceful stop.** Fargate sends SIGTERM and kills after `stopTimeout` (≤120 s).
   `workers/index.js` already closes workers on SIGTERM; a reel longer than that
   is re-delivered and resumes from its saved cut — acceptable. On Spot (2-min
   warning) same behaviour.
4. **Health / admin message.** `/capture-reels/system` reports only the API
   process. Add a heartbeat key (`SET reel-worker:<taskId> … EX 60` every 30 s
   from `reelWorkers.js`) and have the endpoint list live workers, so the admin
   note says "2 AWS workers online" instead of "no reel worker running here".
5. **CI/CD.** GitHub Action on push to `deploy/render` (paths `backend/**`):
   build + push to ECR, `aws ecs update-service --force-new-deployment`.
   Use GitHub OIDC → IAM role, no long-lived keys.

## Phase 5 — rollout (½ day)

1. Deploy the service with desired = 1, pointed at prod Redis; API unchanged
   (its reel worker already refuses to start at 512 MB, so nothing double-renders).
2. Make a test reel in prod; watch `/ecs/reel-worker` logs and the reel finish.
3. Turn on autoscaling (Phase 3), then let it scale to 0.
4. Alarms: backlog > 0 for 15 min with 0 running tasks; task stopped with exit
   code ≠ 0; `[reelWorkers] … failed` log metric filter.

## Phase 6 — later, same pattern

- **Plan generation:** run a second service from the same image with
  `PLAN_WORKERS=1 REEL_WORKERS=0` (1 vCPU / 2 GB), set `PLAN_WORKER_IN_API=0` on
  the API. Gets heavy generations out of the API's memory.
- **Theme Apply, carousel video cover, reel editor** — move onto queues served
  by these workers instead of running inside the API request.
- **Redis to ElastiCache** in the same VPC once most workers live in AWS.

## Cost (rough, us-west-2)

| Item | Estimate |
|---|---|
| Fargate Spot 2 vCPU / 4 GB | ≈ $0.03/hour per task (≈ $0.10 on-demand) — a 3-min reel ≈ $0.002 |
| NAT gateway | ≈ $33/month + data — the biggest fixed cost; skip with public subnets or move to VPC endpoints for S3 |
| CloudWatch logs/metrics, ECR, Secrets | a few $/month |
| Compare: Render `standard` worker | $25/month always on, one reel at a time |

## Effort

About **4–5 working days** end to end: image 1 d, AWS resources 1 d, scaling 1 d,
code + CI 1 d, rollout ½ d. Unblock prod in the meantime with a Render
`standard` worker (`REEL_WORKERS=1 PLAN_WORKERS=0`) — it reads the same queue,
so it can be switched off the day the AWS service is live.
