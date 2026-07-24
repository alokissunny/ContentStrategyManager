import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VIDEO_OUT } from "../config.js";
import { ffmpeg } from "./ffmpeg.js";
import type { AssetInfo, BrandKit, VideoEditPlan, VideoOverlay } from "../types.js";

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

function findFont(): string | null {
  for (const f of FONT_CANDIDATES) if (existsSync(f)) return f;
  return null;
}

function hexToFf(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? `0x${m[1].toUpperCase()}` : "0xFFFFFF";
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function wrap(text: string, maxChars: number): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Normalise the plan's segment/overlay times against the real clip duration. */
export function sanitizePlan(plan: VideoEditPlan, durationSec: number): VideoEditPlan {
  let segments = plan.segments
    .map((s) => ({
      startSec: clamp(s.startSec, 0, Math.max(0, durationSec - 0.2)),
      endSec: clamp(s.endSec, 0, durationSec),
      speed: clamp(s.speed || 1, 0.5, 2),
      label: s.label || "moment",
    }))
    .filter((s) => s.endSec - s.startSec >= 0.4)
    .slice(0, 6);
  if (segments.length === 0) {
    // Fallback: keep the first ~15s (or whole clip).
    segments = [{ startSec: 0, endSec: Math.min(durationSec, 15), speed: 1, label: "full clip" }];
  }
  return { ...plan, segments };
}

/** Output duration after cuts + speed changes. */
export function outputDuration(plan: VideoEditPlan): number {
  return plan.segments.reduce((t, s) => t + (s.endSec - s.startSec) / s.speed, 0);
}

function drawtext(font: string, textfile: string, fontSize: number, color: string, position: VideoOverlay["position"], a: number, b: number): string {
  const yExpr =
    position === "top" ? "160" :
    position === "bottom" ? "h-text_h-220" :
    "(h-text_h)/2";
  const opts = [
    `fontfile='${font}'`,
    `textfile='${textfile}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `borderw=3`,
    `bordercolor=0x000000`,
    `box=1`,
    `boxcolor=black@0.45`,
    `boxborderw=28`,
    `line_spacing=14`,
    `x=(w-text_w)/2`,
    `y=${yExpr}`,
    `expansion=none`,
    `enable='between(t\\,${a.toFixed(2)}\\,${b.toFixed(2)})'`,
  ];
  return `drawtext=${opts.join(":")}`;
}

export interface RenderVideoResult {
  video: string; // abs path
  cover: string; // abs path
  durationSec: number;
}

/**
 * Render the edit plan into a vertical MP4 + cover frame.
 * Pipeline: per-segment normalise (cut + crop 9:16 + speed) → concat → burn overlays → cover.
 */
export async function renderVideo(
  source: AssetInfo,
  plan: VideoEditPlan,
  kit: BrandKit,
  outVideoPath: string,
  outCoverPath: string,
): Promise<RenderVideoResult> {
  const { width: W, height: H, fps } = VIDEO_OUT;
  const hasAudio = source.hasAudio ?? false;
  const workDir = join(outVideoPath, "..", ".video-work");
  await mkdir(workDir, { recursive: true });

  // 1. Normalise each kept segment into an identical clip so concat can copy.
  const segFiles: string[] = [];
  for (let i = 0; i < plan.segments.length; i++) {
    const s = plan.segments[i];
    const dur = s.endSec - s.startSec;
    const segOut = join(workDir, `seg_${String(i).padStart(2, "0")}.mp4`);
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=PTS/${s.speed},fps=${fps}`;
    const args = ["-y", "-ss", String(s.startSec), "-t", String(dur), "-i", source.absPath, "-vf", vf];
    if (hasAudio) {
      args.push("-af", `atempo=${s.speed}`, "-c:a", "aac", "-ar", "44100");
    } else {
      args.push("-an");
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(fps), segOut);
    await ffmpeg(args);
    segFiles.push(segOut);
  }

  // 2. Concat the normalised clips.
  const listPath = join(workDir, "list.txt");
  await writeFile(listPath, segFiles.map((f) => `file '${f}'`).join("\n"));
  const concatOut = join(workDir, "concat.mp4");
  await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatOut]);

  const outDur = outputDuration(plan);

  // 3. Build the overlay chain: hook first, then the director's overlays,
  //    de-duplicated and forced to play SEQUENTIALLY (no two on screen at once).
  const font = findFont();
  const color = hexToFf(kit.textColor);
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, "");

  const requested: Array<VideoOverlay & { isHook?: boolean }> = [];
  const hookText = plan.hook?.trim();
  if (hookText) requested.push({ text: hookText, atSec: 0, durationSec: 2.4, position: "center", isHook: true });
  for (const o of plan.overlays ?? []) {
    if (!o.text?.trim()) continue;
    if (hookText && norm(o.text) === norm(hookText)) continue; // drop hook duplicates
    requested.push(o);
  }
  requested.sort((a, b) => a.atSec - b.atSec);

  // Sequential placement: each overlay starts at or after the previous one ends.
  const placed: Array<{ text: string; a: number; b: number; isHook?: boolean; position: VideoOverlay["position"] }> = [];
  let cursor = 0;
  for (const o of requested) {
    const a = clamp(Math.max(o.atSec, cursor), 0, outDur);
    const b = clamp(a + (o.durationSec || 2.2), a + 0.4, outDur);
    if (b - a < 0.4) continue; // no room left
    placed.push({ text: o.text, a, b, isHook: o.isHook, position: o.position });
    cursor = b;
  }

  let finalSource = concatOut;
  if (font && placed.length) {
    const parts: string[] = [];
    for (let i = 0; i < placed.length; i++) {
      const o = placed[i];
      const tf = join(workDir, `text_${i}.txt`);
      await writeFile(tf, wrap(o.text, o.isHook ? 18 : 26));
      parts.push(drawtext(font, tf, o.isHook ? 78 : 54, color, o.position, o.a, o.b));
    }
    const vf = parts.join(",");
    const args = ["-y", "-i", concatOut, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    if (hasAudio) args.push("-c:a", "copy");
    args.push("-movflags", "+faststart", outVideoPath);
    await ffmpeg(args);
    finalSource = outVideoPath;
  } else {
    // No font available or no overlays — just finalise the concat.
    const args = ["-y", "-i", concatOut, "-c", "copy", "-movflags", "+faststart", outVideoPath];
    await ffmpeg(args);
    finalSource = outVideoPath;
  }

  // 4. Cover frame from the edited video (so it shows the burned-in hook).
  const coverT = Math.min(1.0, Math.max(0.2, outDur / 2));
  await ffmpeg(["-y", "-ss", String(coverT), "-i", finalSource, "-frames:v", "1", "-q:v", "3", outCoverPath]);

  await rm(workDir, { recursive: true, force: true });
  return { video: outVideoPath, cover: outCoverPath, durationSec: outDur };
}
