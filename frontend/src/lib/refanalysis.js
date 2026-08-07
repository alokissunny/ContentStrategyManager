/*
 * What Bauhly has read off each reference picture, kept per picture.
 *
 * ── WHY THIS IS A RECORD AND NOT A CALCULATION (Leon, Aug 7) ──────────────
 *
 * Reading the references used to be one pass over all of them: press the
 * button, sample up to six pictures, take the lightest, the darkest and the
 * most saturated, done. It gave the right answer and it was wrong in three
 * ways a studio can feel.
 *
 *   1 · Adding ONE picture re-read all of them. Nine references and a tenth
 *       added means nine decodes nobody asked for, every time.
 *   2 · Nothing was kept, so nothing could be MERGED. The tenth picture did
 *       not join what the first nine had taught — it replaced it.
 *   3 · "Up to six" silently ignored the seventh onwards, and never said so.
 *
 * So each picture gets a record of what was read off it, and the identity is
 * computed from the records rather than from the pixels. Adding a picture
 * analyses that picture. Removing one drops that record and only that record.
 * A picture already read is never read again.
 *
 * ── WHAT IS ACTUALLY READ, AND WHAT IS NOT ───────────────────────────────
 *
 * There is no vision model in this build. What runs here is real work on the
 * real file — `paletteOf` samples the pixels, `shapeOfImage` reads the natural
 * dimensions, the ground comes from luminance — and that is the whole list.
 * Composition, typography and spacing are what the analysis pass will add;
 * they are recorded as `null`, never guessed, and the UI says so. A record that
 * claimed a composition nothing looked at would be the one thing this product
 * does not do.
 */

import { paletteOf, shapeOfImage } from './slidestyle.js';

/* one picture, read once. Resolves to null if the file cannot be decoded —
   a reference that will not load teaches nothing, and saying so is better than
   filing an empty record that looks like a successful read. */
export function analyseRef(ref) {
  return new Promise((resolve) => {
    if (!ref?.url) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const { colours, dark } = paletteOf(img, 5);
      resolve({
        colours: colours.filter((c) => /^#[0-9a-f]{6}$/i.test(c)),
        shape: shapeOfImage(img),
        ground: dark > 0.45 ? 'dark' : 'light',
        /* named so the gap is visible in the data, not only in the copy */
        composition: null,
        typography: null,
        spacing: null,
      });
      /* `at` is stamped by the caller — this module has no clock and the store
         is what decides when a thing happened */
    };
    img.onerror = () => resolve(null);
    img.src = ref.url;
  });
}

/* which of these pictures Bauhly has not read yet */
export const pendingOf = (refs, analysis) =>
  (refs || []).filter((r) => r?.id && !analysis?.[r.id]);

/* read ONLY the ones that have never been read, and return the merged map.
 * `have` is returned untouched for everything already in it — that is the
 * whole promise of this module. */
export async function analyseNew(refs, have, stamp) {
  const pending = pendingOf(refs, have);
  if (!pending.length) return { analysis: have, read: 0, failed: 0 };
  const results = await Promise.all(pending.map((r) => analyseRef(r)));
  const analysis = { ...have };
  let failed = 0;
  pending.forEach((r, i) => {
    if (!results[i]) { failed += 1; return; }
    analysis[r.id] = { ...results[i], at: stamp };
  });
  return { analysis, read: pending.length - failed, failed };
}

/* drop one picture's record, and nothing else's */
export function forgetRef(analysis, id) {
  if (!analysis?.[id]) return analysis;
  const next = { ...analysis };
  delete next[id];
  return next;
}

const lum = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
};
const sat = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255; const g = ((v >> 8) & 255) / 255; const b = (v & 255) / 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/* THE PALETTE IS THE MERGE (Leon, Aug 7). Every record's colours are pooled —
 * the ones read a month ago and the one read a second ago — and the three roles
 * come off that pool. So a new picture MOVES the palette rather than replacing
 * it, and a picture that is removed stops influencing it, both without anything
 * being re-decoded.
 *
 * `fallbackAccent` keeps a colour the studio chose by hand when their pictures
 * genuinely contain no accent — a photograph of a white room has none, and
 * handing back the least grey grey would be worse than keeping what they set. */
export function paletteFromAnalysis(analysis, fallbackAccent) {
  const pool = Object.values(analysis || {}).flatMap((a) => a?.colours || []);
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => lum(a) - lum(b));
  const fg = sorted[0];
  const ground = sorted[sorted.length - 1];
  /* AN ACCENT THAT IS THE TEXT COLOUR IS NOT AN ACCENT (Leon, Aug 7 — measured
     on the studio's own stills). A warm interior set is brown all the way down:
     its most saturated tone IS its darkest one, so the honest reading came back
     with Primary and Accent the same hex, and a palette whose accent cannot be
     distinguished from its type has no accent in it. The candidate has to be
     saturated AND genuinely apart from the ink; otherwise the studio keeps
     whatever they chose, which is the truthful answer — these pictures do not
     contain a colour that points. */
  let accent = null; let best = 0;
  pool.forEach((c) => {
    const s = sat(c);
    if (s > best && Math.abs(lum(c) - lum(fg)) > 0.12) { best = s; accent = c; }
  });
  return {
    ground,
    fg,
    accent: best > 0.28 ? accent : (fallbackAccent || null),
  };
}
