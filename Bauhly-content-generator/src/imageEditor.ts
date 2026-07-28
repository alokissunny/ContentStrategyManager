import sharp from "sharp";
import { RATIO_DIMENSIONS } from "./config.js";
import { DEFAULT_CAPTION_STYLE, fontDef, strokeColorFor } from "./captionStyle.js";
import type { AssetInfo, BrandKit, CaptionStyle, CropStrategy, OverlayText, SlidePlan } from "./types.js";

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
  style: CaptionStyle,
): Buffer {
  const def = fontDef(style);
  const headFont = Math.round(width * 0.075 * def.sizeScale);
  const subFont = Math.round(width * 0.038 * def.sizeScale);
  const family = def.svgFamily;
  const headWeight = style.weight === "bold" ? 800 : 600;
  const upper = style.case === "upper";
  const headText = (s: string) => (upper ? s.toUpperCase() : s);

  const headLines = wrap(headText(overlay.headline), Math.floor((width * 0.82) / (headFont * 0.6)));
  const subLines = overlay.subtext ? wrap(overlay.subtext, Math.floor((width * 0.84) / (subFont * 0.55))) : [];

  const lineGap = 1.14;
  const headBlock = headLines.length * headFont * lineGap;
  const subBlock = subLines.length * subFont * lineGap;
  const gap = subLines.length ? subFont * 0.9 : 0;
  const totalBlock = headBlock + gap + subBlock;

  let top: number;
  if (overlay.position === "top") top = height * 0.1;
  else if (overlay.position === "center") top = (height - totalBlock) / 2;
  else top = height * 0.88 - totalBlock;

  const pad = width * 0.06;
  const boxTop = clamp(top - pad, 0, height);
  const boxHeight = clamp(totalBlock + pad * 2, 0, height - boxTop);

  const textColor = style.textColor;
  const stroke = strokeColorFor(textColor);
  const strokeW = Math.max(1.5, headFont * 0.045);
  const subStrokeW = Math.max(1, subFont * 0.05);
  const letterSpacing = upper ? Math.max(1, headFont * 0.02) : 0;

  // Background treatment for legibility.
  let bg = "";
  if (style.background === "scrim") {
    bg = `<rect x="0" y="${boxTop}" width="${width}" height="${boxHeight}" fill="url(#scrim)"/>`;
  } else if (style.background === "box") {
    bg = `<rect x="${width * 0.06}" y="${boxTop}" width="${width * 0.88}" height="${boxHeight}" rx="${width * 0.03}" fill="#000000" fill-opacity="0.55"/>`;
  }

  let y = top + headFont * 0.85;
  const cx = width / 2;
  const lineEls: string[] = [];

  const barW = width * 0.14;
  lineEls.push(
    `<rect x="${cx - barW / 2}" y="${clamp(top - headFont * 0.55, 0, height)}" width="${barW}" height="${Math.max(4, headFont * 0.09)}" rx="3" fill="${kit.accentColor}"/>`,
  );

  for (const l of headLines) {
    lineEls.push(
      `<text x="${cx}" y="${y}" font-family="${family}" font-size="${headFont}" font-weight="${headWeight}" fill="${textColor}" stroke="${stroke}" stroke-width="${strokeW}" paint-order="stroke" stroke-linejoin="round" text-anchor="middle" letter-spacing="${letterSpacing}">${escapeXml(l)}</text>`,
    );
    y += headFont * lineGap;
  }
  y += gap;
  for (const l of subLines) {
    lineEls.push(
      `<text x="${cx}" y="${y}" font-family="${family}" font-size="${subFont}" font-weight="${style.weight === "bold" ? 600 : 400}" fill="${textColor}" stroke="${stroke}" stroke-width="${subStrokeW}" paint-order="stroke" stroke-linejoin="round" text-anchor="middle" opacity="0.95">${escapeXml(l)}</text>`,
    );
    y += subFont * lineGap;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="50%" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${bg}
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
  captionStyle: CaptionStyle = DEFAULT_CAPTION_STYLE,
): Promise<{ width: number; height: number }> {
  const { width, height } = RATIO_DIMENSIONS[slide.aspectRatio];
  const adj = slide.adjustments;

  const brightness = clamp(adj.brightness, 0.5, 1.5);
  const saturation = clamp(adj.saturation, 0, 2);
  const contrast = clamp(adj.contrast, 0.5, 1.5);

  const layers: sharp.OverlayOptions[] = [];
  const warm = warmthOverlaySvg(width, height, adj.warmth);
  if (warm) layers.push({ input: warm });
  if (slide.overlay) layers.push({ input: buildOverlaySvg(width, height, slide.overlay, kit, captionStyle) });

  // Single pass: crop-to-fill (Lanczos) → grade → composite overlays → encode ONCE.
  // (Avoids a lossy JPEG round-trip between grading and compositing.)
  let pipeline = sharp(asset.absPath, { failOn: "none" })
    .resize({ width, height, fit: "cover", position: cropPosition(slide.crop), kernel: "lanczos3" })
    .modulate({ brightness, saturation })
    .linear(contrast, 128 * (1 - contrast));
  if (layers.length) pipeline = pipeline.composite(layers);

  await pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toFile(outPath);
  return { width, height };
}
