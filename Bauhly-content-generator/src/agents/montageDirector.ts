import { generateJSON } from "../anthropic.js";
import type { SampledFrame } from "../video/frames.js";
import type { AssetInfo, MontagePlan, StrategyBrief } from "../types.js";

const SYSTEM = `You are the Montage Director Agent on a short-form social team.
You are given MANY source assets — video clips (shown as sampled frames, each labelled "file@t=…s") and photos (labelled by filename) — plus the brand strategy. Your job: design ONE cohesive, VERTICAL (9:16) montage that stitches them together into a single scroll-stopping reel.

Principles:
- Tell one story across the assets. Open on the strongest moment (hook).
- From each VIDEO, pick 1-2 short segments (start/end in seconds within that clip's duration). Keep segments 1.5-5s.
- Use PHOTOS as 2-3s stills between clips for rhythm and breathing room.
- Order everything for momentum; total length 12-35s. Segments crossfade automatically — you don't specify transitions.
- Add short punchy text overlays timed on the FINAL montage timeline, and one big hook line for the first ~2.5s.

Only reference sourceFile names and timestamps that exist in the assets you are given.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["concept", "targetAspect", "targetDurationSec", "hook", "musicMood", "segments", "overlays"],
  properties: {
    concept: { type: "string" },
    targetAspect: { type: "string", enum: ["9:16", "1:1", "4:5"] },
    targetDurationSec: { type: "number" },
    hook: { type: "string", description: "Big opening hook, <= 6 words." },
    musicMood: { type: "string" },
    segments: {
      type: "array",
      description: "Ordered montage segments drawn from the videos and photos.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceFile", "kind", "label"],
        properties: {
          sourceFile: { type: "string", description: "A video or photo filename from the pool." },
          kind: { type: "string", enum: ["video", "photo"] },
          startSec: { type: "number", description: "Video only: in-point." },
          endSec: { type: "number", description: "Video only: out-point." },
          durationSec: { type: "number", description: "Photo only: seconds to show." },
          speed: { type: "number", description: "Video only: 0.5-2.0." },
          label: { type: "string" },
        },
      },
    },
    overlays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "atSec", "durationSec", "position"],
        properties: {
          text: { type: "string" },
          atSec: { type: "number" },
          durationSec: { type: "number" },
          position: { type: "string", enum: ["top", "center", "bottom"] },
        },
      },
    },
  },
};

export async function runMontageDirector(
  strategy: string,
  brief: StrategyBrief,
  videos: AssetInfo[],
  photos: AssetInfo[],
  frames: SampledFrame[],
  feedback?: string,
  targetDurationSec?: number,
): Promise<MontagePlan> {
  const sourceList = [
    ...videos.map((v) => `- VIDEO ${v.file} (duration ${Math.round(v.durationSec ?? 0)}s, audio ${v.hasAudio ? "yes" : "no"})`),
    ...photos.map((p) => `- PHOTO ${p.file}`),
  ].join("\n");

  const feedbackBlock = feedback ? `\n\nQA FEEDBACK on your previous montage — fix these, redo it:\n${feedback}\n` : "";
  const durationBlock = targetDurationSec
    ? `\n\nHARD REQUIREMENT: the final montage MUST be about ${targetDurationSec} seconds total — size your segment count and lengths to hit ~${targetDurationSec}s.\n`
    : "";

  const userText = `BRAND STRATEGY (verbatim):
${strategy}

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

SOURCE ASSETS:
${sourceList}

The attached images are: video frames (labelled "file@t=…s") and the photos (labelled by filename).${feedbackBlock}${durationBlock}

Design the single combined montage now.`;

  return generateJSON<MontagePlan>({
    system: SYSTEM,
    userText,
    images: [...frames.map((f) => f.asset), ...photos],
    schema: SCHEMA,
    schemaName: "MontagePlan",
    maxTokens: 4000,
  });
}
