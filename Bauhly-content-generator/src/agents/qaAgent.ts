import { generateJSON } from "../anthropic.js";
import type { Caption, IGFormat, PiecePlan, StrategyBrief } from "../types.js";

export interface QAVerdict {
  index: number;
  format: IGFormat;
  action: "pass" | "edit" | "regenerate";
  score: number;
  issues: string[];
  /** For action=edit: the corrected caption. */
  revisedCaption?: Caption;
  /** For action=edit: replacement overlay headlines, in slide order (image pieces). */
  revisedOverlays?: string[];
  /** For action=edit: replacement hook line (video pieces). */
  revisedVideoHook?: string;
  /** For action=edit: replacement video overlay texts, in order. */
  revisedVideoOverlays?: string[];
}

const SYSTEM = `You are the QA Agent — the final reviewer on an Instagram content team.
You audit the PLANNED content (concept, chosen asset, on-image overlay text, and caption) for each piece against the brand strategy and brief, and decide what happens next.

For each piece choose one action:
- "pass": on-strategy, on-tone, strong hook and CTA — ship it.
- "edit": the visuals/concept are fine but the COPY needs work (weak hook, off-tone caption, wrong/soft CTA, poor hashtags, or overlay text that doesn't match the strategy). You MUST supply the corrected text in the revised* fields.
- "regenerate": the concept or asset choice is fundamentally off-strategy and copy tweaks won't fix it. Explain clearly in issues so the director can redo it.

Be strict but fair — only flag real problems. Judge against: the audience, the tone, the content pillars, and the CTA in the brief, plus the founder's raw strategy. Score each piece 0-100 for strategy fit.
When you edit, keep captions in the brand voice; overlays must stay short (headline-style).`;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      description: "One verdict per piece, in the same order as the pieces provided.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "action", "score", "issues"],
        properties: {
          index: { type: "integer" },
          action: { type: "string", enum: ["pass", "edit", "regenerate"] },
          score: { type: "integer", description: "0-100 strategy fit." },
          issues: { type: "array", items: { type: "string" } },
          revisedCaption: {
            type: "object",
            additionalProperties: false,
            required: ["hook", "body", "cta", "hashtags"],
            properties: {
              hook: { type: "string" },
              body: { type: "string" },
              cta: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
            },
          },
          revisedOverlays: { type: "array", items: { type: "string" }, description: "Image overlay headlines, in slide order." },
          revisedVideoHook: { type: "string" },
          revisedVideoOverlays: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/** Compact, review-friendly summary of a piece for the QA prompt. */
function describePiece(p: PiecePlan, c: Caption, i: number): unknown {
  const base = { index: i, format: p.format, title: p.title, concept: p.concept };
  const caption = { hook: c.hook, body: c.body, cta: c.cta, hashtags: c.hashtags };
  if (p.videoPlan) {
    return { ...base, hook: p.videoPlan.hook, overlays: p.videoPlan.overlays.map((o) => o.text), caption };
  }
  return {
    ...base,
    slides: (p.slides ?? []).map((s) => ({ asset: s.assetFile, overlay: s.overlay?.headline ?? null })),
    caption,
  };
}

export async function runQA(
  strategy: string,
  brief: StrategyBrief,
  pieces: PiecePlan[],
  captions: Caption[],
): Promise<QAVerdict[]> {
  const summary = pieces.map((p, i) => describePiece(p, captions[i], i));
  const userText = `FOUNDER STRATEGY (verbatim):
${strategy}

BRAND BRIEF:
${JSON.stringify(brief, null, 2)}

PLANNED PIECES TO REVIEW:
${JSON.stringify(summary, null, 2)}

Review every piece and return one verdict each, in order.`;

  const result = await generateJSON<{ verdicts: QAVerdict[] }>({
    system: SYSTEM,
    userText,
    schema: SCHEMA,
    schemaName: "QAReport",
    maxTokens: 4000,
  });
  // Normalise: ensure format + index are set from position.
  return result.verdicts.map((v, i) => ({
    ...v,
    index: typeof v.index === "number" ? v.index : i,
    format: pieces[v.index ?? i]?.format ?? pieces[i].format,
  }));
}
