import type { ContentPlan, RenderedPiece } from "./types.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function captionBlock(p: RenderedPiece): string {
  const tags = p.caption.hashtags.map((h) => `#${esc(h)}`).join(" ");
  return `
    <div class="caption">
      <p class="hook">${esc(p.caption.hook)}</p>
      <p class="body">${esc(p.caption.body)}</p>
      <p class="cta">${esc(p.caption.cta)}</p>
      <p class="tags">${tags}</p>
    </div>`;
}

function videoBody(p: RenderedPiece): string {
  const vp = p.plan.videoPlan;
  const segs = vp
    ? `<p class="edit">✂️ ${vp.segments.length} segments · target ${Math.round(vp.targetDurationSec)}s · ${esc(vp.targetAspect)} · music: ${esc(vp.musicMood)}</p>`
    : "";
  const timeline = vp
    ? `<ul class="timeline">${vp.segments
        .map((s) => `<li>${s.startSec.toFixed(1)}s–${s.endSec.toFixed(1)}s${s.speed !== 1 ? ` @${s.speed}×` : ""} · ${esc(s.label)}</li>`)
        .join("")}</ul>`
    : "";
  return `
      <div class="video-wrap">
        <video controls playsinline preload="metadata" poster="${p.cover ?? ""}" src="${p.video ?? ""}"></video>
      </div>
      ${segs}
      ${timeline}`;
}

function imageBody(p: RenderedPiece): string {
  const slides = p.images
    .map(
      (img, i) => `
        <figure class="slide">
          <img src="${img}" alt="${esc(p.plan.format)} slide ${i + 1}" loading="lazy"/>
          <figcaption>${esc(p.plan.slides?.[i]?.role ?? `slide ${i + 1}`)}</figcaption>
        </figure>`,
    )
    .join("");
  return `<div class="slides ${p.images.length > 1 ? "carousel" : ""}">${slides}</div>`;
}

function pieceBlock(p: RenderedPiece): string {
  const body = p.video ? videoBody(p) : imageBody(p);
  return `
    <article class="piece">
      <header>
        <span class="badge badge-${p.plan.format}">${p.plan.format}</span>
        <h2>${esc(p.plan.title)}</h2>
        <p class="concept">${esc(p.plan.concept)}</p>
      </header>
      ${body}
      ${captionBlock(p)}
    </article>`;
}

export function buildPreviewHtml(plan: ContentPlan): string {
  const kit = plan.brief.brandKit;
  const pieces = plan.pieces.map(pieceBlock).join("\n");
  const pillars = plan.brief.contentPillars.map((c) => `<li>${esc(c)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(plan.brief.brandName)} — content plan</title>
<style>
  :root {
    --primary: ${kit.primaryColor};
    --secondary: ${kit.secondaryColor};
    --accent: ${kit.accentColor};
    --bg: #0e0e10; --card: #17171b; --text: #f2f2f2; --muted: #a0a0aa;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f6f5f2; --card: #ffffff; --text: #17171b; --muted: #6a6a72; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 32px 20px 80px; }
  .hero { border-radius: 20px; padding: 28px; color: #fff;
    background: linear-gradient(135deg, var(--primary), var(--secondary)); }
  .hero h1 { margin: 0 0 6px; font-size: 30px; }
  .hero .tone { opacity: .9; margin: 0 0 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { background: rgba(255,255,255,.18); padding: 5px 12px; border-radius: 999px; font-size: 13px; }
  .swatches { display: flex; gap: 8px; margin-top: 16px; }
  .sw { width: 34px; height: 34px; border-radius: 8px; border: 2px solid rgba(255,255,255,.4); }
  .meta { color: var(--muted); font-size: 13px; margin: 10px 2px 0; }
  section.pillars { margin: 26px 2px; color: var(--muted); }
  section.pillars ul { margin: 6px 0 0; padding-left: 18px; }
  .piece { background: var(--card); border-radius: 18px; padding: 20px; margin-top: 22px;
    box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  .piece header h2 { margin: 8px 0 4px; font-size: 21px; }
  .concept { color: var(--muted); margin: 0 0 14px; }
  .badge { text-transform: uppercase; font-size: 11px; font-weight: 700; letter-spacing: .5px;
    padding: 4px 10px; border-radius: 999px; color: #fff; background: var(--accent); }
  .badge-carousel { background: var(--secondary); }
  .badge-reel { background: var(--primary); }
  .badge-video { background: var(--primary); }
  .video-wrap { display: flex; justify-content: center; }
  .video-wrap video { width: 62%; max-width: 340px; border-radius: 14px; background: #000; display: block; }
  .edit { color: var(--muted); font-size: 13px; margin: 12px 0 4px; }
  .timeline { color: var(--muted); font-size: 12px; margin: 0 0 4px; padding-left: 18px; }
  .timeline li { margin: 2px 0; }
  .slides { display: grid; grid-template-columns: minmax(0,1fr); gap: 12px; }
  .slides.carousel { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; }
  .slides.carousel .slide { flex: 0 0 78%; scroll-snap-align: start; }
  .slide { margin: 0; }
  .slide img { width: 100%; border-radius: 12px; display: block; background: #222; }
  .slide figcaption { color: var(--muted); font-size: 12px; margin-top: 6px; text-align: center; }
  .caption { margin-top: 16px; border-top: 1px solid rgba(128,128,128,.2); padding-top: 14px; }
  .caption .hook { font-weight: 700; font-size: 16px; margin: 0 0 8px; }
  .caption .body { margin: 0 0 8px; line-height: 1.5; }
  .caption .cta { margin: 0 0 8px; color: var(--accent); font-weight: 600; }
  .caption .tags { color: var(--muted); font-size: 13px; margin: 0; word-spacing: 2px; }
  footer { color: var(--muted); font-size: 12px; margin-top: 30px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <h1>${esc(plan.brief.brandName)}</h1>
    <p class="tone">${esc(plan.brief.tone)} · ${esc(kit.mood)}</p>
    <div class="chips">
      <span class="chip">${esc(plan.brief.audience)}</span>
    </div>
    <div class="swatches">
      <div class="sw" style="background:${kit.primaryColor}" title="${kit.primaryColor}"></div>
      <div class="sw" style="background:${kit.secondaryColor}" title="${kit.secondaryColor}"></div>
      <div class="sw" style="background:${kit.accentColor}" title="${kit.accentColor}"></div>
    </div>
  </div>
  <p class="meta">Generated ${esc(plan.generatedAt)} · engine: <strong>${plan.engine}</strong> (${esc(plan.model)}) · ${plan.pieces.length} pieces</p>

  <section class="pillars">
    <strong>Content pillars</strong>
    <ul>${pillars}</ul>
  </section>

  ${pieces}

  <footer>Bauhly Content Generator · caption + creative are drafts — review before posting.</footer>
</div>
</body>
</html>`;
}
