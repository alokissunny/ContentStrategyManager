import { generateJSON } from "../anthropic.js";
import { validateCaptionStyle } from "../captionStyle.js";
import type { StrategyBrief } from "../types.js";

const SYSTEM = `You are the Strategy Agent on an Instagram content team.
You turn a founder's rough, high-level strategy into a precise, structured brand brief that the rest of the team (creative director, editor, copywriter) can execute against.
Be decisive and concrete. Infer sensible defaults where the input is vague. Colours must be valid hex.

You also decide the CAPTION STYLE — the look & feel of the on-image/on-video text — so it fits the brand and stays highly legible:
- font: "modern-sans" (clean, versatile), "bold-impact" (loud, punchy, viral), "elegant-serif" (premium, editorial), "editorial-serif" (classic magazine), or "clean-rounded" (friendly, approachable). Pick what matches the tone.
- weight: "bold" for most social captions; "regular" only for elegant/minimal brands.
- case: "upper" for punchy/hype, "normal" for elegant/editorial.
- textColor: a hex that reads clearly over photos — usually near-white (#FFFFFF) or near-black; it sits on a legibility scrim so favour high contrast.
- background: "scrim" (soft gradient behind text — safe default), "box" (solid caption bar), or "none" (text with outline only — only for clean minimal looks).`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["brandName", "audience", "tone", "contentPillars", "hashtags", "cta", "brandKit", "captionStyle"],
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
    captionStyle: {
      type: "object",
      additionalProperties: false,
      required: ["font", "weight", "case", "textColor", "background"],
      properties: {
        font: { type: "string", enum: ["modern-sans", "bold-impact", "elegant-serif", "editorial-serif", "clean-rounded"] },
        weight: { type: "string", enum: ["regular", "bold"] },
        case: { type: "string", enum: ["normal", "upper"] },
        textColor: { type: "string", description: "Hex, high contrast for legibility." },
        background: { type: "string", enum: ["scrim", "box", "none"] },
      },
    },
  },
};

export async function runStrategyAgent(strategy: string): Promise<StrategyBrief> {
  const brief = await generateJSON<StrategyBrief>({
    system: SYSTEM,
    userText: `Here is the founder's high-level strategy. Produce the structured brand brief.\n\nSTRATEGY:\n${strategy}`,
    schema: SCHEMA,
    schemaName: "StrategyBrief",
    maxTokens: 2000,
  });
  brief.captionStyle = validateCaptionStyle(brief.captionStyle);
  return brief;
}
