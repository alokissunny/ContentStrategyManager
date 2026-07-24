import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { FORCE_MOCK, IMAGE_FORMATS, MODEL, VIDEO_SAMPLE_FRAMES } from "./config.js";
import { NoCredentialsError } from "./anthropic.js";
import { runStrategyAgent } from "./agents/strategyAgent.js";
import { runCreativeDirector } from "./agents/creativeDirector.js";
import { runCopywriter } from "./agents/copywriter.js";
import { runVideoDirector } from "./agents/videoDirector.js";
import { mockCaptions, mockPieces, mockStrategy, mockVideoPlan } from "./mock.js";
import { renderSlide } from "./imageEditor.js";
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
): Promise<PiecePlan> {
  if (engine === "mock") {
    const plan = sanitizePlan(mockVideoPlan(brief, video), video.durationSec ?? 15);
    return { format: "video", title: `${brief.brandName} reel`, concept: plan.concept, videoPlan: plan };
  }

  log("→ Video Director Agent: sampling frames and watching the clip…");
  const framesDir = join(outDir, ".frames");
  const meta = await probeVideo(video.absPath);
  const frames = await sampleFrames(video.absPath, meta.durationSec, VIDEO_SAMPLE_FRAMES, framesDir);
  const raw = await runVideoDirector(brief, strategy, frames, meta, video.file);
  await rm(framesDir, { recursive: true, force: true });
  const plan = sanitizePlan(raw, meta.durationSec);
  return { format: "video", title: `${brief.brandName} reel`, concept: plan.concept, videoPlan: plan };
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
  return { brief, pieces, captions };
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
  return { brief, pieces, captions: mockCaptions(brief, pieces) };
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

  let engine: "claude" | "mock" = "claude";
  let plans: Plans;
  if (FORCE_MOCK) {
    log("MOCK=1 set — running the offline deterministic pipeline.");
    engine = "mock";
    plans = await runMockPlans(input, videoOk);
  } else {
    try {
      plans = await runClaudePlans(input, videoOk);
    } catch (err) {
      if (err instanceof NoCredentialsError) {
        log(`⚠ ${err.message}`);
        engine = "mock";
        plans = await runMockPlans(input, videoOk);
      } else {
        throw err;
      }
    }
  }

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

  return {
    strategyInput: input.strategy,
    brief: plans.brief,
    pieces: rendered,
    generatedAt: new Date().toISOString(),
    engine,
    model: engine === "claude" ? MODEL : "offline-mock",
  };
}
