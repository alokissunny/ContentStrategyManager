// Photo Focus: crop each slide photo around the part its words need seen.
//
// The backend's Photo Focus agent marks a photo `<img data-focus="x y w h">`
// (percent of the photo). The layout fills its space with the photo
// (`object-fit: cover`) and the copy often lies over part of it, so a centred
// crop can hide the very thing the slide talks about. Here the photo is shifted
// (object-position, in px) so the focus box sits in the part of the photo the
// copy leaves visible. Where the copy covers an edge, the photo may slide
// under it past its own edge — the panel hides the gap — but never out of a
// visible part of the slide.

// how far (share of the photo's height / width) the photo still has to run
// under a covering panel: its top edge is often a fade, not solid
const UNDER = 0.09;

function parseFocus(v) {
  const n = String(v || '').trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return null;
  const [x, y, w, h] = n;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

const alphaOf = (color) => {
  const m = String(color || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return color === 'transparent' ? 0 : 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
};

// Boxes (photo-local px) of what lies over the photo: text, and panels with a
// fill of their own. Other pictures and the photo's own frame are not.
function coverOf(img, r, k) {
  const doc = img.ownerDocument;
  const win = doc.defaultView;
  const scope = img.closest('article, section, .slide') || doc.body;
  const W = r.width;
  const H = r.height;
  const boxes = [];
  scope.querySelectorAll('*').forEach((el) => {
    if (el === img || el.contains(img) || el.tagName === 'IMG' || el.closest('[data-wv-edit-ui]')) return;
    if (/^(STYLE|SCRIPT|BR|SOURCE|PICTURE|svg)$/i.test(el.tagName)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const filled = cs.backgroundImage !== 'none' || alphaOf(cs.backgroundColor) >= 0.5;
    if (!text && !filled) return;
    const b = el.getBoundingClientRect();
    const x0 = Math.max(0, b.left - r.left);
    const y0 = Math.max(0, b.top - r.top);
    const x1 = Math.min(W, b.right - r.left);
    const y1 = Math.min(H, b.bottom - r.top);
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    // a fill over (nearly) the whole photo is behind it or a tint — not a panel
    if (filled && !text && (x1 - x0) * (y1 - y0) > W * H * 0.9) return;
    boxes.push({ x0: x0 / k, y0: y0 / k, x1: x1 / k, y1: y1 / k });
  });
  if (!boxes.length) return null;
  return boxes.reduce((u, b) => ({
    x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1),
  }));
}

// The visible window of the photo (v0..v1 on each axis) and the stretch it
// must stay covered on (c0..c1).
function windowOf(img, Rw, Rh) {
  const r = img.getBoundingClientRect();
  const k = r.width / Rw || 1;
  const all = { x: [0, Rw, 0, Rw], y: [0, Rh, 0, Rh] };
  const u = coverOf(img, r, k);
  if (!u) return all;
  if (u.x1 - u.x0 >= Rw * 0.6) {
    const above = u.y0;
    const below = Rh - u.y1;
    if (Math.max(above, below) < Rh * 0.2) return all;
    return above >= below
      ? { x: all.x, y: [0, u.y0, 0, Math.min(Rh, u.y0 + Rh * UNDER)] }
      : { x: all.x, y: [u.y1, Rh, Math.max(0, u.y1 - Rh * UNDER), Rh] };
  }
  if (u.y1 - u.y0 >= Rh * 0.6) {
    const left = u.x0;
    const right = Rw - u.x1;
    if (Math.max(left, right) < Rw * 0.2) return all;
    return left >= right
      ? { y: all.y, x: [0, u.x0, 0, Math.min(Rw, u.x0 + Rw * UNDER)] }
      : { y: all.y, x: [u.x1, Rw, Math.max(0, u.x1 - Rw * UNDER), Rw] };
  }
  return all;
}

// how far the picture is shifted on one axis (it starts at -d)
function shiftOn(I, [v0, v1, c0, c1], f0, f1) {
  const lo = -c0; // the picture still covers from c0 …
  const hi = I - c1; // … to c1
  const d = ((f0 + f1) / 200) * I - (v0 + v1) / 2;
  return Math.max(lo, Math.min(hi, d));
}

export function focusPhoto(img) {
  const f = parseFocus(img.getAttribute('data-focus'));
  const win = img.ownerDocument?.defaultView;
  if (!f || !win) return;
  if (win.getComputedStyle(img).objectFit !== 'cover') return;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const Rw = img.clientWidth;
  const Rh = img.clientHeight;
  if (!nw || !nh || !Rw || !Rh) return;
  const s = Math.max(Rw / nw, Rh / nh);
  const w = windowOf(img, Rw, Rh);
  const dx = shiftOn(nw * s, w.x, f.x, f.x + f.w);
  const dy = shiftOn(nh * s, w.y, f.y, f.y + f.h);
  img.style.setProperty('object-position', `${Math.round(-dx)}px ${Math.round(-dy)}px`, 'important');
}

// Every focused photo in the document — now if it has loaded, else on load.
// Safe to call again after any repaint (fonts, a crop, new copy).
export function focusPhotos(doc) {
  if (!doc) return;
  doc.querySelectorAll('img[data-focus]').forEach((img) => {
    if (img.dataset.focusWatch !== '1') {
      img.dataset.focusWatch = '1';
      img.addEventListener('load', () => focusPhoto(img));
    }
    if (img.complete && img.naturalWidth) focusPhoto(img);
  });
}
