import { generateJSON } from "../anthropic.js";
import type { StrategyBrief } from "../types.js";

const SYSTEM = `You are the Strategy Agent on an Instagram content team.
You turn a founder's rough, high-level strategy into a precise, structured brand brief that the rest of the team (creative director, editor, copywriter) can execute against.
Be decisive and concrete. Infer sensible defaults where the input is vague. Colours must be valid hex.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["brandName", "audience", "tone", "contentPillars", "hashtags", "cta", "brandKit"],
  properties: {
    brandName: { type: "string", description: "Short brand name; invent a fitting one if none is given." },
    audience: { type: "string", description: "One sentence describing the target audience." },
    tone: { type: "string", description: "Voice/tone in a few words, e.g. 'warm, confident, playful'." },
    contentPillars: {
      type: "array",
      description: "3-5 recurring content themes.",
      items: { type: "string" },
    },
    hashtags: {
      type: "array",
      description: "8-15 relevant hashtags without the # symbol.",
      items: { type: "string" },
    },
    cta: { type: "string", description: "The primary call to action." },
    brandKit: {
      type: "object",
      additionalProperties: false,
      required: ["primaryColor", "secondaryColor", "accentColor", "textColor", "mood"],
      properties: {
        primaryColor: { type: "string", description: "Hex, e.g. #1B4332" },
        secondaryColor: { type: "string", description: "Hex" },
        accentColor: { type: "string", description: "Hex" },
        textColor: { type: "string", description: "Hex used for text overlays; must contrast with photos." },
        mood: { type: "string", description: "One or two words, e.g. 'warm minimal'." },
      },
    },
  },
};

export async function runStrategyAgent(strategy: string): Promise<StrategyBrief> {
  return generateJSON<StrategyBrief>({
    system: SYSTEM,
    userText: `Here is the founder's high-level strategy. Produce the structured brand brief.\n\nSTRATEGY:\n${strategy}`,
    schema: SCHEMA,
    schemaName: "StrategyBrief",
    maxTokens: 2000,
  });
}
