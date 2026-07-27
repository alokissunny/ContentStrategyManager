import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { VIDEO_OUT } from "../config.js";
import { ffmpeg } from "./ffmpeg.js";
import { probeVideo } from "./probe.js";
import type { AssetInfo, BrandKit, VideoEditPlan, VideoOverlay } from "../types.js";

/** Crossfade duration (s) between segments and text fade in/out. */
export const TRANSITION = 0.4;
const TEXT_FADE = 0.28;

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

/**
 * Rescale a plan's segment lengths so the final video lands on `target` seconds
 * (accounting for crossfade overhead), clamped to the source's available footage.
 */
export function fitPlanToDuration(plan: VideoEditPlan, target: number, sourceDur: number): VideoEditPlan {
  if (!target || target <= 0 || plan.segments.length === 0) return plan;
  const overhead = (plan.segments.length - 1) * TRANSITION;
  const cur = plan.segments.reduce((t, s) => t + (s.endSec - s.startSec) / (s.speed || 1), 0);
  if (cur <= 0) return plan;
  const f = (target + overhead) / cur;
  for (const s of plan.segments) {
    let end = s.startSec + (s.endSec - s.startSec) * f;
    if (end > sourceDur) end = sourceDur;
    if (end - s.startSec < 0.4) end = Math.min(sourceDur, s.startSec + 0.4);
    s.endSec = end;
  }
  return plan;
}

function drawtext(font: string, textfile: string, fontSize: number, color: string, position: VideoOverlay["position"], a: number, b: number, isHook = false): string {
  const yExpr =
    position === "top" ? "160" :
    position === "bottom" ? "h-text_h-220" :
    "(h-text_h)/2";
  // Fade in/out transition on the text; the hook also slides up ~40px as it enters.
  const f = TEXT_FADE.toFixed(2);
  const A = a.toFixed(2), B = b.toFixed(2);
  const alpha = `max(0\\,min(1\\,min((t-${A})/${f}\\,(${B}-t)/${f})))`;
  const yBase = yExpr;
  const y = isHook
    ? `(${yBase})+40*(1-min(1\\,(t-${A})/${f}))`
    : yBase;
  const opts = [
    `fontfile='${font}'`,
    `textfile='${textfile}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `alpha='${alpha}'`,
    `borderw=3`,
    `bordercolor=0x000000`,
    `box=1`,
    `boxcolor=black@0.45`,
    `boxborderw=28`,
    `line_spacing=14`,
    `x=(w-text_w)/2`,
    `y=${y}`,
    `expansion=none`,
    `enable='between(t\\,${A}\\,${B})'`,
  ];
  return `drawtext=${opts.join(":")}`;
}

/**
 * Join normalised clips with crossfade (xfade) transitions. Falls back to a
 * hard-cut concat if xfade fails or there's only one clip.
 */
export async function buildBaseVideo(
  segFiles: string[],
  workDir: string,
  hasAudio: boolean,
): Promise<string> {
  const concatCopy = async (): Promise<string> => {
    const listPath = join(workDir, "list.txt");
    await writeFile(listPath, segFiles.map((f) => `file '${f}'`).join("\n"));
    const out = join(workDir, "base.mp4");
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", out]);
    return out;
  };

  if (segFiles.length < 2) return concatCopy();

  try {
    const durs: number[] = [];
    for (const f of segFiles) durs.push((await probeVideo(f)).durationSec || 1);
    let D = TRANSITION;
    const minDur = Math.min(...durs);
    if (minDur <= D * 2) D = Math.max(0.15, minDur * 0.4);

    const inputs = segFiles.flatMap((f) => ["-i", f]);
    const vParts: string[] = [];
    const aParts: string[] = [];
    let prevV = "0:v";
    let prevA = "0:a";
    let running = durs[0];
    for (let i = 1; i < segFiles.length; i++) {
      const offset = running - D;
      const last = i === segFiles.length - 1;
      const outV = last ? "vout" : `v${i}`;
      vParts.push(`[${prevV}][${i}:v]xfade=transition=fade:duration=${D.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`);
      prevV = outV;
      if (hasAudio) {
        const outA = last ? "aout" : `a${i}`;
        aParts.push(`[${prevA}][${i}:a]acrossfade=d=${D.toFixed(3)}[${outA}]`);
        prevA = outA;
      }
      running = running + durs[i] - D;
    }
    const filter = [...vParts, ...aParts].join(";");
    const out = join(workDir, "base.mp4");
    const args = ["-y", ...inputs, "-filter_complex", filter, "-map", "[vout]"];
    if (hasAudio) args.push("-map", "[aout]", "-c:a", "aac", "-ar", "44100");
    args.push("-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out);
    await ffmpeg(args);
    return out;
  } catch {
    return concatCopy();
  }
}

/**
 * Burn the hook + timed overlays onto a base video. The hook plays first, then
 * the overlays, de-duplicated and forced to play SEQUENTIALLY, each with a fade.
 */
export async function burnOverlays(
  baseVideo: string,
  hook: string | undefined,
  overlays: VideoOverlay[],
  kit: BrandKit,
  outDur: number,
  workDir: string,
  hasAudio: boolean,
  outPath: string,
  maxDur?: number,
): Promise<void> {
  const trim = maxDur && maxDur > 0 ? ["-t", String(maxDur)] : [];
  const font = findFont();
  const color = hexToFf(kit.textColor);
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^\w\s]/g, "");

  const requested: Array<VideoOverlay & { isHook?: boolean }> = [];
  const hookText = hook?.trim();
  if (hookText) requested.push({ text: hookText, atSec: 0, durationSec: 2.4, position: "center", isHook: true });
  for (const o of overlays ?? []) {
    if (!o.text?.trim()) continue;
    if (hookText && norm(o.text) === norm(hookText)) continue;
    requested.push(o);
  }
  requested.sort((a, b) => a.atSec - b.atSec);

  const placed: Array<{ text: string; a: number; b: number; isHook?: boolean; position: VideoOverlay["position"] }> = [];
  let cursor = 0;
  for (const o of requested) {
    const a = clamp(Math.max(o.atSec, cursor), 0, outDur);
    const b = clamp(a + (o.durationSec || 2.2), a + 0.4, outDur);
    if (b - a < 0.4) continue;
    placed.push({ text: o.text, a, b, isHook: o.isHook, position: o.position });
    cursor = b;
  }

  if (font && placed.length) {
    const parts: string[] = [];
    for (let i = 0; i < placed.length; i++) {
      const o = placed[i];
      const tf = join(workDir, `text_${i}.txt`);
      await writeFile(tf, wrap(o.text, o.isHook ? 18 : 26));
      parts.push(drawtext(font, tf, o.isHook ? 78 : 54, color, o.position, o.a, o.b, o.isHook));
    }
    const args = ["-y", "-i", baseVideo, "-vf", parts.join(","), ...trim, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    if (hasAudio) args.push(...(trim.length ? ["-c:a", "aac", "-ar", "44100"] : ["-c:a", "copy"]));
    args.push("-movflags", "+faststart", outPath);
    await ffmpeg(args);
  } else if (trim.length) {
    // No overlays but a duration cap: trim (re-encode for a precise cut).
    const args = ["-y", "-i", baseVideo, ...trim, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    if (hasAudio) args.push("-c:a", "aac", "-ar", "44100");
    args.push("-movflags", "+faststart", outPath);
    await ffmpeg(args);
  } else {
    await ffmpeg(["-y", "-i", baseVideo, "-c", "copy", "-movflags", "+faststart", outPath]);
  }
}

/** Extract a cover/poster frame (near the start, so it shows the hook). */
export async function coverFrame(video: string, outDur: number, outPath: string): Promise<void> {
  const t = Math.min(1.0, Math.max(0.2, outDur / 2));
  await ffmpeg(["-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-q:v", "3", outPath]);
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
  targetDurationSec?: number,
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

  // 2. Join the clips with crossfade transitions (falls back to hard cuts).
  const base = await buildBaseVideo(segFiles, workDir, hasAudio);
  const baseDur = (await probeVideo(base)).durationSec || outputDuration(plan);

  // Enforce the requested duration: hard-trim if the join overshoots the target.
  const cap = targetDurationSec && targetDurationSec > 0 ? targetDurationSec : undefined;
  const outDur = cap && baseDur > cap ? cap : baseDur;

  // 3. Burn the hook + overlays (trimming to the target), then grab a cover frame.
  await burnOverlays(base, plan.hook, plan.overlays, kit, outDur, workDir, hasAudio, outVideoPath, cap && baseDur > cap ? cap : undefined);
  await coverFrame(outVideoPath, outDur, outCoverPath);

  await rm(workDir, { recursive: true, force: true });
  return { video: outVideoPath, cover: outCoverPath, durationSec: outDur };
}
