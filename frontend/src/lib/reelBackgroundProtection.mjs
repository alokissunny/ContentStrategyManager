// Coordinates match the 720×1280 FFmpeg mixer canvas, including its 4px border.
export function backgroundProtection(time, mix) {
  let clips = mix?.clips || [];
  if (!clips.length && mix?.sequence?.length) {
    let cursor = 0;
    clips = mix.sequence.map((entry) => {
      const start = cursor;
      const end = start + (entry.durationSec ?? entry.endSec - entry.startSec);
      cursor = end - (mix.transition === 'none' ? 0 : 11 / 30);
      return { start, end, kind: mix.assets?.[entry.assetIndex]?.kind };
    });
  }
  const active = clips.filter((c) => time >= c.start && time < c.end);
  // Leave photos and overlapping scene transitions untouched.
  if (active.some((c) => c.kind === 'image') || active.length > 1) return { full: true, regions: [] };
  const regions = [];
  for (const overlay of mix?.overlays || []) {
    if (time < overlay.atSec || time >= overlay.atSec + overlay.durationSec) continue;
    if (overlay.mode === 'cutaway') return { full: true, regions: [] };
    if (overlay.mode !== 'pip') continue;
    const asset = mix.assets?.[overlay.assetIndex];
    if (!asset?.width || !asset?.height) return { full: true, regions: [] };
    const scale = Math.min(260 / asset.width, 400 / asset.height);
    const w = Math.floor(asset.width * scale / 2) * 2 + 8;
    const h = Math.floor(asset.height * scale / 2) * 2 + 8;
    regions.push({ x: overlay.position.endsWith('right') ? 720 - w - 36 : 36,
      y: overlay.position.startsWith('top') ? 64 : 1280 - h - 220, w, h });
  }
  return { full: false, regions };
}
