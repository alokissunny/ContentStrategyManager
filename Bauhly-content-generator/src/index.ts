import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load a local .env (e.g. ANTHROPIC_API_KEY) if present — no dependency needed.
if (existsSync(resolve(".env")) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(resolve(".env"));
}
import { loadAssets } from "./assets.js";
import { runPipeline } from "./orchestrator.js";
import { buildPreviewHtml } from "./preview.js";
import type { IGFormat } from "./types.js";

interface Args {
  strategy?: string;
  strategyFile?: string;
  assets: string;
  formats: IGFormat[];
  formatsExplicit: boolean;
  out: string;
}

const VALID_FORMATS = new Set<IGFormat>(["post", "carousel", "reel", "video"]);

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { assets: "./sample-assets", out: "./output", formats: [], formatsExplicit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--strategy": out.strategy = next(); break;
      case "--strategy-file": out.strategyFile = next(); break;
      case "--assets": out.assets = next(); break;
      case "--out": out.out = next(); break;
      case "--formats":
        out.formats = next()
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is IGFormat => VALID_FORMATS.has(s as IGFormat));
        out.formatsExplicit = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
    }
  }
  return out as Args;
}

function printHelp(): void {
  console.log(`
Bauhly Content Generator — multi-agent Instagram content from a strategy + your photos.

Usage:
  npm run generate -- --strategy "<your strategy>" --assets ./media --formats post,carousel,reel,video

Options:
  --strategy <text>       High-level strategy prose.
  --strategy-file <path>  Read the strategy from a text file instead.
  --assets <dir>          Folder of source photos (jpg/png/webp) and/or videos (mp4/mov/m4v/webm).
  --formats <list>        Comma list of: post,carousel,reel,video. Default: inferred from your assets.
  --out <dir>             Output folder. Default ./output
  -h, --help              Show this help.

Credentials: set ANTHROPIC_API_KEY or run \`ant auth login\`. Without either,
the generator runs a deterministic offline pipeline so you still get output.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let strategy = args.strategy;
  if (!strategy && args.strategyFile) {
    strategy = (await readFile(args.strategyFile, "utf8")).trim();
  }
  if (!strategy) {
    console.error("Error: provide --strategy \"...\" or --strategy-file <path>.\n");
    printHelp();
    process.exit(1);
  }
  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const assets = await loadAssets(args.assets);

  // Derive sensible formats from the asset types when not specified.
  let formats = args.formats;
  if (!args.formatsExplicit) {
    const hasImage = assets.some((a) => a.kind === "image");
    const hasVideo = assets.some((a) => a.kind === "video");
    formats = [];
    if (hasImage) formats.push("post", "carousel", "reel");
    if (hasVideo) formats.push("video");
  }
  if (formats.length === 0) {
    console.error("Error: no valid formats. Use --formats post,carousel,reel,video");
    process.exit(1);
  }

  console.log(`\n🎨 Bauhly Content Generator`);
  console.log(`   assets:  ${resolve(args.assets)}`);
  console.log(`   formats: ${formats.join(", ")}`);
  console.log(`   output:  ${outDir}\n`);

  const kinds = assets.reduce((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {} as Record<string, number>);
  console.log(`Loaded ${assets.length} asset(s) [${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(", ")}]: ${assets.map((a) => a.file).join(", ")}\n`);

  const plan = await runPipeline({
    strategy,
    assets,
    formats,
    outDir,
    log: (m) => console.log(m),
  });

  await writeFile(resolve(outDir, "content-plan.json"), JSON.stringify(plan, null, 2));
  await writeFile(resolve(outDir, "index.html"), buildPreviewHtml(plan));

  const totalImages = plan.pieces.reduce((n, p) => n + p.images.length, 0);
  const totalVideos = plan.pieces.filter((p) => p.video).length;
  console.log(`\n✅ Done — ${plan.pieces.length} pieces, ${totalImages} images, ${totalVideos} video(s) (engine: ${plan.engine}).`);
  console.log(`   Preview:  ${resolve(outDir, "index.html")}`);
  console.log(`   Plan:     ${resolve(outDir, "content-plan.json")}\n`);
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
