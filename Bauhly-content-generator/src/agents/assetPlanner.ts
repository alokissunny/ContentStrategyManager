import { generateJSON } from "../anthropic.js";
import type { AssetInfo, AssetRequest, IGFormat, StrategyBrief } from "../types.js";

const SYSTEM = `You are the Asset Planner Agent on an Instagram content team.
You are shown the founder's UPLOADED photos (attached) and the brand strategy. Your job is to decide whether those photos are enough to create on-strategy content for the requested formats — and if not, to specify NEW photos to generate.

Look for real gaps, e.g.:
- a clean product / subject close-up the strategy needs but no upload provides,
- a lifestyle / in-context shot that sells the story,
- a text-friendly background with negative space for a hook or CTA slide,
- a missing pillar the uploads don't visually cover.

Rules:
- Only request photos that are genuinely MISSING and needed — quality over quantity. Request 0 to 4.
- If the uploads already cover the strategy well, return an empty list.
- Each prompt must be a vivid, concrete text-to-image description: subject, setting, lighting, composition, and on-brand mood/colour. No text or logos in the image.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["requests"],
  properties: {
    requests: {
      type: "array",
      description: "0-4 new photos to generate. Empty if the uploads suffice.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["purpose", "prompt", "aspectRatio", "style"],
        properties: {
          purpose: { type: "string", description: "What this photo is for, e.g. 'CTA slide background'." },
          prompt: { type: "string", description: "Vivid text-to-image prompt. No text/logos." },
          aspectRatio: { type: "string", enum: ["1:1", "4:5", "9:16"] },
          style: { type: "string", description: "e.g. 'warm editorial photography, soft natural light'." },
        },
      },
    },
  },
};

export async function runAssetPlanner(
  strategy: string,
  brief: StrategyBrief,
  images: AssetInfo[],
  formats: IGFormat[],
): Promise<AssetRequest[]> {
  const list = images.length
    ? images.map((a) => `- ${a.file} (${a.width}x${a.height})`).join("\n")
    : "(none uploaded)";

  const userText = `BRAND STRATEGY (verbatim):
${strategy}

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

FORMATS TO PRODUCE: ${formats.join(", ")}

UPLOADED PHOTOS (also attached above as images):
${list}

Decide what NEW photos, if any, are needed. Return the requests.`;

  const result = await generateJSON<{ requests: AssetRequest[] }>({
    system: SYSTEM,
    userText,
    images,
    schema: SCHEMA,
    schemaName: "AssetRequests",
    maxTokens: 2500,
  });
  return (result.requests ?? []).slice(0, 4);
}
