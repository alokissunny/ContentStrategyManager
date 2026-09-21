// Fixed, local backgrounds: no remote assets or generated CSS in reel specs.
export const REEL_BACKGROUNDS = [
  { id: 'original', name: 'Original', background: '#242429' },
  { id: 'studio', name: 'Studio', background: 'radial-gradient(ellipse at 20% 10%, #44465a, #13141c 75%)' },
  { id: 'cream', name: 'Warm cream', background: 'linear-gradient(145deg, #fff8e9, #dfcbb0)' },
  { id: 'sunset', name: 'Sunset', background: 'linear-gradient(155deg, #ffd194, #ed7895 52%, #7962b5)' },
  { id: 'ocean', name: 'Ocean', background: 'linear-gradient(155deg, #a0eee4, #3889ac 55%, #18385b)' },
  { id: 'lilac', name: 'Lilac', background: 'radial-gradient(ellipse at top left, #eee2ff, #b4a1d9 55%, #78669b)' },
];

export function getReelBackground(id) {
  return REEL_BACKGROUNDS.find((template) => template.id === id) || REEL_BACKGROUNDS[0];
}
