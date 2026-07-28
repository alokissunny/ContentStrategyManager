import { existsSync } from "node:fs";
import type { CaptionFont, CaptionStyle } from "./types.js";

interface FontDef {
  /** CSS font-family stack for the SVG (sharp) renderer. */
  svgFamily: string;
  /** Relative size multiplier so each face reads at a comparable weight. */
  sizeScale: number;
  /** Candidate .ttf/.ttc files for ffmpeg drawtext, per weight (first existing wins). */
  ffmpeg: { bold: string[]; regular: string[] };
}

const MAC = "/System/Library/Fonts/Supplemental";
const LINUX_DEJAVU = "/usr/share/fonts/truetype/dejavu";
const LINUX_LIB = "/usr/share/fonts/truetype/liberation";

export const CAPTION_FONTS: Record<CaptionFont, FontDef> = {
  "modern-sans": {
    svgFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    sizeScale: 1.0,
    ffmpeg: {
      bold: [`${MAC}/Arial Bold.ttf`, "/System/Library/Fonts/Helvetica.ttc", `${LINUX_LIB}/LiberationSans-Bold.ttf`, `${LINUX_DEJAVU}/DejaVuSans-Bold.ttf`],
      regular: [`${MAC}/Arial.ttf`, "/System/Library/Fonts/Helvetica.ttc", `${LINUX_LIB}/LiberationSans-Regular.ttf`, `${LINUX_DEJAVU}/DejaVuSans.ttf`],
    },
  },
  "bold-impact": {
    svgFamily: "Impact, 'Arial Black', 'Haettenschweiler', sans-serif",
    sizeScale: 1.12,
    ffmpeg: {
      bold: [`${MAC}/Impact.ttf`, `${MAC}/Arial Bold.ttf`, `${LINUX_DEJAVU}/DejaVuSans-Bold.ttf`],
      regular: [`${MAC}/Impact.ttf`, `${MAC}/Arial.ttf`, `${LINUX_DEJAVU}/DejaVuSans.ttf`],
    },
  },
  "elegant-serif": {
    svgFamily: "Georgia, 'Times New Roman', serif",
    sizeScale: 0.98,
    ffmpeg: {
      bold: [`${MAC}/Georgia Bold.ttf`, `${MAC}/Times New Roman Bold.ttf`, `${LINUX_DEJAVU}/DejaVuSerif-Bold.ttf`],
      regular: [`${MAC}/Georgia.ttf`, `${MAC}/Times New Roman.ttf`, `${LINUX_DEJAVU}/DejaVuSerif.ttf`],
    },
  },
  "editorial-serif": {
    svgFamily: "'Times New Roman', Georgia, 'Didot', serif",
    sizeScale: 1.0,
    ffmpeg: {
      bold: [`${MAC}/Times New Roman Bold.ttf`, `${MAC}/Georgia Bold.ttf`, `${LINUX_DEJAVU}/DejaVuSerif-Bold.ttf`],
      regular: [`${MAC}/Times New Roman.ttf`, `${MAC}/Georgia.ttf`, `${LINUX_DEJAVU}/DejaVuSerif.ttf`],
    },
  },
  "clean-rounded": {
    svgFamily: "'Trebuchet MS', 'Gill Sans', 'Verdana', sans-serif",
    sizeScale: 1.02,
    ffmpeg: {
      bold: [`${MAC}/Trebuchet MS Bold.ttf`, `${MAC}/Verdana Bold.ttf`, `${LINUX_LIB}/LiberationSans-Bold.ttf`],
      regular: [`${MAC}/Trebuchet MS.ttf`, `${MAC}/Verdana.ttf`, `${LINUX_LIB}/LiberationSans-Regular.ttf`],
    },
  },
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: "modern-sans",
  weight: "bold",
  case: "upper",
  textColor: "#FFFFFF",
  background: "scrim",
};

const FONTS = new Set<CaptionFont>(Object.keys(CAPTION_FONTS) as CaptionFont[]);

/** Coerce a (possibly partial/invalid) style from an agent into a safe CaptionStyle. */
export function validateCaptionStyle(s: Partial<CaptionStyle> | undefined): CaptionStyle {
  if (!s) return { ...DEFAULT_CAPTION_STYLE };
  const hex = typeof s.textColor === "string" && /^#?[0-9a-fA-F]{6}$/.test(s.textColor.trim())
    ? (s.textColor.trim().startsWith("#") ? s.textColor.trim() : `#${s.textColor.trim()}`)
    : DEFAULT_CAPTION_STYLE.textColor;
  return {
    font: s.font && FONTS.has(s.font) ? s.font : DEFAULT_CAPTION_STYLE.font,
    weight: s.weight === "regular" ? "regular" : "bold",
    case: s.case === "normal" ? "normal" : "upper",
    textColor: hex,
    background: s.background === "box" || s.background === "none" ? s.background : "scrim",
  };
}

export function fontDef(style: CaptionStyle): FontDef {
  return CAPTION_FONTS[style.font] ?? CAPTION_FONTS["modern-sans"];
}

/** Resolve a real ffmpeg fontfile for this style, or null to fall back. */
export function resolveFfmpegFont(style: CaptionStyle): string | null {
  const def = fontDef(style);
  const ordered = style.weight === "regular"
    ? [...def.ffmpeg.regular, ...def.ffmpeg.bold]
    : [...def.ffmpeg.bold, ...def.ffmpeg.regular];
  for (const f of ordered) if (existsSync(f)) return f;
  return null;
}

/** Relative luminance of a #RRGGBB colour (0..1). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Contrasting outline colour for legibility against any background. */
export function strokeColorFor(hex: string): string {
  return luminance(hex) > 0.6 ? "#000000" : "#FFFFFF";
}
