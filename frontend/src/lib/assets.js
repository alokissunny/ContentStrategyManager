/*
 * What a project's captured material can become — the slim slice the Visual
 * Brand needs.
 *
 * The reference's full `assets.js` also composes formats and reads plan/material
 * intent from a capture's words; the Visual Brand only reaches for two things:
 * `SLIDE_KINDS` (to name what a dimension unlocks, in the studio's words) and
 * `assetsOf` (how many photographs a layout can count on). Those are ported
 * faithfully; the rest is the plan's job, not this page's.
 */

/* the slide types, each naming where it comes from. `from: 'asset'` means an
   existing file fills it; `'derived'` means it is made out of one — a crop, a
   line of type over it; `'made'` is the only kind that needs a generator. */
export const SLIDE_KINDS = {
  hero: { label: 'Hero image', from: 'asset' },
  detail: { label: 'Detail crop', from: 'derived' },
  material: { label: 'Material highlight', from: 'asset' },
  beforeAfter: { label: 'Before / after', from: 'asset' },
  annotated: { label: 'Annotated explanation', from: 'derived' },
  decision: { label: 'Design decision', from: 'derived' },
  process: { label: 'Process insight', from: 'asset' },
  quote: { label: 'Quote', from: 'derived' },
  plan: { label: 'Floor plan explained', from: 'asset' },
  type: { label: 'Typography slide', from: 'derived' },
  timeline: { label: 'Project timeline', from: 'derived' },
  supporting: { label: 'Supporting visual', from: 'made' },
};

/* how much material a project holds. The layout system reads `.photos` — how
   many shots a composition can count on — and nothing else here, so the richer
   plan/material tallies the reference keeps are left at zero rather than
   re-deriving them from a capture's words. */
export function assetsOf(project) {
  const captures = project?.captures || [];
  const a = { photos: 0, videos: 0, seconds: 0, voice: 0, notes: 0, plans: 0, materials: 0 };
  captures.forEach((c) => {
    (c.attachments || []).forEach((att) => {
      if (att.type === 'video') { a.videos += 1; a.seconds += att.durationSeconds || 0; return; }
      a.photos += 1;
    });
    if (c.type === 'voice' || c.audioUrl) a.voice += 1;
    if (c.type === 'note' && !(c.attachments || []).length) a.notes += 1;
  });
  return a;
}
