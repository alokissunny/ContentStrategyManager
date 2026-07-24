import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg } from "./ffmpeg.js";
import type { AssetInfo } from "../types.js";

export interface SampledFrame {
  timeSec: number;
  asset: AssetInfo;
}

/**
 * Extract `count` evenly-spaced frames from a video (downscaled) so the Director
 * agent can "watch" the clip. Frame files encode their timestamp in the name.
 */
export async function sampleFrames(
  videoPath: string,
  durationSec: number,
  count: number,
  workDir: string,
): Promise<SampledFrame[]> {
  await mkdir(workDir, { recursive: true });
  const frames: SampledFrame[] = [];
  const n = Math.max(3, count);
  for (let i = 0; i < n; i++) {
    // Spread samples across the clip, biased slightly inward from the edges.
    const t = durationSec > 0 ? ((i + 0.5) / n) * durationSec : 0;
    const label = t.toFixed(1);
    const out = join(workDir, `frame_${String(i).padStart(2, "0")}_t${label}s.jpg`);
    await ffmpeg([
      "-y",
      "-ss", String(t),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale=640:-2",
      "-q:v", "4",
      out,
    ]);
    frames.push({
      timeSec: t,
      asset: { file: `t=${label}s`, absPath: out, mediaType: "image/jpeg", width: 640, height: 0, kind: "image" },
    });
  }
  return frames;
}
