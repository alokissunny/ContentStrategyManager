import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FORCE_MOCK, IMAGE_FORMATS, MAX_VIDEOS, MODEL, VIDEO_SAMPLE_FRAMES } from "./config.js";
import { NoCredentialsError } from "./anthropic.js";
import { runStrategyAgent } from "./agents/strategyAgent.js";
import { runAssetPlanner } from "./agents/assetPlanner.js";
import { runCreativeDirector } from "./agents/creativeDirector.js";
import { runCopywriter } from "./agents/copywriter.js";
import { runVideoDirector } from "./agents/videoDirector.js";
import { runMontageDirector } from "./agents/montageDirector.js";
import { runHookAgent } from "./agents/hookAgent.js";
import { runQA, type QAVerdict } from "./agents/qaAgent.js";
import { generateAssets } from "./assetgen/generate.js";
import { mockCaptions, mockMontagePlan, mockPieces, mockStrategy, mockVideoPlan } from "./mock.js";
import { renderSlide } from "./imageEditor.js";
import { withUsageMeter } from "./usage.js";
import { ffmpegAvailable } from "./video/ffmpeg.js";
import { probeVideo } from "./video/probe.js";
import { sampleFrames, type SampledFrame } from "./video/frames.js";
import { renderVideo, sanitizePlan, fitPlanToDuration } from "./video/editor.js";
import { renderMontage, sanitizeMontage, fitMontageToDuration } from "./video/montage.js";
import type {
  AssetInfo,
  Caption,
  ContentPlan,
  GeneratedAsset,
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
  /** Optional target duration (seconds) for video/montage output. */
  durationSec?: number;
  log?: (msg: string) => void;
}

interface Plans {
  brief: StrategyBrief;
  pieces: PiecePlan[];
  captions: Caption[];
  qa?: QASummary;
  /** Generated photos (metadata) for the content plan. */
  generatedAssets: GeneratedAsset[];
  /** Generated photos as loadable assets, for the renderer's lookup pool. */
  generatedAssetInfos: AssetInfo[];
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
  const videos = input.assets.filter((a) => a.kind === "video").slice(0, MAX_VIDEOS);

  let imageFormats = input.formats.filter((f) => IMAGE_FORMATS.includes(f));
  const wantVideo = input.formats.includes("video");
  const wantMontage = input.formats.includes("montage");

  if (imageFormats.length && images.length === 0) {
    log(`⚠ Skipping ${imageFormats.join(", ")} — no image assets provided.`);
    imageFormats = [];
  }
  return { images, videos, imageFormats, wantVideo, wantMontage };
}

function sanitizeName(s: string): string {
  return s.replace(/[^\w.-]+/g, "_");
}

/** Build ONE montage piece stitching all videos + photos together. */
async function buildMontagePiece(
  brief: StrategyBrief,
  strategy: string,
  videos: AssetInfo[],
  photos: AssetInfo[],
  outDir: string,
  engine: "claude" | "mock",
  log: (m: string) => void,
  feedback?: string,
  target?: number,
): Promise<PiecePlan> {
  const sources = new Map<string, AssetInfo>([...videos, ...photos].map((a) => [a.file, a]));
  const title = `${brief.brandName} montage`;

  if (engine === "mock") {
    let plan = sanitizeMontage(mockMontagePlan(brief, videos, photos), sources);
    if (target) plan = fitMontageToDuration(plan, target, sources);
    return { format: "montage", title, concept: plan.concept, montagePlan: plan };
  }

  log(
    feedback
      ? "→ Montage Director Agent: re-cutting the montage on QA feedback…"
      : `→ Montage Director Agent: assembling ${videos.length} clip(s) + ${photos.length} photo(s) into one reel…`,
  );
  const framesDir = join(outDir, ".montage-frames");
  const perVideo = Math.max(2, Math.min(4, Math.floor(14 / Math.max(1, videos.length))));
  const frames: SampledFrame[] = [];
  for (const v of videos) {
    const meta = await probeVideo(v.absPath);
    if (!v.durationSec) v.durationSec = meta.durationSec;
    if (v.hasAudio === undefined) v.hasAudio = meta.hasAudio;
    const vf = await sampleFrames(v.absPath, meta.durationSec, perVideo, join(framesDir, sanitizeName(v.file)));
    for (const f of vf) { f.asset.file = `${v.file}@${f.timeSec.toFixed(1)}s`; frames.push(f); }
  }
  const raw = await runMontageDirector(strategy, brief, videos, photos.slice(0, 10), frames, feedback, target);
  await rm(framesDir, { recursive: true, force: true });
  let plan = sanitizeMontage(raw, sources);
  if (target) plan = fitMontageToDuration(plan, target, sources);
  return { format: "montage", title, concept: plan.concept, montagePlan: plan };
}

async function buildVideoPiece(
  brief: StrategyBrief,
  strategy: string,
  video: AssetInfo,
  outDir: string,
  engine: "claude" | "mock",
  log: (m: string) => void,
  feedback: string | undefined,
  idx: number,
  target?: number,
): Promise<PiecePlan> {
  const title = `${brief.brandName} reel ${idx}`;
  if (engine === "mock") {
    const src = video.durationSec ?? 15;
    let plan = sanitizePlan(mockVideoPlan(brief, video), src);
    if (target) plan = fitPlanToDuration(plan, target, src);
    return { format: "video", title, concept: plan.concept, videoPlan: plan };
  }

  log(
    feedback
      ? `→ Video Director Agent: re-cutting ${video.file} on QA feedback…`
      : `→ Video Director Agent: watching ${video.file} (${idx})…`,
  );
  const framesDir = join(outDir, `.frames-${idx}`);
  const meta = await probeVideo(video.absPath);
  const frames = await sampleFrames(video.absPath, meta.durationSec, VIDEO_SAMPLE_FRAMES, framesDir);
  const raw = await runVideoDirector(brief, strategy, frames, meta, video.file, feedback, target);
  await rm(framesDir, { recursive: true, force: true });
  let plan = sanitizePlan(raw, meta.durationSec);
  if (target) plan = fitPlanToDuration(plan, target, meta.durationSec);
  return { format: "video", title, concept: plan.concept, videoPlan: plan };
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
  videos: AssetInfo[];
  /** Uploaded photos used for the montage (vs generated ones). */
  montagePhotos: AssetInfo[];
  targetDurationSec?: number;
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
  const regenImageIssues: string[] = [];
  const regenVideoIdx: number[] = [];
  const regenMontageIdx: number[] = [];

  pieces.forEach((piece, i) => {
    const v = byIndex.get(i);
    if (!v || v.action === "pass") return;
    if (v.action === "edit") {
      captions[i] = applyQaEdit(piece, captions[i], v);
      edited++;
      ctx.log(`   • QA edited ${piece.format} (score ${v.score}): ${v.issues.slice(0, 2).join("; ") || "copy polish"}`);
    } else if (v.action === "regenerate") {
      ctx.log(`   • QA flagged ${piece.format} for regeneration (score ${v.score}): ${v.issues.slice(0, 2).join("; ")}`);
      if (piece.montagePlan) regenMontageIdx.push(i);
      else if (piece.videoPlan) regenVideoIdx.push(i);
      else { regenImageFormats.push(piece.format); regenImageIssues.push(`[${piece.format}] ${v.issues.join(" ")}`); }
    }
  });

  let regenerated = 0;
  if (regenImageFormats.length && ctx.images.length) {
    const fresh = await runCreativeDirector(ctx.brief, ctx.images, regenImageFormats, regenImageIssues.join("\n"));
    for (const np of fresh) {
      const idx = pieces.findIndex((p) => p.format === np.format && p.slides);
      if (idx >= 0) { pieces[idx] = np; regenerated++; }
    }
  }
  // Regenerate each flagged video from its own source clip.
  for (const i of regenVideoIdx) {
    const src = ctx.videos.find((vv) => vv.file === pieces[i].videoPlan?.sourceFile) ?? ctx.videos[0];
    if (!src) continue;
    const issues = byIndex.get(i)?.issues?.join(" ") ?? "";
    pieces[i] = await buildVideoPiece(ctx.brief, ctx.strategy, src, ctx.outDir, "claude", ctx.log, issues, i + 1, ctx.targetDurationSec);
    regenerated++;
  }
  // Regenerate the montage from all its sources.
  for (const i of regenMontageIdx) {
    const issues = byIndex.get(i)?.issues?.join(" ") ?? "";
    pieces[i] = await buildMontagePiece(ctx.brief, ctx.strategy, ctx.videos, ctx.montagePhotos, ctx.outDir, "claude", ctx.log, issues, ctx.targetDurationSec);
    regenerated++;
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
  const { images, videos, imageFormats, wantVideo, wantMontage } = planScope(input, log);

  log("→ Strategy Agent: interpreting your strategy…");
  const brief = await runStrategyAgent(input.strategy);

  // Asset Planner: analyse the uploads vs the strategy and generate any missing photos.
  let allImages = images;
  let generatedAssets: GeneratedAsset[] = [];
  let generatedAssetInfos: AssetInfo[] = [];
  if (imageFormats.length) {
    log("→ Asset Planner Agent: checking assets against the strategy…");
    const requests = await runAssetPlanner(input.strategy, brief, images, imageFormats);
    if (requests.length) {
      log(`→ Asset Generator: creating ${requests.length} new photo(s)…`);
      const gen = await generateAssets(requests, brief.brandKit, input.outDir, log);
      generatedAssets = gen.generated;
      generatedAssetInfos = gen.assets;
      allImages = [...images, ...gen.assets];
    } else {
      log("   • uploads cover the strategy — no new photos needed.");
    }
  }

  const pieces: PiecePlan[] = [];
  if (imageFormats.length) {
    log("→ Creative Director Agent: reviewing assets and planning pieces…");
    const imgPieces = repairPlans(await runCreativeDirector(brief, allImages, imageFormats), allImages);
    pieces.push(...imgPieces);
  }
  if (wantVideo && videos.length && videoOk) {
    if (videos.length > 1) log(`→ Editing ${videos.length} videos…`);
    for (let vi = 0; vi < videos.length; vi++) {
      pieces.push(await buildVideoPiece(brief, input.strategy, videos[vi], input.outDir, "claude", log, undefined, vi + 1, input.durationSec));
    }
  }
  if (wantMontage && (videos.length || images.length) && videoOk) {
    pieces.push(await buildMontagePiece(brief, input.strategy, videos, images, input.outDir, "claude", log, undefined, input.durationSec));
  }

  if (pieces.length) {
    log("→ Hook Agent: writing viral on-screen hooks…");
    const hooks = await runHookAgent(input.strategy, brief, pieces);
    const byIndex = new Map(hooks.map((h, i) => [typeof h.index === "number" ? h.index : i, h]));
    pieces.forEach((p, i) => {
      const h = byIndex.get(i);
      if (!h || !h.hook?.trim()) return;
      p.hook = h.hook;
      if (p.videoPlan) {
        p.videoPlan.hook = h.hook;
      } else if (p.montagePlan) {
        p.montagePlan.hook = h.hook;
      } else if (p.slides?.length) {
        const hero = p.slides[0];
        if (hero.overlay) { hero.overlay.headline = h.hook; hero.overlay.position = h.position; }
        else hero.overlay = { headline: h.hook, subtext: "", position: h.position };
      }
    });
  }

  log("→ Copywriter Agent: writing captions…");
  const captions = pieces.length ? await runCopywriter(brief, pieces) : [];

  if (pieces.length === 0) return { brief, pieces, captions, generatedAssets, generatedAssetInfos };

  const reviewed = await reviewAndFix(pieces, captions, {
    brief,
    strategy: input.strategy,
    images: allImages,
    videos,
    montagePhotos: images,
    targetDurationSec: input.durationSec,
    outDir: input.outDir,
    log,
  });
  return {
    brief,
    pieces: reviewed.pieces,
    captions: reviewed.captions,
    qa: reviewed.qa,
    generatedAssets,
    generatedAssetInfos,
  };
}

async function runMockPlans(input: PipelineInput, videoOk: boolean): Promise<Plans> {
  const log = input.log ?? (() => {});
  const { images, videos, imageFormats, wantVideo, wantMontage } = planScope(input, log);
  const brief = mockStrategy(input.strategy);

  const pieces: PiecePlan[] = [];
  if (imageFormats.length) {
    pieces.push(...repairPlans(mockPieces(brief, images, imageFormats), images));
  }
  if (wantVideo && videos.length && videoOk) {
    for (let vi = 0; vi < videos.length; vi++) {
      pieces.push(await buildVideoPiece(brief, input.strategy, videos[vi], input.outDir, "mock", log, undefined, vi + 1, input.durationSec));
    }
  }
  if (wantMontage && (videos.length || images.length) && videoOk) {
    pieces.push(await buildMontagePiece(brief, input.strategy, videos, images, input.outDir, "mock", log, undefined, input.durationSec));
  }
  const qa: QASummary = {
    reviewed: pieces.length,
    edited: 0,
    regenerated: 0,
    averageScore: 0,
    pieces: pieces.map((p) => ({ format: p.format, title: p.title, action: "pass", score: 0, issues: [] })),
  };
  return { brief, pieces, captions: mockCaptions(brief, pieces), qa, generatedAssets: [], generatedAssetInfos: [] };
}

export async function runPipeline(input: PipelineInput): Promise<ContentPlan> {
  const log = input.log ?? (() => {});
  const videoByFile = new Map(input.assets.filter((a) => a.kind === "video").map((a) => [a.file, a]));

  // Video/montage need ffmpeg; check once so we can warn rather than crash.
  let videoOk = true;
  const needsFfmpeg =
    (input.formats.includes("video") && input.assets.some((a) => a.kind === "video")) ||
    (input.formats.includes("montage") && input.assets.length > 0);
  if (needsFfmpeg) {
    videoOk = await ffmpegAvailable();
    if (!videoOk) log("⚠ ffmpeg not found — skipping video/montage. Install ffmpeg or the ffmpeg-static package.");
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

  // Render pool = uploaded images + any photos the Asset Planner generated.
  const imageByFile = new Map(
    [...input.assets.filter((a) => a.kind === "image"), ...(plans.generatedAssetInfos ?? [])].map((a) => [a.file, a]),
  );

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

    if (plan.montagePlan) {
      const sources = new Map(input.assets.map((a) => [a.file, a]));
      const rel = join("images", `${pi + 1}-montage.mp4`);
      const coverRel = join("images", `${pi + 1}-montage-cover.jpg`);
      log(`   • stitching montage — ${plan.montagePlan.segments.length} segments`);
      const res = await renderMontage(
        sources,
        plan.montagePlan,
        plans.brief.brandKit,
        join(input.outDir, rel),
        join(input.outDir, coverRel),
        input.durationSec,
        plans.brief.captionStyle,
      );
      log(`     rendered ${res.durationSec.toFixed(1)}s combined video`);
      rendered.push({ plan, caption, images: [], video: rel, cover: coverRel });
      continue;
    }

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
        input.durationSec,
        plans.brief.captionStyle,
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
      await renderSlide(asset, slide, plans.brief.brandKit, join(input.outDir, rel), plans.brief.captionStyle);
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
    generatedAssets: plans.generatedAssets ?? [],
  };
}
