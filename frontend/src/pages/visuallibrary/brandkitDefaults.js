/*
 * Shipped starter content for the Brand Kit — the same defaults bauhly-v3's demo
 * ships (see [[bauhly-v3-design-source]] `data/brandkit-demo.js`). Shown when an
 * account has saved none of its own; every asset is a file under /public, so
 * nothing here touches S3. A default is marked `shipped: true` — its edits are
 * session-local and the moment the studio adds its own (uploaded → S3, persisted
 * per handle) the real content takes over.
 */

/* four background textures under /assets/brand */
export const DEFAULT_BACKGROUNDS = [
  { key: 'default-offwhite', url: '/assets/brand/bg-offwhite.svg', title: 'Off-white', isDefault: true, shipped: true },
  { key: 'default-stone', url: '/assets/brand/bg-stone.svg', title: 'Stone', isDefault: false, shipped: true },
  { key: 'default-wood', url: '/assets/brand/bg-wood.svg', title: 'Wood', isDefault: false, shipped: true },
  { key: 'default-concrete', url: '/assets/brand/bg-concrete.svg', title: 'Concrete', isDefault: false, shipped: true },
];

const moodRef = (url, title) => ({ url, title, shipped: true });

/* three mood sets, each with the four role photographs under /assets/photo/mood */
export const DEFAULT_MOODS = [
  {
    id: 'default-mood-warm',
    name: 'Warm Minimal',
    note: 'Clean, warm and timeless spaces with natural materials.',
    isDefault: true,
    shipped: true,
    refs: {
      primary: moodRef('/assets/photo/mood/primary.png', 'Living room, morning'),
      materials: moodRef('/assets/photo/mood/warm-materials.png', 'Travertine, oak, terracotta, linen'),
      light: moodRef('/assets/photo/mood/light.png', 'Hallway, afternoon sun'),
      style: moodRef('/assets/photo/mood/style.png', 'Sideboard detail'),
    },
  },
  {
    id: 'default-mood-raw',
    name: 'Raw & Textured',
    note: 'Organic materials, textures and authentic details.',
    isDefault: false,
    shipped: true,
    refs: {
      primary: moodRef('/assets/photo/mood/raw-primary.png', 'Bench by the brick reveal'),
      materials: moodRef('/assets/photo/mood/raw-materials.png', 'Clay, limestone, jute, driftwood'),
      light: moodRef('/assets/photo/mood/raw-light.png', 'Plaster wall, low sun'),
      style: moodRef('/assets/photo/mood/raw-style.png', 'Shelf with stoneware'),
    },
  },
  {
    id: 'default-mood-airy',
    name: 'Bright & Airy',
    note: 'Light spaces with an open and relaxed atmosphere.',
    isDefault: false,
    shipped: true,
    refs: {
      primary: moodRef('/assets/photo/mood/airy-primary.png', 'Living room, sheer curtains'),
      materials: moodRef('/assets/photo/mood/airy-materials.png', 'Pale oak, limestone, linen'),
      light: moodRef('/assets/photo/mood/airy-light.png', 'Morning light through sheers'),
      style: moodRef('/assets/photo/mood/airy-style.png', 'Side table with jug'),
    },
  },
];
