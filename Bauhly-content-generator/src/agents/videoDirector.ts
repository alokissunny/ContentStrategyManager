import { generateJSON } from "../anthropic.js";
import type { SampledFrame } from "../video/frames.js";
import type { VideoMeta } from "../video/probe.js";
import type { StrategyBrief, VideoEditPlan } from "../types.js";

const SYSTEM = `You are the Video Director Agent on a short-form social team.
You are shown a handful of frames sampled from the user's uploaded clip; each frame is labelled with its timestamp in seconds (t=…s). Treat those timestamps as your map of the footage.
Your job: design a punchy, VERTICAL (9:16) edit engineered to go viral for the given brand strategy.

Principles:
- Retention first: open on the strongest, most scroll-stopping moment. Front-load payoff.
- Cut ruthlessly: keep only 2-5 segments (start/end in seconds on the ORIGINAL clip timeline). Total edited length 8-30s.
- Use speed (0.5-2.0) to punch up energy or slow down a key beat, sparingly.
- Overlays are timed on the FINAL edited timeline (after your cuts/speed), not the original. Keep them SHORT (headline-style) and readable.
- Give one big hook line for the first ~2.5 seconds.

Only reference timestamps that exist within the clip duration you are told.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["concept", "targetAspect", "targetDurationSec", "hook", "musicMood", "segments", "overlays"],
  properties: {
    concept: { type: "string", description: "One line describing the edit idea." },
    targetAspect: { type: "string", enum: ["9:16", "1:1", "4:5"] },
    targetDurationSec: { type: "number", description: "Intended final length, 8-30." },
    hook: { type: "string", description: "Big opening hook line (<= 6 words)." },
    musicMood: { type: "string", description: "Suggested music/energy, e.g. 'upbeat electronic'." },
    segments: {
      type: "array",
      description: "2-5 kept segments on the ORIGINAL timeline, in final order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startSec", "endSec", "speed", "label"],
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          speed: { type: "number", description: "0.5-2.0, 1 = normal." },
          label: { type: "string" },
        },
      },
    },
    overlays: {
      type: "array",
      description: "Text overlays timed on the FINAL edited timeline.",
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

export async function runVideoDirector(
  brief: StrategyBrief,
  strategy: string,
  frames: SampledFrame[],
  meta: VideoMeta,
  sourceFile: string,
): Promise<VideoEditPlan> {
  const frameList = frames.map((f) => `t=${f.timeSec.toFixed(1)}s`).join(", ");
  const userText = `BRAND STRATEGY (verbatim):
${strategy}

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

SOURCE CLIP: ${sourceFile}
- duration: ${meta.durationSec.toFixed(1)}s
- resolution: ${meta.width}x${meta.height}, ${meta.fps}fps
- audio: ${meta.hasAudio ? "yes" : "no"}

The attached frames are sampled at: ${frameList}

Design the viral vertical edit now.`;

  const plan = await generateJSON<VideoEditPlan>({
    system: SYSTEM,
    userText,
    images: frames.map((f) => f.asset),
    schema: SCHEMA,
    schemaName: "VideoEditPlan",
    maxTokens: 4000,
  });
  return { ...plan, sourceFile };
}
