import { ffmpegInspect } from "./ffmpeg.js";

export interface VideoMeta {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

/** Read duration, dimensions, fps and audio presence by parsing `ffmpeg -i` output. */
export async function probeVideo(absPath: string): Promise<VideoMeta> {
  const info = await ffmpegInspect(absPath);

  let durationSec = 0;
  const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  if (dm) durationSec = Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]);

  const videoLine = /Stream #\d+:\d+.*: Video:.*/.exec(info)?.[0] ?? "";
  let width = 0, height = 0;
  const dim = /(\d{2,5})x(\d{2,5})/.exec(videoLine);
  if (dim) { width = Number(dim[1]); height = Number(dim[2]); }

  let fps = 30;
  const fm = /,\s*([\d.]+)\s*fps/.exec(videoLine) || /,\s*([\d.]+)\s*tbr/.exec(videoLine);
  if (fm) fps = Math.round(Number(fm[1])) || 30;

  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(info);

  return { durationSec, width, height, fps, hasAudio };
}
