import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssets } from "./assets.js";
import { runPipeline } from "./orchestrator.js";
import { buildPreviewHtml } from "./preview.js";
import { SUPPORTED_IMAGE_EXT, SUPPORTED_VIDEO_EXT } from "./config.js";
import type { IGFormat } from "./types.js";

// Load a local .env (ANTHROPIC_API_KEY) if present.
if (existsSync(resolve(".env")) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(resolve(".env"));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, "..", "web");
const RUNS_DIR = resolve("runs");
const PORT = Number(process.env.PORT || 5178);
const VALID_FORMATS = new Set<IGFormat>(["post", "carousel", "reel", "video"]);

interface JobRequest extends Request {
  jobId?: string;
}

// Create a per-request job directory before multer writes the uploads into it.
function prepareJob(req: JobRequest, _res: Response, next: NextFunction): void {
  req.jobId = randomUUID().slice(0, 8);
  mkdir(join(RUNS_DIR, req.jobId, "uploads"), { recursive: true }).then(() => next()).catch(next);
}

const storage = multer.diskStorage({
  destination: (req: JobRequest, _file, cb) => cb(null, join(RUNS_DIR, req.jobId!, "uploads")),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "_");
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 400 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, SUPPORTED_IMAGE_EXT.has(ext) || SUPPORTED_VIDEO_EXT.has(ext));
  },
});

const app = express();
app.use(express.static(WEB_DIR));
app.use("/runs", express.static(RUNS_DIR));

app.post("/api/generate", prepareJob, upload.array("files"), async (req: JobRequest, res: Response) => {
  const jobId = req.jobId!;
  const outDir = join(RUNS_DIR, jobId);
  const uploadsDir = join(outDir, "uploads");
  try {
    const strategy = String(req.body.strategy || "").trim();
    if (!strategy) return res.status(400).json({ error: "Please write a strategy." });

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) return res.status(400).json({ error: "Please upload at least one photo or video." });

    let formats = String(req.body.formats || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is IGFormat => VALID_FORMATS.has(s as IGFormat));

    const assets = await loadAssets(uploadsDir);
    if (formats.length === 0) {
      const hasImage = assets.some((a) => a.kind === "image");
      const hasVideo = assets.some((a) => a.kind === "video");
      formats = [];
      if (hasImage) formats.push("post", "carousel", "reel");
      if (hasVideo) formats.push("video");
    }

    const logs: string[] = [];
    const plan = await runPipeline({ strategy, assets, formats, outDir, log: (m) => logs.push(m) });

    await writeFile(join(outDir, "content-plan.json"), JSON.stringify(plan, null, 2));
    await writeFile(join(outDir, "index.html"), buildPreviewHtml(plan));

    // Rewrite relative media paths to servable URLs.
    const url = (rel?: string) => (rel ? `/runs/${jobId}/${rel.split(/[\\/]/).join("/")}` : undefined);
    res.json({
      jobId,
      engine: plan.engine,
      model: plan.model,
      usage: plan.usage,
      qa: plan.qa,
      brief: plan.brief,
      previewUrl: `/runs/${jobId}/index.html`,
      pieces: plan.pieces.map((p) => ({
        format: p.plan.format,
        title: p.plan.title,
        concept: p.plan.concept,
        caption: p.caption,
        images: p.images.map((i) => url(i)!),
        video: url(p.video),
        cover: url(p.cover),
        videoPlan: p.plan.videoPlan
          ? { segments: p.plan.videoPlan.segments.length, targetDurationSec: p.plan.videoPlan.targetDurationSec, musicMood: p.plan.videoPlan.musicMood }
          : undefined,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed." });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎨 Bauhly Content Generator UI running at http://localhost:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("(No ANTHROPIC_API_KEY detected — generations will use the offline deterministic engine. Add a key to .env for AI-authored output.)\n");
  }
});
