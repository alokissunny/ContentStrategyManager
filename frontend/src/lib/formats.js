/*
 * What the studio can ask Bauhly to make from a capture — the format panel at
 * the end of Capture (components/FormatPicker.jsx), ported from bauhly-v3
 * `lib/formats.js` (editor/selbar-ai-button, decisions 1153–1181).
 *
 * The choice is kept on the capture (`capture.make`, PATCH /projects/:id/captures/:cid)
 * and read by plan generation (backend planOrchestrator › captureMakeOf):
 *   · carousel — a post; `layout` picks the carousel agent's layout prompt
 *                ('auto' = the Settings layout)
 *   · static   — a single-image post; `images.ids[0]` is the studio's photo (key)
 *   · reel     — a Capture reel (POST /capture-reels) with `reel` preferences
 *   · story    — a Story (9:16 frames) written by its own Strategy + Layout agents
 * One format per capture: choosing a row replaces the choice (bestFormat picks the default).
 */

export const MAKE_IDS = ['carousel', 'reel', 'static', 'story'];

export const MAKE = {
  carousel: { name: 'Carousel', say: 'Tell a story across multiple slides.', icon: 'layers', post: true },
  reel: { name: 'Reel', say: 'Combine video, images and motion.', icon: 'clapper', reach: true },
  static: { name: 'Static post', say: 'Create posts from project images.', icon: 'image', post: true },
  story: { name: 'Story', say: 'Share a short visual update.', icon: 'slide-one' },
};

/* the carousel agent's layouts (backend runtimeSettings.CAROUSEL_LAYOUTS), in the mock's order;
   `auto` = Bauhly decides (the Settings layout) */
export const LAYOUTS = [
  { id: 'auto', name: 'Bauhly decides' },
  { id: 'full-bleed', name: 'Full bleed' },
  { id: 'split-bands', name: 'Split band' },
  { id: 'floating-panel', name: 'Floating panel' },
  { id: 'editorial', name: 'Editorial' },
];

/* a capture's attachments as the panel draws them */
export const materialOf = (attachments = []) => (attachments || [])
  .filter((a) => a && a.key && a.reelTake !== 'say')
  .map((a) => ({ ...a, video: a.type === 'video', seconds: Number(a.durationSeconds || a.analysis?.durationSec) || 0 }));

/* a Reel is offered whenever the capture holds any photo or video (user, 2026-11-24 — was: a clip or ≥ 2 photos);
   the reel director moves a single still with motion */
export const canMake = (id, assets = []) => {
  if (id !== 'reel') return true;
  return assets.length > 0;
};

export const blankMake = (best = 'carousel') => ({
  formats: [best],
  layout: 'auto',
  images: { pick: 'auto', ids: [] },
  // `say`: Include voiceover ('in') opens VoicePrep after Continue — the studio records the script
  reel: { graphics: 'in', music: 'auto', say: 'out' },
});

export const makeOf = (held, best = 'carousel') => {
  const base = blankMake(best);
  if (!held || typeof held !== 'object') return base;
  return {
    ...base,
    ...held,
    formats: Array.isArray(held.formats) ? held.formats : base.formats,
    images: { ...base.images, ...(held.images || {}) },
    reel: { ...base.reel, ...(held.reel || {}) },
  };
};

/* one format per capture (user, 2026-11-25): choosing a row replaces the choice; the chosen row stays chosen */
export const withFormat = (make, id) => ({ ...make, formats: [id] });

/* the format a capture arrives with: the Capture agent's recommendation (from the narrative and the material)
   when the capture can carry it, else a reading of the material alone */
export const bestFormat = (recommended, assets = []) => {
  const rec = String(recommended || '');
  if (MAKE[rec] && canMake(rec, assets)) return rec;
  const clips = assets.filter((a) => a.video).length;
  if (clips) return 'reel';
  if (assets.length === 1) return 'static';
  return 'carousel';
};

export const fmtClock = (secs) => {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
