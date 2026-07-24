import { generateJSON } from "../anthropic.js";
import { FORMAT_DEFAULT_RATIO, FORMAT_SLIDE_GUIDANCE } from "../config.js";
import type { AssetInfo, IGFormat, PiecePlan, StrategyBrief } from "../types.js";

const SYSTEM = `You are the Creative Director Agent on an Instagram content team.
You are given: the brand brief, the list of the user's photo assets (you can SEE them), and the formats to produce.
For each requested format you design one content piece: pick which asset(s) fit best, choose the crop and colour-grade that reinforce the brand mood, and decide what text (if any) should be baked onto each image.

Rules:
- Only reference assetFile values that exist in the provided asset list.
- Keep overlays short and punchy (headline <= 6 words, subtext <= 10 words). Omit overlays on purely aesthetic photo slides.
- Choose crop: "attention" for people/product focal points, "entropy" for busy scenes, "center" otherwise.
- adjustments must stay within: brightness 0.7-1.3, saturation 0.6-1.4, contrast 0.8-1.25, warmth -60..60.
- Match the number/kind of slides to the format guidance you are given.`;

function buildSchema(formats: IGFormat[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["pieces"],
    properties: {
      pieces: {
        type: "array",
        description: `Exactly ${formats.length} pieces, one per requested format, in order: ${formats.join(", ")}.`,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["format", "title", "concept", "slides"],
          properties: {
            format: { type: "string", enum: ["post", "carousel", "reel"] },
            title: { type: "string" },
            concept: { type: "string", description: "One line describing the idea." },
            slides: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["assetFile", "aspectRatio", "role", "crop", "adjustments"],
                properties: {
                  assetFile: { type: "string" },
                  aspectRatio: { type: "string", enum: ["1:1", "4:5", "9:16"] },
                  role: { type: "string" },
                  crop: { type: "string", enum: ["center", "attention", "entropy"] },
                  adjustments: {
                    type: "object",
                    additionalProperties: false,
                    required: ["brightness", "saturation", "contrast", "warmth"],
                    properties: {
                      brightness: { type: "number" },
                      saturation: { type: "number" },
                      contrast: { type: "number" },
                      warmth: { type: "number" },
                    },
                  },
                  overlay: {
                    type: "object",
                    additionalProperties: false,
                    required: ["headline", "subtext", "position"],
                    properties: {
                      headline: { type: "string" },
                      subtext: { type: "string" },
                      position: { type: "string", enum: ["top", "center", "bottom"] },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export async function runCreativeDirector(
  brief: StrategyBrief,
  assets: AssetInfo[],
  formats: IGFormat[],
): Promise<PiecePlan[]> {
  const assetList = assets
    .map((a) => `- ${a.file} (${a.width}x${a.height})`)
    .join("\n");
  const formatGuidance = formats
    .map((f) => `- ${f}: ${FORMAT_SLIDE_GUIDANCE[f]} (default aspect ${FORMAT_DEFAULT_RATIO[f]})`)
    .join("\n");

  const userText = `BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

AVAILABLE ASSETS (also attached above as images, in order):
${assetList}

FORMATS TO PRODUCE (one piece each, in this order):
${formatGuidance}

Design the pieces now.`;

  const result = await generateJSON<{ pieces: PiecePlan[] }>({
    system: SYSTEM,
    userText,
    images: assets,
    schema: buildSchema(formats),
    schemaName: "CreativePlan",
    maxTokens: 6000,
  });
  return result.pieces;
}
