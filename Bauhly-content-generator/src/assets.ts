import { readdir } from "node:fs/promises";
import { extname, join, resolve, basename } from "node:path";
import sharp from "sharp";
import { SUPPORTED_IMAGE_EXT, SUPPORTED_VIDEO_EXT } from "./config.js";
import { probeVideo } from "./video/probe.js";
import type { AssetInfo } from "./types.js";

const MEDIA_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

/** Load every supported image and video in `dir` with basic metadata. */
export async function loadAssets(dir: string): Promise<AssetInfo[]> {
  const absDir = resolve(dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    throw new Error(`Assets directory not found: ${absDir}`);
  }

  const assets: AssetInfo[] = [];
  for (const name of entries.sort()) {
    const ext = extname(name).toLowerCase();
    const absPath = join(absDir, name);

    if (SUPPORTED_IMAGE_EXT.has(ext)) {
      const meta = await sharp(absPath).metadata();
      assets.push({
        file: basename(name),
        absPath,
        mediaType: MEDIA_TYPE[ext] ?? "image/jpeg",
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        kind: "image",
      });
    } else if (SUPPORTED_VIDEO_EXT.has(ext)) {
      let width = 0, height = 0, durationSec = 0, hasAudio = false;
      try {
        const v = await probeVideo(absPath);
        ({ width, height, durationSec, hasAudio } = v);
      } catch {
        // Leave zeros; the video pipeline will surface a clearer error later.
      }
      assets.push({
        file: basename(name),
        absPath,
        mediaType: MEDIA_TYPE[ext] ?? "video/mp4",
        width,
        height,
        kind: "video",
        durationSec,
        hasAudio,
      });
    }
  }

  if (assets.length === 0) {
    throw new Error(
      `No supported media found in ${absDir}. Images: ${[...SUPPORTED_IMAGE_EXT].join(", ")}; videos: ${[...SUPPORTED_VIDEO_EXT].join(", ")}`,
    );
  }
  return assets;
}
