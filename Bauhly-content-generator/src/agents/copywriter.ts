import { generateJSON } from "../anthropic.js";
import type { Caption, PiecePlan, StrategyBrief } from "../types.js";

const SYSTEM = `You are the Copywriter Agent on an Instagram content team.
Given the brand brief and each planned content piece, write the Instagram caption for each: a scroll-stopping hook, a short body (2-4 sentences), a call to action, and 8-15 hashtags (without the # symbol).
Match the brand tone exactly. Use at most one emoji per caption. Do not repeat the hook verbatim in the body.`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["captions"],
  properties: {
    captions: {
      type: "array",
      description: "One caption per piece, in the same order as the pieces provided.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hook", "body", "hashtags", "cta"],
        properties: {
          hook: { type: "string" },
          body: { type: "string" },
          cta: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export async function runCopywriter(
  brief: StrategyBrief,
  pieces: PiecePlan[],
): Promise<Caption[]> {
  const pieceSummary = pieces
    .map((p, i) => `${i + 1}. [${p.format}] "${p.title}" — ${p.concept}`)
    .join("\n");

  const userText = `BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

PIECES TO CAPTION:
${pieceSummary}

Write one caption per piece, in order.`;

  const result = await generateJSON<{ captions: Caption[] }>({
    system: SYSTEM,
    userText,
    schema: SCHEMA,
    schemaName: "Captions",
    maxTokens: 3000,
  });
  return result.captions;
}
