// Generates a few placeholder "photos" so the demo runs with zero setup.
// Replace ./sample-assets with your own JPG/PNG/WebP photos for real output.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const OUT = resolve("./sample-assets");

interface Spec {
  name: string;
  w: number;
  h: number;
  from: string;
  to: string;
  label: string;
}

const SPECS: Spec[] = [
  { name: "01-hero.jpg", w: 1600, h: 1600, from: "#6f4e37", to: "#c9a56a", label: "hero" },
  { name: "02-product.jpg", w: 1600, h: 2000, from: "#2b2b2b", to: "#e4572e", label: "product" },
  { name: "03-scene.jpg", w: 2000, h: 1400, from: "#1a3a2a", to: "#88b04b", label: "scene" },
  { name: "04-detail.jpg", w: 1600, h: 1600, from: "#3a2e2a", to: "#d9a066", label: "detail" },
];

function gradientSvg(s: Spec): Buffer {
  // Diagonal gradient + soft blobs so crop strategies have something to grip.
  return Buffer.from(`<svg width="${s.w}" height="${s.h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${s.from}"/>
        <stop offset="100%" stop-color="${s.to}"/>
      </linearGradient>
      <radialGradient id="b" cx="50%" cy="42%" r="40%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${s.w}" height="${s.h}" fill="url(#g)"/>
    <circle cx="${s.w * 0.5}" cy="${s.h * 0.42}" r="${Math.min(s.w, s.h) * 0.28}" fill="url(#b)"/>
    <circle cx="${s.w * 0.78}" cy="${s.h * 0.7}" r="${Math.min(s.w, s.h) * 0.14}" fill="#ffffff" fill-opacity="0.10"/>
    <text x="${s.w / 2}" y="${s.h - s.h * 0.06}" font-family="Helvetica, Arial, sans-serif"
      font-size="${Math.round(s.w * 0.045)}" fill="#ffffff" fill-opacity="0.55"
      text-anchor="middle" letter-spacing="4">SAMPLE · ${s.label.toUpperCase()}</text>
  </svg>`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  for (const s of SPECS) {
    await sharp(gradientSvg(s)).jpeg({ quality: 88 }).toFile(resolve(OUT, s.name));
    console.log(`  created sample-assets/${s.name}`);
  }
  console.log(`\nSample assets written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
