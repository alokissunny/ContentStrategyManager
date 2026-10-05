// A slide the Theme Apply agent turned into a picture: drawn in a
// `themed-image[-sN]` section AND carrying its render (`…/themed-<uuid>.jpg`).
// The section alone is not enough — a slide added next to a themed one could
// land in that section with only HTML in it, and it is no picture.
export function isThemedPicture(slide) {
  if (!/^themed-image/.test(String(slide?.layoutTheme || ''))) return false;
  return [...(Array.isArray(slide?.assetKeys) ? slide.assetKeys : []), slide?.assetKey]
    .some((k) => /\/themed-/.test(String(k || '')));
}
