import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./config.js";
import type { AssetInfo } from "./types.js";
import { readFile } from "node:fs/promises";

/** Raised when Claude is unreachable so the orchestrator can fall back to the mock engine. */
export class NoCredentialsError extends Error {}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Zero-arg constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
  // `ant auth login` profile automatically.
  if (!client) client = new Anthropic();
  return client;
}

interface GenerateJSONOpts {
  system: string;
  userText: string;
  /** Optional images to give the model vision over the user's assets. */
  images?: AssetInfo[];
  /** JSON schema, embedded in the prompt to guide the shape of the reply. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}

/** Pull the first well-formed JSON object out of a model reply, tolerating fences/prose. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the substring between the first { and last }.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model reply was not valid JSON.");
  }
}

/**
 * Single-shot structured call: sends a system + user prompt (optionally with
 * images) and returns JSON matching the requested shape. The JSON schema is
 * embedded in the prompt (portable across SDK versions).
 */
export async function generateJSON<T>(opts: GenerateJSONOpts): Promise<T> {
  const anthropic = getClient();

  const content: Anthropic.ContentBlockParam[] = [];
  for (const asset of opts.images ?? []) {
    const data = (await readFile(asset.absPath)).toString("base64");
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: asset.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data,
      },
    });
    content.push({ type: "text", text: `(asset file: ${asset.file})` });
  }
  content.push({
    type: "text",
    text: `${opts.userText}

Reply with a SINGLE JSON object named ${opts.schemaName} that conforms to this JSON schema. Output JSON only — no markdown fences, no commentary:

${JSON.stringify(opts.schema)}`,
  });

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined this request (safety refusal).");
    }

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block returned from Claude.");
    }
    return extractJson(textBlock.text) as T;
  } catch (err) {
    if (
      err instanceof Anthropic.AuthenticationError ||
      err instanceof Anthropic.APIConnectionError ||
      err instanceof Anthropic.PermissionDeniedError
    ) {
      throw new NoCredentialsError(
        `Could not reach Claude (${err.constructor.name}). Falling back to offline mode.`,
      );
    }
    throw err;
  }
}
