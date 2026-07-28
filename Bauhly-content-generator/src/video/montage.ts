import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { VIDEO_OUT } from "../config.js";
import { ffmpeg } from "./ffmpeg.js";
import { probeVideo } from "./probe.js";
import { buildBaseVideo, burnOverlays, coverFrame, TRANSITION, X264, AAC, type RenderVideoResult } from "./editor.js";
import { DEFAULT_CAPTION_STYLE } from "../captionStyle.js";
import type { AssetInfo, BrandKit, CaptionStyle, MontagePlan, MontageSegment } from "../types.js";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Rescale montage segment lengths so the final video lands near `target` seconds. */
export function fitMontageToDuration(plan: MontagePlan, target: number, sources: Map<string, AssetInfo>): MontagePlan {
  if (!target || target <= 0 || plan.segments.length === 0) return plan;
  const overhead = (plan.segments.length - 1) * TRANSITION;
  const eff = (s: MontageSegment) =>
    s.kind === "video" ? ((s.endSec ?? 0) - (s.startSec ?? 0)) / (s.speed || 1) : s.durationSec ?? 2.5;
  const cur = plan.segments.reduce((t, s) => t + eff(s), 0);
  if (cur <= 0) return plan;
  const f = (target + overhead) / cur;
  for (const s of plan.segments) {
    if (s.kind === "video") {
      const srcDur = sources.get(s.sourceFile)?.durationSec ?? Infinity;
      const start = s.startSec ?? 0;
      let end = start + ((s.endSec ?? start + 4) - start) * f;
      if (end > srcDur) end = srcDur;
      if (end - start < 0.4) end = Math.min(srcDur, start + 0.4);
      s.endSec = end;
    } else {
      s.durationSec = clamp((s.durationSec ?? 2.5) * f, 1.0, 6);
    }
  }
  return plan;
}

/** Clamp montage segments against the real assets; drop anything unusable. */
export function sanitizeMontage(plan: MontagePlan, sources: Map<string, AssetInfo>): MontagePlan {
  const segments: MontageSegment[] = [];
  for (const s of plan.segments ?? []) {
    const src = sources.get(s.sourceFile);
    if (!src) continue;
    if (src.kind === "video") {
      const dur = src.durationSec ?? 0;
      const start = clamp(s.startSec ?? 0, 0, Math.max(0, dur - 0.3));
      const end = clamp(s.endSec ?? start + 4, start + 0.4, dur || start + 4);
      if (end - start < 0.4) continue;
      segments.push({ sourceFile: s.sourceFile, kind: "video", startSec: start, endSec: end, speed: clamp(s.speed || 1, 0.5, 2), label: s.label || "clip" });
    } else {
      segments.push({ sourceFile: s.sourceFile, kind: "photo", durationSec: clamp(s.durationSec ?? 2.5, 1.5, 5), label: s.label || "photo" });
    }
  }
  // Fallback: if the plan was unusable, sequence every asset once.
  if (segments.length === 0) {
    for (const src of sources.values()) {
      if (src.kind === "video") segments.push({ sourceFile: src.file, kind: "video", startSec: 0, endSec: Math.min(src.durationSec ?? 4, 4), speed: 1, label: "clip" });
      else segments.push({ sourceFile: src.file, kind: "photo", durationSec: 2.5, label: "photo" });
    }
  }
  return { ...plan, segments };
}

const SILENT = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];

/** Normalise one montage segment (video cut or photo still) to an identical clip with audio. */
async function normalizeSegment(seg: MontageSegment, src: AssetInfo, out: string): Promise<void> {
  const { width: W, height: H, fps } = VIDEO_OUT;

  if (seg.kind === "photo") {
    const dur = seg.durationSec ?? 2.5;
    const frames = Math.round(dur * fps);
    const bigW = Math.round(W * 1.3), bigH = Math.round(H * 1.3);
    // Ken Burns: slow zoom over the still, with a silent audio track.
    const vf =
      `scale=${bigW}:${bigH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${bigW}:${bigH},` +
      `zoompan=z='min(zoom+0.0007,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1,format=yuv420p`;
    await ffmpeg([
      "-y", "-loop", "1", "-t", String(dur), "-i", src.absPath, ...SILENT,
      "-vf", vf, "-map", "0:v", "-map", "1:a",
      ...X264, "-r", String(fps), ...AAC, "-ac", "2", "-t", String(dur), out,
    ]);
    return;
  }

  const start = seg.startSec ?? 0;
  const dur = (seg.endSec ?? start + 4) - start;
  const speed = seg.speed ?? 1;
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setpts=PTS/${speed},fps=${fps},setsar=1,format=yuv420p`;
  const hasAudio = src.hasAudio ?? false;
  if (hasAudio) {
    await ffmpeg([
      "-y", "-ss", String(start), "-t", String(dur), "-i", src.absPath,
      "-vf", vf, "-af", `atempo=${speed}`, "-map", "0:v", "-map", "0:a",
      ...X264, "-r", String(fps), ...AAC, "-ac", "2", out,
    ]);
  } else {
    await ffmpeg([
      "-y", "-ss", String(start), "-t", String(dur), "-i", src.absPath, ...SILENT,
      "-vf", vf, "-map", "0:v", "-map", "1:a",
      ...X264, "-r", String(fps), ...AAC, "-ac", "2", "-shortest", out,
    ]);
  }
}

/**
 * Stitch many videos + photos into ONE vertical video with crossfade transitions
 * and burned-in hook/overlays.
 */
export async function renderMontage(
  sources: Map<string, AssetInfo>,
  plan: MontagePlan,
  kit: BrandKit,
  outVideoPath: string,
  outCoverPath: string,
  targetDurationSec?: number,
  captionStyle: CaptionStyle = DEFAULT_CAPTION_STYLE,
): Promise<RenderVideoResult> {
  const workDir = join(outVideoPath, "..", ".montage-work");
  await mkdir(workDir, { recursive: true });

  const segFiles: string[] = [];
  for (let i = 0; i < plan.segments.length; i++) {
    const seg = plan.segments[i];
    const src = sources.get(seg.sourceFile);
    if (!src) continue;
    const out = join(workDir, `seg_${String(i).padStart(2, "0")}.mp4`);
    await normalizeSegment(seg, src, out);
    segFiles.push(out);
  }

  const base = await buildBaseVideo(segFiles, workDir, true);
  const baseDur = (await probeVideo(base)).durationSec || 0;
  const cap = targetDurationSec && targetDurationSec > 0 ? targetDurationSec : undefined;
  const outDur = cap && baseDur > cap ? cap : baseDur;
  await burnOverlays(base, plan.hook, plan.overlays, kit, outDur, workDir, true, outVideoPath, cap && baseDur > cap ? cap : undefined, captionStyle);
  await coverFrame(outVideoPath, outDur, outCoverPath);

  await rm(workDir, { recursive: true, force: true });
  return { video: outVideoPath, cover: outCoverPath, durationSec: outDur };
}
