// Deterministic, no-API fallback so the pipeline always produces output.
// Mirrors what the Claude-backed agents return, using simple heuristics.

import { FORMAT_DEFAULT_RATIO } from "./config.js";
import type {
  AssetInfo,
  Caption,
  CropStrategy,
  IGFormat,
  PiecePlan,
  SlidePlan,
  StrategyBrief,
  VideoEditPlan,
} from "./types.js";

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

export function mockStrategy(strategy: string): StrategyBrief {
  const lower = strategy.toLowerCase();
  const warm = /warm|coffee|cozy|artisan|hospitality|bak/.test(lower);
  return {
    brandName: "Your Brand",
    audience: strategy.slice(0, 120).trim() || "Young, design-conscious urban professionals",
    tone: warm ? "warm, confident, inviting" : "clean, bold, modern",
    contentPillars: ["Behind the scenes", "Product spotlight", "Customer stories", "Tips & education"],
    hashtags: [
      "instadaily", "brandstory", "smallbusiness", "madewithlove", "shoplocal",
      "designinspo", "lifestyle", "community", "newdrop", "supportlocal",
    ],
    cta: "Visit us and tag a friend who needs this.",
    brandKit: warm
      ? { primaryColor: "#5A3E2B", secondaryColor: "#C9A56A", accentColor: "#E4572E", textColor: "#FFF8F0", mood: "warm minimal" }
      : { primaryColor: "#1A1A2E", secondaryColor: "#4361EE", accentColor: "#F72585", textColor: "#FFFFFF", mood: "bold modern" },
  };
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function slide(asset: AssetInfo, format: IGFormat, role: string, crop: CropStrategy, overlay?: SlidePlan["overlay"]): SlidePlan {
  return {
    assetFile: asset.file,
    aspectRatio: FORMAT_DEFAULT_RATIO[format],
    role,
    crop,
    adjustments: { brightness: 1.03, saturation: 1.08, contrast: 1.05, warmth: 12 },
    overlay,
  };
}

export function mockPieces(
  brief: StrategyBrief,
  assets: AssetInfo[],
  formats: IGFormat[],
): PiecePlan[] {
  return formats.map((format, fi) => {
    if (format === "carousel") {
      const n = Math.min(Math.max(assets.length, 3), 5);
      const slides: SlidePlan[] = [];
      for (let i = 0; i < n; i++) {
        const asset = pick(assets, i);
        if (i === 0) {
          slides.push(slide(asset, format, "hook", "attention", {
            headline: pick(brief.contentPillars, fi),
            subtext: brief.tone,
            position: "bottom",
          }));
        } else if (i === n - 1) {
          slides.push(slide(asset, format, "cta", "center", {
            headline: "Come say hi",
            subtext: brief.cta,
            position: "center",
          }));
        } else {
          slides.push(slide(asset, format, `slide ${i + 1}`, "entropy"));
        }
      }
      return { format, title: `${brief.brandName} carousel`, concept: `A ${n}-slide story around "${pick(brief.contentPillars, fi)}".`, slides };
    }

    const asset = pick(assets, fi);
    const overlay = format === "reel"
      ? { headline: titleCase(pick(brief.contentPillars, fi)), subtext: "Watch till the end", position: "center" as const }
      : { headline: titleCase(pick(brief.contentPillars, fi)), subtext: brief.cta, position: "bottom" as const };
    return {
      format,
      title: `${brief.brandName} ${format}`,
      concept: `A single ${format} highlighting "${pick(brief.contentPillars, fi)}".`,
      slides: [slide(asset, format, format === "reel" ? "cover" : "main", "attention", overlay)],
    };
  });
}

export function mockVideoPlan(brief: StrategyBrief, video: AssetInfo): VideoEditPlan {
  const dur = video.durationSec && video.durationSec > 0 ? video.durationSec : 15;
  // Split the clip into up to 3 evenly-spaced ~4s highlight windows.
  const n = dur >= 12 ? 3 : dur >= 6 ? 2 : 1;
  const win = Math.min(4, dur / n);
  const segments = Array.from({ length: n }, (_, i) => {
    const start = (i / n) * dur;
    return { startSec: start, endSec: Math.min(dur, start + win), speed: 1, label: `highlight ${i + 1}` };
  });
  return {
    sourceFile: video.file,
    concept: `A fast-cut vertical edit of ${video.file} around "${brief.contentPillars[0]}".`,
    targetAspect: "9:16",
    targetDurationSec: Math.min(30, Math.round(win * n)),
    hook: brief.contentPillars[0] ?? "Watch this",
    musicMood: "upbeat",
    segments,
    overlays: [
      { text: brief.brandName, atSec: 0.2, durationSec: 2.4, position: "top" },
      { text: brief.cta, atSec: Math.max(0, win * n - 3), durationSec: 3, position: "bottom" },
    ],
  };
}

export function mockCaptions(brief: StrategyBrief, pieces: PiecePlan[]): Caption[] {
  return pieces.map((p, i) => ({
    hook: `${pick(brief.contentPillars, i)} — the way it should be.`,
    body: `${p.concept} Crafted for ${brief.audience.toLowerCase()}. This is what ${brief.brandName} is all about.`,
    cta: brief.cta,
    hashtags: brief.hashtags,
  }));
}
