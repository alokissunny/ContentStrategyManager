/**
 * Brand Kit colours for everything Bauhly DRAWS in a reel — explainer drawings, ✓/✗ cards
 * (studio review 2026-11-24: "use the Brand Kit colours consistently across typography, illustrations,
 * icons and motion graphics; adjust lightness for contrast but keep the hues; no unrelated colours").
 *
 *   paper  — the kit's ground, lifted to a light paper if it is dark
 *   ink    — the kit's text colour (fg), darkened in its own hue until it reads ≥ 7:1 on the paper
 *   good   — the accent, darkened in its hue to ≥ 3:1 on the paper (✓, the right way, "lit")
 *   bad    — the ink (✗, the wrong way): the brand has no "red", so wrong reads as ink + the ✗ shape
 *   soft   — the accent at low strength (neutral zones), and a lifted accent for light cones
 * Without a kit: a warm paper, near-black ink and a muted olive accent — never traffic-light colours.
 */
export type BrandPalette = { accent?: string; fg?: string; ground?: string };
export type DrawPalette = { paper: string; ink: string; good: string; bad: string; soft: string; light: string; onGood: string };

const rgb = (hex?: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (c: number[]) => {
  const ch = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const mix = (c: number[], to: number[], t: number) => c.map((v, i) => v + (to[i] - v) * t);
/* darken (toward black) in the same hue until it reads `min` against `bg` */
const darkenTo = (c: number[], bg: number[], min: number) => {
  let x = c;
  for (let i = 0; i < 20 && ratio(lum(x), lum(bg)) < min; i += 1) x = x.map((v) => v * 0.86);
  return x;
};

const DEFAULTS = { accent: '#7A8450', fg: '#1D1D1F', ground: '#F6F5F2' };

export function drawPalette(p?: BrandPalette | null): DrawPalette {
  const groundIn = rgb(p?.ground) || rgb(DEFAULTS.ground)!;
  // a dark ground becomes a light paper of the same hue (drawings are line-art on paper)
  const paper = lum(groundIn) >= 0.7 ? groundIn : mix(groundIn, [255, 255, 255], 0.9);
  const ink = darkenTo(rgb(p?.fg) || rgb(DEFAULTS.fg)!, paper, 7);
  const accentIn = rgb(p?.accent) || rgb(DEFAULTS.accent)!;
  const good = darkenTo(accentIn, paper, 3);
  return {
    paper: hex(paper),
    ink: hex(ink),
    good: hex(good),
    bad: hex(ink),
    soft: hex(mix(accentIn, paper, 0.55)),
    light: hex(mix(accentIn, [255, 255, 255], 0.45)),
    onGood: ratio(1, lum(good)) >= ratio(lum(ink), lum(good)) ? '#ffffff' : hex(ink),
  };
}
