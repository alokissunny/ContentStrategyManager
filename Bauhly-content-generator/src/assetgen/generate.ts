import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { RATIO_DIMENSIONS } from "../config.js";
import type { AssetInfo, AssetRequest, BrandKit, GeneratedAsset } from "../types.js";

export interface GenResult {
  assets: AssetInfo[];
  generated: GeneratedAsset[];
}

function pickProvider(): "openai" | "placeholder" {
  const p = (process.env.IMAGE_PROVIDER || "").toLowerCase();
  if (p === "placeholder") return "placeholder";
  if (p === "openai") return "openai";
  return process.env.OPENAI_API_KEY ? "openai" : "placeholder";
}

function fullPrompt(req: AssetRequest, kit: BrandKit): string {
  return `${req.prompt}. Style: ${req.style}. On-brand mood: ${kit.mood}. High-quality photograph, natural composition, no text, no watermark, no logo.`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else { lines.push(line); line = w; if (lines.length >= maxLines) break; }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/** Branded placeholder "photo" — a stand-in when no real image backend is configured. */
async function placeholder(req: AssetRequest, kit: BrandKit, outPath: string): Promise<void> {
  const { width, height } = RATIO_DIMENSIONS[req.aspectRatio];
  const promptLines = wrap(req.prompt, 34, 4);
  const promptText = promptLines
    .map((l, i) => `<text x="${width / 2}" y="${height * 0.6 + i * 34}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="${kit.textColor}" fill-opacity="0.9" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${kit.primaryColor}"/>
        <stop offset="100%" stop-color="${kit.secondaryColor}"/>
      </linearGradient>
      <radialGradient id="b" cx="50%" cy="38%" r="42%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.5}" cy="${height * 0.38}" r="${Math.min(width, height) * 0.3}" fill="url(#b)"/>
    <rect x="${width / 2 - 150}" y="${height * 0.4}" width="300" height="4" rx="2" fill="${kit.accentColor}"/>
    <text x="${width / 2}" y="${height * 0.34}" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${kit.textColor}" text-anchor="middle" letter-spacing="2">${esc(req.purpose.toUpperCase())}</text>
    ${promptText}
    <text x="${width / 2}" y="${height - 60}" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${kit.textColor}" fill-opacity="0.6" text-anchor="middle" letter-spacing="3">AI-GENERATED · PLACEHOLDER</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(outPath);
}

const OPENAI_SIZE: Record<string, string> = { "1:1": "1024x1024", "4:5": "1024x1536", "9:16": "1024x1536" };

/** Real generation via an OpenAI-compatible images endpoint. Throws on failure so we can fall back. */
async function openai(req: AssetRequest, kit: BrandKit, outPath: string): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.IMAGE_MODEL || "gpt-image-1",
      prompt: fullPrompt(req, kit),
      size: OPENAI_SIZE[req.aspectRatio] || "1024x1024",
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json.data?.[0];
  let buf: Buffer;
  if (item?.b64_json) buf = Buffer.from(item.b64_json, "base64");
  else if (item?.url) buf = Buffer.from(await (await fetch(item.url)).arrayBuffer());
  else throw new Error("image API returned no image");
  await sharp(buf).jpeg({ quality: 90 }).toFile(outPath);
}

/** Generate all requested assets into `outDir/generated`. Falls back to placeholder on any real-provider error. */
export async function generateAssets(
  requests: AssetRequest[],
  kit: BrandKit,
  outDir: string,
  log: (m: string) => void = () => {},
): Promise<GenResult> {
  if (requests.length === 0) return { assets: [], generated: [] };
  const dir = join(outDir, "generated");
  await mkdir(dir, { recursive: true });
  const provider = pickProvider();

  const assets: AssetInfo[] = [];
  const generated: GeneratedAsset[] = [];
  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    const file = `gen-${i + 1}.jpg`;
    const outPath = join(dir, file);
    let used = provider;
    try {
      if (provider === "openai") await openai(req, kit, outPath);
      else await placeholder(req, kit, outPath);
    } catch (err) {
      log(`   ⚠ image provider '${provider}' failed (${err instanceof Error ? err.message : err}) — using placeholder`);
      await placeholder(req, kit, outPath);
      used = "placeholder";
    }
    const meta = await sharp(outPath).metadata();
    assets.push({
      file,
      absPath: outPath,
      mediaType: "image/jpeg",
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      kind: "image",
      generated: true,
    });
    generated.push({ file: join("generated", file), purpose: req.purpose, prompt: req.prompt, provider: used });
    log(`   • generated ${file} (${used}) — ${req.purpose}`);
  }
  return { assets, generated };
}
