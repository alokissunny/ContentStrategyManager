/*
 * Seed material for the Visual Brand.
 *
 * The reference reads the studio's OWN photographs out of Projects — the Visual
 * Brand is a view over that material, never a second copy of it (see
 * lib/visualbrand.js `ownReferences`). The live app has a real Projects backend
 * (`projectsStore`), but the Visual Brand's palette-reader and layout previews
 * need same-origin pictures to sample, so this seeds a small studio archive
 * from the demo stills shipped under `public/assets/photo/ph/`. That is what
 * makes "Read from 12 of your own pictures" true, and gives Visual Style a real
 * palette to read rather than a placeholder.
 */

export const SEED_VERSION = 1;

const PH = (f) => `/assets/photo/ph/${f}`;

/* twelve of the demo stills — enough for `ownReferences`' standing dozen, and
   enough for `readPalette` to sample a real off-white / oak / ink palette */
const SHOTS = [
  'ph-mon-1.jpg', 'ph-tue-1.jpg', 'ph-tue-4.jpg', 'ph-sat.jpg',
  'ph-mon-3.jpg', 'ph-tue-2.jpg', 'ph-sun.jpg', 'ph-mon-5.jpg',
  'ph-tue-3.jpg', 'ph-mon-2.jpg', 'ph-tue-5.jpg', 'ph-tue-6.jpg',
];

export function seedProjects() {
  const now = Date.now();
  const captures = SHOTS.map((f, i) => ({
    id: `seed-cap-${i}`,
    type: 'photo',
    text: 'From the studio archive',
    createdAt: new Date(now - i * 86400000).toISOString(),
    attachments: [{ id: `seed-att-${i}`, type: 'image', url: PH(f), thumbnailUrl: PH(f) }],
  }));
  return [{
    id: 'seed-archive',
    name: 'Studio archive',
    client: '',
    location: '',
    captures,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  }];
}
