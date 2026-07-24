import type { AspectRatio, IGFormat } from "./types.js";

export const MODEL = process.env.MODEL || "claude-opus-4-8";

/** Force the offline deterministic pipeline (no API calls). */
export const FORCE_MOCK = process.env.MOCK === "1";

/** Output pixel dimensions per Instagram aspect ratio. */
export const RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/** How many slides each format should contain (guidance for the planner). */
export const FORMAT_SLIDE_GUIDANCE: Record<IGFormat, string> = {
  post: "exactly 1 slide (a single square or 4:5 image)",
  carousel: "3 to 5 slides that tell a sequential story (hook slide first, CTA slide last)",
  reel: "exactly 1 slide: a vertical 9:16 cover frame for the reel",
  video: "an edited short-form vertical video built from the uploaded clip",
};

/** Default aspect ratio hint per format. */
export const FORMAT_DEFAULT_RATIO: Record<IGFormat, AspectRatio> = {
  post: "4:5",
  carousel: "4:5",
  reel: "9:16",
  video: "9:16",
};

/** Formats that consume image assets vs the one that consumes a video asset. */
export const IMAGE_FORMATS: IGFormat[] = ["post", "carousel", "reel"];
export const VIDEO_FORMATS: IGFormat[] = ["video"];

export const SUPPORTED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const SUPPORTED_VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);

/** How many frames to sample from a video for the Director to "watch". */
export const VIDEO_SAMPLE_FRAMES = 8;
/** Output pixel size for edited vertical video. */
export const VIDEO_OUT = { width: 1080, height: 1920, fps: 30 };
