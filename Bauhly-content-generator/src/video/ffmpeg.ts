import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function resolveFfmpeg(): string | null {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const mod = require("ffmpeg-static");
    const p = (mod?.default ?? mod) as string;
    if (typeof p === "string" && existsSync(p)) return p;
  } catch {
    /* not installed — fall through to PATH */
  }
  return "ffmpeg"; // rely on PATH (e.g. a system/homebrew ffmpeg)
}

export const FFMPEG_BIN = resolveFfmpeg();

export class FfmpegError extends Error {}

export function ffmpeg(args: string[]): Promise<string> {
  if (!FFMPEG_BIN) {
    return Promise.reject(new FfmpegError("ffmpeg binary not found. Install ffmpeg or the ffmpeg-static package."));
  }
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) reject(new FfmpegError(`ffmpeg failed:\n${stderr || err.message}`));
      else resolve(stdout || stderr);
    });
  });
}

/** Run `ffmpeg -i <input>` and return stderr regardless of exit code (used for probing). */
export function ffmpegInspect(input: string): Promise<string> {
  if (!FFMPEG_BIN) return Promise.reject(new FfmpegError("ffmpeg binary not found."));
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_BIN, ["-hide_banner", "-i", input], { maxBuffer: 1024 * 1024 * 16 }, (err, stdout, stderr) => {
      // `-i` with no output always exits non-zero but prints stream info to stderr.
      if (stderr) resolve(stderr);
      else reject(new FfmpegError(`Could not inspect ${input}: ${err?.message ?? "no output"}`));
    });
  });
}

/** True if the ffmpeg binary is usable. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await ffmpeg(["-version"]);
    return true;
  } catch {
    return false;
  }
}
