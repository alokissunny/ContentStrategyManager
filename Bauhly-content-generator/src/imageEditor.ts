import sharp from "sharp";
import { RATIO_DIMENSIONS } from "./config.js";
import type { AssetInfo, BrandKit, CropStrategy, OverlayText, SlidePlan } from "./types.js";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function cropPosition(crop: CropStrategy): string | number {
  switch (crop) {
    case "attention":
      return sharp.strategy.attention;
    case "entropy":
      return sharp.strategy.entropy;
    default:
      return sharp.gravity.center;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word wrap targeting roughly `maxChars` characters per line. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line.length === 0) line = w;
    else if ((line + " " + w).length <= maxChars) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildOverlaySvg(
  width: number,
  height: number,
  overlay: OverlayText,
  kit: BrandKit,
): Buffer {
  const headFont = Math.round(width * 0.075);
  const subFont = Math.round(width * 0.038);
  const headLines = wrap(overlay.headline.toUpperCase(), Math.floor((width * 0.86) / (headFont * 0.6)));
  const subLines = overlay.subtext ? wrap(overlay.subtext, Math.floor((width * 0.86) / (subFont * 0.55))) : [];

  const lineGap = 1.12;
  const headBlock = headLines.length * headFont * lineGap;
  const subBlock = subLines.length * subFont * lineGap;
  const gap = subLines.length ? subFont * 0.9 : 0;
  const totalBlock = headBlock + gap + subBlock;

  // Vertical anchor for the whole text block.
  let top: number;
  if (overlay.position === "top") top = height * 0.1;
  else if (overlay.position === "center") top = (height - totalBlock) / 2;
  else top = height * 0.88 - totalBlock;

  const scrimPad = width * 0.06;
  const scrimTop = clamp(top - scrimPad, 0, height);
  const scrimHeight = clamp(totalBlock + scrimPad * 2, 0, height - scrimTop);

  const accent = kit.accentColor;
  const textColor = kit.textColor;

  let y = top + headFont * 0.85;
  const cx = width / 2;
  const lineEls: string[] = [];

  // Accent bar above the headline for a branded feel.
  const barW = width * 0.14;
  lineEls.push(
    `<rect x="${cx - barW / 2}" y="${clamp(top - headFont * 0.55, 0, height)}" width="${barW}" height="${Math.max(4, headFont * 0.09)}" rx="3" fill="${accent}"/>`,
  );

  for (const l of headLines) {
    lineEls.push(
      `<text x="${cx}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="800" fill="${textColor}" text-anchor="middle" letter-spacing="1">${escapeXml(l)}</text>`,
    );
    y += headFont * lineGap;
  }
  y += gap;
  for (const l of subLines) {
    lineEls.push(
      `<text x="${cx}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${subFont}" font-weight="500" fill="${textColor}" text-anchor="middle" opacity="0.92">${escapeXml(l)}</text>`,
    );
    y += subFont * lineGap;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="50%" stop-color="#000000" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${scrimTop}" width="${width}" height="${scrimHeight}" fill="url(#scrim)"/>
  ${lineEls.join("\n  ")}
</svg>`;
  return Buffer.from(svg);
}

function warmthOverlaySvg(width: number, height: number, warmth: number): Buffer | null {
  if (Math.abs(warmth) < 3) return null;
  const color = warmth > 0 ? "#FF7A18" : "#1E5AFF";
  const opacity = clamp((Math.abs(warmth) / 100) * 0.28, 0, 0.28);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="${color}" fill-opacity="${opacity.toFixed(3)}"/></svg>`;
  return Buffer.from(svg);
}

/** Render one slide plan to `outPath`. Returns the pixel dimensions used. */
export async function renderSlide(
  asset: AssetInfo,
  slide: SlidePlan,
  kit: BrandKit,
  outPath: string,
): Promise<{ width: number; height: number }> {
  const { width, height } = RATIO_DIMENSIONS[slide.aspectRatio];
  const adj = slide.adjustments;

  const brightness = clamp(adj.brightness, 0.5, 1.5);
  const saturation = clamp(adj.saturation, 0, 2);
  const contrast = clamp(adj.contrast, 0.5, 1.5);

  // Base grade: crop-to-fill, brightness/saturation, then contrast around mid-grey.
  const base = await sharp(asset.absPath)
    .resize({ width, height, fit: "cover", position: cropPosition(slide.crop) })
    .modulate({ brightness, saturation })
    .linear(contrast, 128 * (1 - contrast))
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [];
  const warm = warmthOverlaySvg(width, height, adj.warmth);
  if (warm) layers.push({ input: warm });
  if (slide.overlay) layers.push({ input: buildOverlaySvg(width, height, slide.overlay, kit) });

  let pipeline = sharp(base);
  if (layers.length) pipeline = pipeline.composite(layers);

  await pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toFile(outPath);
  return { width, height };
}
