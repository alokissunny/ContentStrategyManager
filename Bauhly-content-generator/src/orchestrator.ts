import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FORCE_MOCK, IMAGE_FORMATS, MODEL, VIDEO_SAMPLE_FRAMES } from "./config.js";
import { NoCredentialsError } from "./anthropic.js";
import { runStrategyAgent } from "./agents/strategyAgent.js";
import { runCreativeDirector } from "./agents/creativeDirector.js";
import { runCopywriter } from "./agents/copywriter.js";
import { runVideoDirector } from "./agents/videoDirector.js";
import { runQA, type QAVerdict } from "./agents/qaAgent.js";
import { mockCaptions, mockPieces, mockStrategy, mockVideoPlan } from "./mock.js";
import { renderSlide } from "./imageEditor.js";
import { withUsageMeter } from "./usage.js";
import { ffmpegAvailable } from "./video/ffmpeg.js";
import { probeVideo } from "./video/probe.js";
import { sampleFrames } from "./video/frames.js";
import { renderVideo, sanitizePlan } from "./video/editor.js";
import type {
  AssetInfo,
  Caption,
  ContentPlan,
  IGFormat,
  PiecePlan,
  QASummary,
  RenderedPiece,
  StrategyBrief,
} from "./types.js";

export interface PipelineInput {
  strategy: string;
  assets: AssetInfo[];
  formats: IGFormat[];
  outDir: string;
  log?: (msg: string) => void;
}

interface Plans {
  brief: StrategyBrief;
  pieces: PiecePlan[];
  captions: Caption[];
  qa?: QASummary;
}

/** Make sure every image slide references a real asset; repair silently if not. */
function repairPlans(pieces: PiecePlan[], images: AssetInfo[]): PiecePlan[] {
  if (images.length === 0) return pieces;
  const known = new Map(images.map((a) => [a.file, a]));
  return pieces.map((p) =>
    p.slides
      ? {
          ...p,
          slides: p.slides.map((s, i) =>
            known.has(s.assetFile) ? s : { ...s, assetFile: images[i % images.length].file },
          ),
        }
      : p,
  );
}

/** Split requested formats and available assets; decide what we can actually make. */
function planScope(input: PipelineInput, log: (m: string) => void) {
  const images = input.assets.filter((a) => a.kind === "image");
  const video = input.assets.find((a) => a.kind === "video");

  let imageFormats = input.formats.filter((f) => IMAGE_FORMATS.includes(f));
  const wantVideo = input.formats.includes("video");

  if (imageFormats.length && images.length === 0) {
    log(`⚠ Skipping ${imageFormats.join(", ")} — no image assets provided.`);
    imageFormats = [];
  }
  return { images, video, imageFormats, wantVideo };
}

async function buildVideoPiece(
  brief: StrategyBrief,
  strategy: string,
  video: AssetInfo,
  outDir: string,
  engine: "claude" | "mock",
  log: (m: string) => void,
  feedback?: string,
): Promise<PiecePlan> {
  if (engine === "mock") {
    const plan = sanitizePlan(mockVideoPlan(brief, video), video.durationSec ?? 15);
    return { format: "video", title: `${brief.brandName} reel`, concept: plan.concept, videoPlan: plan };
  }

  log(feedback ? "→ Video Director Agent: re-cutting the clip on QA feedback…" : "→ Video Director Agent: sampling frames and watching the clip…");
  const framesDir = join(outDir, ".frames");
  const meta = await probeVideo(video.absPath);
  const frames = await sampleFrames(video.absPath, meta.durationSec, VIDEO_SAMPLE_FRAMES, framesDir);
  const raw = await runVideoDirector(brief, strategy, frames, meta, video.file, feedback);
  await rm(framesDir, { recursive: true, force: true });
  const plan = sanitizePlan(raw, meta.durationSec);
  return { format: "video", title: `${brief.brandName} reel`, concept: plan.concept, videoPlan: plan };
}

/** Apply an "edit" verdict to a piece + its caption, in place. */
function applyQaEdit(piece: PiecePlan, caption: Caption, v: QAVerdict): Caption {
  let next = caption;
  const rc = v.revisedCaption;
  if (rc && rc.hook && rc.body && rc.cta && Array.isArray(rc.hashtags)) next = rc;

  if (piece.slides && v.revisedOverlays?.length) {
    let k = 0;
    for (const s of piece.slides) {
      if (s.overlay && k < v.revisedOverlays.length) s.overlay.headline = v.revisedOverlays[k++];
    }
  }
  if (piece.videoPlan) {
    if (v.revisedVideoHook?.trim()) piece.videoPlan.hook = v.revisedVideoHook;
    if (v.revisedVideoOverlays?.length) {
      piece.videoPlan.overlays.forEach((o, i) => {
        if (i < v.revisedVideoOverlays!.length) o.text = v.revisedVideoOverlays![i];
      });
    }
  }
  return next;
}

interface QAContext {
  brief: StrategyBrief;
  strategy: string;
  images: AssetInfo[];
  video?: AssetInfo;
  outDir: string;
  log: (m: string) => void;
}

/** Review pieces against strategy, then edit or regenerate as required (one pass). */
async function reviewAndFix(
  pieces: PiecePlan[],
  captions: Caption[],
  ctx: QAContext,
): Promise<{ pieces: PiecePlan[]; captions: Caption[]; qa: QASummary }> {
  ctx.log("→ QA Agent: reviewing content against the strategy…");
  const verdicts = await runQA(ctx.strategy, ctx.brief, pieces, captions);
  const byIndex = new Map(verdicts.map((v, i) => [typeof v.index === "number" ? v.index : i, v]));

  let edited = 0;
  const regenImageFormats: IGFormat[] = [];
  const regenIssues: string[] = [];
  let regenVideo = false;

  pieces.forEach((piece, i) => {
    const v = byIndex.get(i);
    if (!v || v.action === "pass") return;
    if (v.action === "edit") {
      captions[i] = applyQaEdit(piece, captions[i], v);
      edited++;
      ctx.log(`   • QA edited ${piece.format} (score ${v.score}): ${v.issues.slice(0, 2).join("; ") || "copy polish"}`);
    } else if (v.action === "regenerate") {
      ctx.log(`   • QA flagged ${piece.format} for regeneration (score ${v.score}): ${v.issues.slice(0, 2).join("; ")}`);
      regenIssues.push(`[${piece.format}] ${v.issues.join(" ")}`);
      if (piece.videoPlan) regenVideo = true;
      else regenImageFormats.push(piece.format);
    }
  });

  let regenerated = 0;
  if (regenImageFormats.length && ctx.images.length) {
    const fresh = await runCreativeDirector(ctx.brief, ctx.images, regenImageFormats, regenIssues.join("\n"));
    for (const np of fresh) {
      const idx = pieces.findIndex((p) => p.format === np.format && p.slides);
      if (idx >= 0) { pieces[idx] = np; regenerated++; }
    }
  }
  if (regenVideo && ctx.video) {
    const nv = await buildVideoPiece(ctx.brief, ctx.strategy, ctx.video, ctx.outDir, "claude", ctx.log, regenIssues.join("\n"));
    const idx = pieces.findIndex((p) => p.videoPlan);
    if (idx >= 0) { pieces[idx] = nv; regenerated++; }
  }

  // Re-caption regenerated pieces so copy matches the new plan.
  if (regenerated > 0) {
    const fresh = await runCopywriter(ctx.brief, pieces);
    fresh.forEach((c, i) => { captions[i] = c; });
  }

  const scores = verdicts.map((v) => v.score).filter((n) => typeof n === "number");
  const qa: QASummary = {
    reviewed: pieces.length,
    edited,
    regenerated,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    pieces: pieces.map((p, i) => ({
      format: p.format,
      title: p.title,
      action: byIndex.get(i)?.action ?? "pass",
      score: byIndex.get(i)?.score ?? 0,
      issues: byIndex.get(i)?.issues ?? [],
    })),
  };
  ctx.log(`→ QA done: ${qa.reviewed} reviewed · ${qa.edited} edited · ${qa.regenerated} regenerated · avg score ${qa.averageScore}`);
  return { pieces, captions, qa };
}

async function runClaudePlans(input: PipelineInput, videoOk: boolean): Promise<Plans> {
  const log = input.log ?? (() => {});
  const { images, video, imageFormats, wantVideo } = planScope(input, log);

  log("→ Strategy Agent: interpreting your strategy…");
  const brief = await runStrategyAgent(input.strategy);

  const pieces: PiecePlan[] = [];
  if (imageFormats.length) {
    log("→ Creative Director Agent: reviewing assets and planning pieces…");
    const imgPieces = repairPlans(await runCreativeDirector(brief, images, imageFormats), images);
    pieces.push(...imgPieces);
  }
  if (wantVideo && video && videoOk) {
    pieces.push(await buildVideoPiece(brief, input.strategy, video, input.outDir, "claude", log));
  }

  log("→ Copywriter Agent: writing captions…");
  const captions = pieces.length ? await runCopywriter(brief, pieces) : [];

  if (pieces.length === 0) return { brief, pieces, captions };

  const reviewed = await reviewAndFix(pieces, captions, {
    brief,
    strategy: input.strategy,
    images,
    video,
    outDir: input.outDir,
    log,
  });
  return { brief, pieces: reviewed.pieces, captions: reviewed.captions, qa: reviewed.qa };
}

async function runMockPlans(input: PipelineInput, videoOk: boolean): Promise<Plans> {
  const log = input.log ?? (() => {});
  const { images, video, imageFormats, wantVideo } = planScope(input, log);
  const brief = mockStrategy(input.strategy);

  const pieces: PiecePlan[] = [];
  if (imageFormats.length) {
    pieces.push(...repairPlans(mockPieces(brief, images, imageFormats), images));
  }
  if (wantVideo && video && videoOk) {
    pieces.push(await buildVideoPiece(brief, input.strategy, video, input.outDir, "mock", log));
  }
  const qa: QASummary = {
    reviewed: pieces.length,
    edited: 0,
    regenerated: 0,
    averageScore: 0,
    pieces: pieces.map((p) => ({ format: p.format, title: p.title, action: "pass", score: 0, issues: [] })),
  };
  return { brief, pieces, captions: mockCaptions(brief, pieces), qa };
}

export async function runPipeline(input: PipelineInput): Promise<ContentPlan> {
  const log = input.log ?? (() => {});
  const imageByFile = new Map(input.assets.filter((a) => a.kind === "image").map((a) => [a.file, a]));
  const videoByFile = new Map(input.assets.filter((a) => a.kind === "video").map((a) => [a.file, a]));

  // Video needs ffmpeg; check once so we can warn rather than crash.
  let videoOk = true;
  if (input.formats.includes("video") && input.assets.some((a) => a.kind === "video")) {
    videoOk = await ffmpegAvailable();
    if (!videoOk) log("⚠ ffmpeg not found — skipping the video edit. Install ffmpeg or the ffmpeg-static package.");
  }

  const { result: planned, meter } = await withUsageMeter(async () => {
    if (FORCE_MOCK) {
      log("MOCK=1 set — running the offline deterministic pipeline.");
      return { engine: "mock" as const, plans: await runMockPlans(input, videoOk) };
    }
    try {
      return { engine: "claude" as const, plans: await runClaudePlans(input, videoOk) };
    } catch (err) {
      if (err instanceof NoCredentialsError) {
        log(`⚠ ${err.message}`);
        return { engine: "mock" as const, plans: await runMockPlans(input, videoOk) };
      }
      throw err;
    }
  });
  const engine = planned.engine;
  const plans = planned.plans;

  const imagesDir = join(input.outDir, "images");
  await mkdir(imagesDir, { recursive: true });

  log("→ Editor: rendering media…");
  const rendered: RenderedPiece[] = [];
  for (let pi = 0; pi < plans.pieces.length; pi++) {
    const plan = plans.pieces[pi];
    const caption = plans.captions[pi] ?? {
      hook: plan.title,
      body: plan.concept,
      cta: plans.brief.cta,
      hashtags: plans.brief.hashtags,
    };

    if (plan.videoPlan) {
      const source = videoByFile.get(plan.videoPlan.sourceFile);
      if (!source) continue;
      const rel = join("images", `${pi + 1}-video.mp4`);
      const coverRel = join("images", `${pi + 1}-video-cover.jpg`);
      log(`   • editing video from ${source.file} — ${plan.videoPlan.segments.length} segments`);
      const res = await renderVideo(
        source,
        plan.videoPlan,
        plans.brief.brandKit,
        join(input.outDir, rel),
        join(input.outDir, coverRel),
      );
      log(`     rendered ${res.durationSec.toFixed(1)}s vertical video`);
      rendered.push({ plan, caption, images: [], video: rel, cover: coverRel });
      continue;
    }

    const images: string[] = [];
    for (let si = 0; si < (plan.slides?.length ?? 0); si++) {
      const slide = plan.slides![si];
      const asset = imageByFile.get(slide.assetFile)!;
      const rel = join("images", `${pi + 1}-${plan.format}-slide-${si + 1}.jpg`);
      await renderSlide(asset, slide, plans.brief.brandKit, join(input.outDir, rel));
      images.push(rel);
      log(`   • ${plan.format} slide ${si + 1}/${plan.slides!.length} from ${slide.assetFile}`);
    }
    rendered.push({ plan, caption, images });
  }

  const usage = meter.summary(engine === "claude" ? MODEL : "offline-mock");
  if (engine === "claude") {
    log(`→ Tokens: ${usage.totalTokens.toLocaleString()} (in ${usage.inputTokens.toLocaleString()} / out ${usage.outputTokens.toLocaleString()}) across ${usage.calls} calls · ~$${usage.estimatedCostUsd.toFixed(4)}`);
  }

  return {
    strategyInput: input.strategy,
    brief: plans.brief,
    pieces: rendered,
    generatedAt: new Date().toISOString(),
    engine,
    model: engine === "claude" ? MODEL : "offline-mock",
    usage,
    qa: plans.qa,
  };
}
