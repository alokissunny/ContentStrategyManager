import { generateJSON } from "../anthropic.js";
import type { OverlayPosition, PiecePlan, StrategyBrief } from "../types.js";

export interface HookVerdict {
  index: number;
  hook: string;
  position: OverlayPosition;
}

const SYSTEM = `You are the Hook Agent — a viral short-form hook specialist.
For each planned piece, write ONE scroll-stopping on-screen HOOK: the very first words the viewer reads. It must spark curiosity, tension, or a bold promise in <= 8 words, match the piece's format and concept, and fit the brand tone.

This is the ON-SCREEN hook that gets baked onto the image/video — NOT the caption. Make it punchy and specific, never generic ("Check this out"). Don't over-promise something the content can't pay off. Pick a position that keeps the hook readable (usually top or center).`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: {
    hooks: {
      type: "array",
      description: "One hook per piece, in the same order as the pieces provided.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "hook", "position"],
        properties: {
          index: { type: "integer" },
          hook: { type: "string", description: "<= 8 words, scroll-stopping." },
          position: { type: "string", enum: ["top", "center", "bottom"] },
        },
      },
    },
  },
};

export async function runHookAgent(
  strategy: string,
  brief: StrategyBrief,
  pieces: PiecePlan[],
): Promise<HookVerdict[]> {
  const summary = pieces.map((p, i) => ({ index: i, format: p.format, title: p.title, concept: p.concept }));
  const userText = `FOUNDER STRATEGY (verbatim):
${strategy}

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

PIECES:
${JSON.stringify(summary, null, 2)}

Write one viral on-screen hook per piece, in order.`;

  const result = await generateJSON<{ hooks: HookVerdict[] }>({
    system: SYSTEM,
    userText,
    schema: SCHEMA,
    schemaName: "Hooks",
    maxTokens: 1500,
  });
  return (result.hooks ?? []).map((h, i) => ({ ...h, index: typeof h.index === "number" ? h.index : i }));
}
