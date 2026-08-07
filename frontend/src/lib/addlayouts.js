/*
 * Adding layouts to one category, from the pictures the studio just gave.
 *
 * ── WHAT "CREATE A LAYOUT" HONESTLY MEANS HERE (Leon, Aug 7) ──────────────
 *
 * There is no model in this build that can invent a composition, and there is
 * none that can write a headline. Two things follow, and both are load-bearing.
 *
 * 1 · THE COMPOSITION IS CHOSEN, NOT INVENTED — and chosen from the ones this
 *     category does not have. `COMPOSITIONS` is derived from the layout set, so
 *     every candidate is a shape the renderer already draws; subtracting the
 *     category's own kinds is what makes "meaningfully different" arithmetic
 *     rather than a claim. A near-duplicate is not filtered out afterwards; it
 *     is never a candidate.
 *
 * 2 · THERE ARE NO WORDS. A layout arrives carrying the studio's picture, on
 *     the ground that was read off it, with its text areas EMPTY — which is
 *     what the product already does for a slide it cannot fill. Borrowing a
 *     sentence from another layout in the category would put the same words in
 *     the library twice; inventing one would be Bauhly writing in a studio's
 *     voice from nothing. The words arrive when the layout is used in a plan.
 *
 * The pictures decide the order: a dark photograph gets a composition that
 * wants a dark ground, a light one gets a light ground, and a composition that
 * takes no photograph is never offered for a picture the studio just added.
 */

import { COMPOSITIONS, kindsIn } from '../data/layouts.js';

/* the compositions this category could gain, best fit first for one picture.
 * `analysis` is the record read off that picture (lib/refanalysis.js) — it is
 * allowed to be missing, and then the fit is simply neutral. */
export function candidatesFor(cat, existing, analysis) {
  const have = kindsIn(existing, cat);
  const wantDark = analysis?.ground === 'dark';
  return COMPOSITIONS
    .filter((c) => !have.has(c.kind))
    /* the studio added a PICTURE — a composition with nowhere to put one is
       not an answer to that */
    .filter((c) => c.imgs > 0)
    .map((c) => ({
      ...c,
      /* a photo-ground composition suits a picture that can carry type; a dark
         picture can, a light one usually cannot */
      fit: (c.tone === 'photo' ? (wantDark ? 2 : 0) : 1),
    }))
    .sort((a, b) => b.fit - a.fit);
}

/* ONE PICTURE, ONE LAYOUT (Leon, Aug 7). It is the rule a studio can predict:
 * add three references to Hook and Hook gains three layouts, each a different
 * shape. If the category runs out of compositions it has not got, fewer are
 * made and the caller says so — quietly making two when three were asked for,
 * with no explanation, is the kind of silent truncation this product does not
 * do. */
export function buildLayouts({ cat, existing, refs, analysis, stamp }) {
  const made = [];
  const used = new Set();
  (refs || []).forEach((ref, i) => {
    const a = analysis?.[ref.id];
    const pick = candidatesFor(cat, [...existing, ...made], a).find((c) => !used.has(c.kind));
    if (!pick) return;
    used.add(pick.kind);
    made.push({
      id: `own-${cat}-${pick.kind}-${stamp}-${i}`,
      cat,
      name: pick.name,
      kind: pick.kind,
      /* the ground the picture actually has, not the one the template shipped
         with — a dark photograph under a light-ground template is a template
         choosing over a fact */
      tone: pick.tone === 'photo' ? 'photo' : (a?.ground === 'dark' ? 'photo' : pick.tone),
      levels: pick.levels,
      imgs: Array.from({ length: Math.max(1, pick.imgs) }, () => ref.url),
      /* no words. See the note at the top of this file. */
      art: {},
      /* where it came from, so a reference that is removed can be traced to
         what it produced */
      own: true,
      fromRef: ref.id,
      addedAt: stamp,
    });
  });
  return { made, short: (refs || []).length - made.length };
}
