// "Edit mode" — a Canva-lite direct manipulator for a rendered slide. The slide
// already lives in a same-origin iframe (see DynamicLayout), so this reaches
// straight into `frame.contentDocument` and layers plain DOM nodes (hover
// outline, selection box, eight resize handles, a rotate knob) over the agent's
// own markup, positioned with `getBoundingClientRect()` — always in the
// iframe's own viewport space, so it stays correct regardless of any CSS
// transform/scale the parent applies to the <iframe> element itself.
//
// Move = `translate()`, rotate = `rotate()` (both composed onto whatever
// transform the element had), resize = explicit `width`/`height`. Text is
// typed in place (double-click). Style commands (bold / italic / underline /
// size / colour / align / hide) arrive from the host's toolbar via `api.run`.
//
// ── EDITS ARE PATCHES ───────────────────────────────────────────────────────
// Every committed change is recorded as a PATCH keyed by the element's path
// from the slide root (child indices, e.g. "0/2/1"):
//   { css: { 'font-size': '64px', … }, geo: { tx, ty, rot, base }, html }
// The host keeps them (`onCommit(patches)`), hands them back on the next attach
// (`patches`) so switching slides and back keeps the work, can replace them
// wholesale (`api.setPatches` — undo/redo), and bakes them into the stored
// slide HTML on Apply (`bakeSlidePatches`). Nothing here writes to the server.

const HANDLE_POS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Per-handle resize behaviour: dw/dh are the ±1 multiplier of mouse delta
// applied to width/height; tx/ty are 1 when that edge's own movement must be
// compensated with a translate so the OPPOSITE edge/corner stays put.
const HANDLE_SPEC = {
  n: { dw: 0, dh: -1, tx: 0, ty: 1 },
  s: { dw: 0, dh: 1, tx: 0, ty: 0 },
  e: { dw: 1, dh: 0, tx: 0, ty: 0 },
  w: { dw: -1, dh: 0, tx: 1, ty: 0 },
  ne: { dw: 1, dh: -1, tx: 0, ty: 1 },
  nw: { dw: -1, dh: -1, tx: 1, ty: 1 },
  se: { dw: 1, dh: 1, tx: 0, ty: 0 },
  sw: { dw: -1, dh: 1, tx: 1, ty: 0 },
};

const CURSOR_FOR = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
};

const MIN_SIZE = 16;
// How close (px) the dragged element's center has to get to the slide's own
// center before it snaps and a guide shows.
const SNAP_PX = 6;
// Rotation snaps to the nearest 15° within this many degrees.
const ROT_SNAP = 4;

// Inline style properties a resize touches (recorded into the patch).
const RESIZE_PROPS = ['width', 'height', 'flex', 'align-self', 'justify-self', 'box-sizing', 'max-width'];

const STYLE_TEXT = `
  [data-wv-edit-ui] { position: fixed; box-sizing: border-box; z-index: 2147483000; }
  .wv-edit-hover {
    pointer-events: none; border: 1.5px dashed rgba(31,107,255,.65);
    border-radius: 2px;
  }
  .wv-edit-sel {
    pointer-events: none; border: 2px solid #1f6bff; border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(255,255,255,.9);
    transform-origin: 50% 50%;
  }
  .wv-edit-sel--texting { border-color: #16a34a; }
  .wv-edit-handle {
    width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px;
    background: #fff; border: 2px solid #1f6bff; border-radius: 4px;
  }
  .wv-edit-rot {
    width: 18px; height: 18px; margin: -9px 0 0 -9px;
    background: #fff; border: 2px solid #1f6bff; border-radius: 50%;
    cursor: grab;
  }
  .wv-edit-tip {
    pointer-events: none; background: #16161a; color: #fff;
    font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 3px 8px; border-radius: 6px; white-space: nowrap;
    transform: translate(-50%, -100%);
  }
  .wv-edit-guide { pointer-events: none; background: #ff3d81; }
  .wv-edit-guide--v { width: 1px; }
  .wv-edit-guide--h { height: 1px; }
  body.wv-edit-on { cursor: default; user-select: none; }
  /* the hand over anything selectable; a closed hand while it is being moved.
     Flagged on <html> (never on the slide's own nodes, which get baked). */
  html.wv-edit-point, html.wv-edit-point * { cursor: pointer; }
  html.wv-edit-grabbing, html.wv-edit-grabbing * { cursor: grabbing !important; }
  .wv-edit-texting, .wv-edit-texting * {
    cursor: text !important; user-select: text !important; outline: none;
  }
`;

// Inline wrappers are never the thing a studio means to pick — a press on an
// <em> inside a headline selects the headline.
const INLINE_TAGS = new Set(['SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'MARK', 'SMALL', 'A', 'BR', 'SUP', 'SUB', 'S', 'CODE']);
const NON_TEXT_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'BR', 'HR', 'PICTURE']);

function isUi(el) {
  return Boolean(el && el.closest && el.closest('[data-wv-edit-ui]'));
}

function within(el, root) {
  if (!root) return true;
  return root === el || (root.contains && root.contains(el));
}

function hasDirectText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

function isTextEditable(el) {
  if (!el || NON_TEXT_TAGS.has(el.tagName)) return false;
  if (hasDirectText(el)) return true;
  return !el.querySelector('img, svg, video, canvas, picture') && Boolean(el.textContent.trim());
}

function kindOf(el, win) {
  if (!el) return null;
  if (el.tagName === 'IMG' || el.tagName === 'PICTURE' || el.tagName === 'VIDEO') return 'image';
  const bg = win.getComputedStyle(el).backgroundImage;
  if (bg && bg !== 'none' && /url\(/.test(bg) && !el.textContent.trim()) return 'image';
  if (isTextEditable(el)) return 'text';
  return 'box';
}

function selectableFrom(target, root, doc) {
  let el = target;
  if (el && el.nodeType === 3) el = el.parentElement;
  while (el && el !== doc.documentElement) {
    if (isUi(el)) return null;
    if (el === root) return null;
    if (within(el, root) && el.nodeType === 1) break;
    el = el.parentElement;
  }
  if (!el || el === doc.documentElement || el === root || !within(el, root)) return null;
  // climb out of inline wrappers (and <svg> internals) to the block they sit in
  while (el.parentElement && el.parentElement !== root
    && (INLINE_TAGS.has(el.tagName) || el instanceof el.ownerDocument.defaultView.SVGElement && el.tagName.toLowerCase() !== 'svg')) {
    el = el.parentElement;
  }
  return el;
}

// Path of `el` from `root` as element-child indices, skipping edit UI.
export function pathOf(el, root) {
  const parts = [];
  let node = el;
  while (node && node !== root) {
    const parent = node.parentElement;
    if (!parent) return null;
    const kids = [...parent.children].filter((c) => !c.hasAttribute('data-wv-edit-ui'));
    parts.unshift(kids.indexOf(node));
    node = parent;
  }
  return node === root ? parts.join('/') : null;
}

export function nodeAt(root, path) {
  if (!root || path == null) return null;
  if (path === '') return root;
  let node = root;
  for (const part of String(path).split('/')) {
    const kids = [...node.children].filter((c) => !c.hasAttribute('data-wv-edit-ui'));
    node = kids[Number(part)];
    if (!node) return null;
  }
  return node;
}

export function transformOf(geo) {
  const g = geo || {};
  const bits = [];
  if (g.base) bits.push(g.base);
  if (g.tx || g.ty) bits.push(`translate(${Number(g.tx) || 0}px, ${Number(g.ty) || 0}px)`);
  if (g.rot) bits.push(`rotate(${Number(g.rot) || 0}deg)`);
  return bits.join(' ');
}

// Write one patch onto an element (live DOM or a parsed copy of the stored html).
export function applyPatchTo(el, patch) {
  if (!el || !patch) return;
  if (typeof patch.html === 'string') el.innerHTML = patch.html;
  Object.entries(patch.css || {}).forEach(([prop, value]) => {
    if (value === '' || value == null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, value);
  });
  if (patch.geo) {
    const t = transformOf(patch.geo);
    if (t) el.style.setProperty('transform', t);
    else el.style.removeProperty('transform');
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v || {}));

export function attachSlideEditMode(frame, {
  root: rootEl,
  patches: initialPatches = null,
  onCommit = null,
  onSelect = null,
  onUndo = null,
  onRedo = null,
} = {}) {
  const doc = frame?.contentDocument;
  const win = frame?.contentWindow;
  const noop = () => {};
  if (!doc || !win || !doc.body) {
    noop.api = null;
    return noop;
  }

  const root = rootEl && doc.contains(rootEl) ? rootEl : doc.body;

  const style = doc.createElement('style');
  style.setAttribute('data-wv-edit-ui', '1');
  style.textContent = STYLE_TEXT;
  doc.head?.appendChild(style);
  doc.body.classList.add('wv-edit-on');

  const ui = (cls) => {
    const n = doc.createElement('div');
    n.setAttribute('data-wv-edit-ui', '1');
    n.className = cls;
    n.style.display = 'none';
    doc.body.appendChild(n);
    return n;
  };
  const hoverBox = ui('wv-edit-hover');
  const selBox = ui('wv-edit-sel');
  const tip = ui('wv-edit-tip');
  const guideV = ui('wv-edit-guide wv-edit-guide--v');
  const guideH = ui('wv-edit-guide wv-edit-guide--h');
  const rotKnob = ui('wv-edit-rot');
  const handles = HANDLE_POS.map((pos) => {
    const h = ui('wv-edit-handle');
    h.dataset.pos = pos;
    h.style.cursor = CURSOR_FOR[pos];
    return h;
  });

  let selected = null;
  let activeDrag = null; // { onMove, onUp } — cancelled on detach
  let editingText = null;
  let editOrigHtml = '';
  // path → { el, style, html } — the element as it was before any edit
  const originals = new Map();
  let patches = clone(initialPatches);

  function remember(el) {
    const path = pathOf(el, root);
    if (path == null) return null;
    if (!originals.has(path)) {
      originals.set(path, {
        el,
        style: el.getAttribute('style'),
        html: el.innerHTML,
      });
    }
    return path;
  }

  function geoOf(el) {
    const path = pathOf(el, root);
    const g = (path != null && patches[path]?.geo) || null;
    if (g) return { ...g };
    const orig = path != null ? originals.get(path) : null;
    // the element's own transform (from its original inline style) is the base
    let base = '';
    if (orig) {
      const probe = doc.createElement('div');
      probe.setAttribute('style', orig.style || '');
      base = probe.style.transform || '';
    } else {
      base = el.style.transform || '';
    }
    return { tx: 0, ty: 0, rot: 0, base };
  }

  function record(el, { props = [], geo = null, html = false } = {}) {
    const path = remember(el);
    if (path == null) return;
    const next = { ...(patches[path] || {}) };
    if (props.length) {
      next.css = { ...(next.css || {}) };
      props.forEach((p) => { next.css[p] = el.style.getPropertyValue(p) || ''; });
    }
    if (geo) next.geo = { ...geo };
    if (html) next.html = el.innerHTML;
    patches = { ...patches, [path]: next };
  }

  function commit() {
    onCommit?.(clone(patches));
    emitSelect();
  }

  function restoreAll() {
    originals.forEach((o) => {
      if (!o.el.isConnected) return;
      if (o.style == null) o.el.removeAttribute('style');
      else o.el.setAttribute('style', o.style);
      o.el.innerHTML = o.html;
    });
  }

  function applyAll() {
    Object.entries(patches).forEach(([path, patch]) => {
      const el = nodeAt(root, path);
      if (!el) return;
      remember(el);
      applyPatchTo(el, patch);
    });
  }

  function setPatches(next) {
    if (editingText) cancelTextEdit();
    restoreAll();
    patches = clone(next);
    applyAll();
    if (selected && !selected.isConnected) selected = null;
    positionUi();
  }

  // ── geometry of the chrome ───────────────────────────────────────────────
  function handlePoint(pos, r) {
    const midX = r.left + r.width / 2;
    const midY = r.top + r.height / 2;
    if (pos === 'nw') return { x: r.left, y: r.top };
    if (pos === 'n') return { x: midX, y: r.top };
    if (pos === 'ne') return { x: r.right, y: r.top };
    if (pos === 'e') return { x: r.right, y: midY };
    if (pos === 'se') return { x: r.right, y: r.bottom };
    if (pos === 's') return { x: midX, y: r.bottom };
    if (pos === 'sw') return { x: r.left, y: r.bottom };
    return { x: r.left, y: midY }; // 'w'
  }

  let selRaf = 0;
  function emitSelect() {
    if (!onSelect) return;
    if (selRaf) win.cancelAnimationFrame(selRaf);
    selRaf = win.requestAnimationFrame(() => {
      selRaf = 0;
      if (!selected || !selected.isConnected) { onSelect(null); return; }
      const r = selected.getBoundingClientRect();
      const cs = win.getComputedStyle(selected);
      const path = pathOf(selected, root);
      onSelect({
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        kind: kindOf(selected, win),
        texting: selected === editingText,
        edited: Boolean(path != null && patches[path]),
        path,
        tag: selected.tagName.toLowerCase(),
        slot: selected.getAttribute('data-slot') || '',
        text: (selected.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        hasImg: Boolean(selected.matches('img') || selected.querySelector('img[src]')),
        style: {
          bold: Number(cs.fontWeight) >= 600,
          italic: cs.fontStyle === 'italic',
          underline: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''),
          fontSize: parseFloat(cs.fontSize) || 0,
          color: cs.color,
          align: cs.textAlign,
          opacity: parseFloat(cs.opacity),
        },
      });
    });
  }

  function positionUi() {
    hoverBox.style.display = hoverBox.dataset.on === '1' ? 'block' : 'none';
    if (!selected || !selected.isConnected) {
      selBox.style.display = 'none';
      rotKnob.style.display = 'none';
      handles.forEach((h) => { h.style.display = 'none'; });
      emitSelect();
      return;
    }
    const r = selected.getBoundingClientRect();
    const texting = selected === editingText;
    // A rotated element is outlined as ITSELF (its own box, turned), not by
    // the axis-aligned rectangle around it.
    const path = pathOf(selected, root);
    const rot = Number((path != null && patches[path]?.geo?.rot) || 0);
    const live = selected.dataset.wvGeo ? JSON.parse(selected.dataset.wvGeo) : null;
    const angle = Number(live?.rot ?? rot) || 0;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const w = angle ? (selected.offsetWidth || r.width) : r.width;
    const h = angle ? (selected.offsetHeight || r.height) : r.height;
    const rad = (angle * Math.PI) / 180;
    const turn = (x, y) => ({
      x: cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
      y: cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad),
    });
    const box = { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2, width: w, height: h };
    selBox.style.display = 'block';
    selBox.classList.toggle('wv-edit-sel--texting', texting);
    selBox.style.left = `${box.left}px`;
    selBox.style.top = `${box.top}px`;
    selBox.style.width = `${w}px`;
    selBox.style.height = `${h}px`;
    selBox.style.transform = angle ? `rotate(${angle}deg)` : '';
    handles.forEach((hd) => {
      const p0 = handlePoint(hd.dataset.pos, box);
      const p = angle ? turn(p0.x, p0.y) : p0;
      hd.style.display = texting ? 'none' : 'block';
      hd.style.left = `${p.x}px`;
      hd.style.top = `${p.y}px`;
    });
    // the rotate knob hangs off the lower-left corner (bauhly-v3 `edm-hands__spin`)
    const k = angle ? turn(box.left - 22, box.bottom + 22) : { x: box.left - 22, y: box.bottom + 22 };
    rotKnob.style.display = texting ? 'none' : 'block';
    rotKnob.style.left = `${k.x}px`;
    rotKnob.style.top = `${k.y}px`;
    emitSelect();
  }

  function moveHoverTo(el) {
    doc.documentElement.classList.toggle('wv-edit-point', Boolean(el));
    if (!el) { hoverBox.dataset.on = '0'; hoverBox.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    hoverBox.dataset.on = '1';
    hoverBox.style.left = `${r.left}px`;
    hoverBox.style.top = `${r.top}px`;
    hoverBox.style.width = `${r.width}px`;
    hoverBox.style.height = `${r.height}px`;
    hoverBox.style.display = 'block';
  }

  function showTip(text, rect) {
    tip.textContent = text;
    tip.style.left = `${rect.left + rect.width / 2}px`;
    tip.style.top = `${Math.max(20, rect.top - 8)}px`;
    tip.style.display = 'block';
  }
  function hideTip() { tip.style.display = 'none'; }

  function centerGuides(rect) {
    const rr = root.getBoundingClientRect();
    const rootCenterX = rr.left + rr.width / 2;
    const rootCenterY = rr.top + rr.height / 2;
    const elCenterX = rect.left + rect.width / 2;
    const elCenterY = rect.top + rect.height / 2;
    const snapX = Math.abs(elCenterX - rootCenterX) < SNAP_PX;
    const snapY = Math.abs(elCenterY - rootCenterY) < SNAP_PX;
    guideV.style.display = snapX ? 'block' : 'none';
    if (snapX) {
      guideV.style.left = `${rootCenterX}px`;
      guideV.style.top = `${rr.top}px`;
      guideV.style.height = `${rr.height}px`;
    }
    guideH.style.display = snapY ? 'block' : 'none';
    if (snapY) {
      guideH.style.top = `${rootCenterY}px`;
      guideH.style.left = `${rr.left}px`;
      guideH.style.width = `${rr.width}px`;
    }
    return {
      snapX, snapY, dx: snapX ? rootCenterX - elCenterX : 0, dy: snapY ? rootCenterY - elCenterY : 0,
    };
  }
  function hideGuides() {
    guideV.style.display = 'none';
    guideH.style.display = 'none';
  }

  function select(el) {
    if (editingText && el !== editingText) commitTextEdit();
    selected = el || null;
    if (selected) remember(selected);
    moveHoverTo(null);
    positionUi();
  }

  function endDrag() {
    if (!activeDrag) return;
    win.removeEventListener('mousemove', activeDrag.onMove);
    win.removeEventListener('mouseup', activeDrag.onUp);
    activeDrag = null;
    doc.documentElement.classList.remove('wv-edit-grabbing');
    hideTip();
    hideGuides();
  }

  function startMove(el, startX, startY) {
    const geo = geoOf(el);
    let moved = false;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      if (!moved) doc.documentElement.classList.add('wv-edit-grabbing');
      moved = true;
      let next = { ...geo, tx: geo.tx + dx, ty: geo.ty + dy };
      el.style.transform = transformOf(next);
      let rect = el.getBoundingClientRect();
      const snap = centerGuides(rect);
      if (snap.snapX || snap.snapY) {
        next = { ...next, tx: next.tx + snap.dx, ty: next.ty + snap.dy };
        el.style.transform = transformOf(next);
        rect = el.getBoundingClientRect();
      }
      el.dataset.wvGeo = JSON.stringify(next);
      const rr = root.getBoundingClientRect();
      showTip(`x ${Math.round(rect.left - rr.left)}, y ${Math.round(rect.top - rr.top)}`, rect);
      positionUi();
    };
    const onUp = () => {
      endDrag();
      if (!moved) return;
      const next = JSON.parse(el.dataset.wvGeo || 'null') || geo;
      delete el.dataset.wvGeo;
      record(el, { geo: next });
      commit();
    };
    activeDrag = { onMove, onUp };
    win.addEventListener('mousemove', onMove);
    win.addEventListener('mouseup', onUp, { once: true });
  }

  function startResize(el, pos, startX, startY) {
    const spec = HANDLE_SPEC[pos];
    const rect = el.getBoundingClientRect();
    const startW = el.offsetWidth || rect.width;
    const startH = el.offsetHeight || rect.height;
    const geo = geoOf(el);
    if (!el.style.boxSizing) el.style.boxSizing = 'border-box';
    if (spec.dw !== 0 && !el.style.flex) el.style.flex = 'none';
    if (spec.dw !== 0) el.style.maxWidth = 'none';
    if (!el.style.alignSelf) el.style.alignSelf = 'flex-start';
    if (!el.style.justifySelf) el.style.justifySelf = 'start';
    let next = geo;
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (spec.dw !== 0) el.style.width = `${Math.max(MIN_SIZE, startW + spec.dw * dx)}px`;
      if (spec.dh !== 0) el.style.height = `${Math.max(MIN_SIZE, startH + spec.dh * dy)}px`;
      next = { ...geo, tx: geo.tx + spec.tx * dx, ty: geo.ty + spec.ty * dy };
      el.style.transform = transformOf(next);
      const r = el.getBoundingClientRect();
      showTip(`${Math.round(r.width)} × ${Math.round(r.height)}`, r);
      positionUi();
    };
    const onUp = () => {
      endDrag();
      record(el, { props: RESIZE_PROPS, geo: next });
      commit();
    };
    activeDrag = { onMove, onUp };
    win.addEventListener('mousemove', onMove);
    win.addEventListener('mouseup', onUp, { once: true });
  }

  function startRotate(el, startX, startY) {
    const geo = geoOf(el);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a0 = Math.atan2(startY - cy, startX - cx);
    let next = geo;
    const onMove = (ev) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let rot = (Number(geo.rot) || 0) + ((a - a0) * 180) / Math.PI;
      rot = ((rot + 540) % 360) - 180;
      const near = Math.round(rot / 15) * 15;
      if (Math.abs(rot - near) < ROT_SNAP) rot = near;
      next = { ...geo, rot: Math.round(rot * 10) / 10 };
      el.style.transform = transformOf(next);
      el.dataset.wvGeo = JSON.stringify(next);
      showTip(`${Math.round(next.rot)}°`, el.getBoundingClientRect());
      positionUi();
    };
    const onUp = () => {
      endDrag();
      delete el.dataset.wvGeo;
      record(el, { geo: next });
      commit();
    };
    activeDrag = { onMove, onUp };
    win.addEventListener('mousemove', onMove);
    win.addEventListener('mouseup', onUp, { once: true });
  }

  // ── the toolbar's commands ───────────────────────────────────────────────
  function run(cmd, value) {
    const el = selected;
    if (!el || !el.isConnected) return;
    if (editingText) commitTextEdit();
    const cs = win.getComputedStyle(el);
    const setAndRecord = (prop, v) => {
      el.style.setProperty(prop, v);
      record(el, { props: [prop] });
    };
    switch (cmd) {
      case 'bold':
        setAndRecord('font-weight', Number(cs.fontWeight) >= 600 ? '400' : '700');
        break;
      case 'italic':
        setAndRecord('font-style', cs.fontStyle === 'italic' ? 'normal' : 'italic');
        break;
      case 'underline':
        setAndRecord('text-decoration', /underline/.test(cs.textDecorationLine || '') ? 'none' : 'underline');
        break;
      case 'uppercase':
        setAndRecord('text-transform', cs.textTransform === 'uppercase' ? 'none' : 'uppercase');
        break;
      case 'size': {
        // value: a factor (1.1 / 0.9) or an absolute px number (as a string "64px")
        const now = parseFloat(cs.fontSize) || 16;
        const px = typeof value === 'string' ? parseFloat(value) : Math.round(now * (Number(value) || 1));
        setAndRecord('font-size', `${Math.max(6, Math.min(600, px))}px`);
        break;
      }
      case 'color':
        setAndRecord('color', String(value || ''));
        break;
      case 'align':
        setAndRecord('text-align', String(value || 'left'));
        break;
      case 'opacity':
        setAndRecord('opacity', String(value));
        break;
      case 'front':
      case 'back': {
        if (cs.position === 'static') el.style.setProperty('position', 'relative');
        el.style.setProperty('z-index', cmd === 'front' ? '50' : '0');
        record(el, { props: ['position', 'z-index'] });
        break;
      }
      case 'hide':
        el.style.setProperty('display', 'none');
        record(el, { props: ['display'] });
        selected = null;
        break;
      case 'reset': {
        const path = pathOf(el, root);
        const orig = path != null ? originals.get(path) : null;
        if (orig) {
          if (orig.style == null) el.removeAttribute('style');
          else el.setAttribute('style', orig.style);
          el.innerHTML = orig.html;
        }
        if (path != null) {
          const next = { ...patches };
          delete next[path];
          patches = next;
        }
        break;
      }
      case 'type':
        if (isTextEditable(el)) startTextEdit(el);
        positionUi();
        return;
      default:
        return;
    }
    commit();
    positionUi();
  }

  // ── typing in place ──────────────────────────────────────────────────────
  function onTextBlur() { commitTextEdit(); }
  function onTextKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelTextEdit(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitTextEdit(); }
  }
  function onTextInput() { positionUi(); }

  function startTextEdit(el) {
    if (editingText === el) return;
    if (editingText) commitTextEdit();
    remember(el);
    editingText = el;
    editOrigHtml = el.innerHTML;
    el.contentEditable = 'true';
    el.classList.add('wv-edit-texting');
    el.focus();
    const range = doc.createRange();
    range.selectNodeContents(el);
    const sel = win.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.addEventListener('blur', onTextBlur);
    el.addEventListener('keydown', onTextKeydown);
    el.addEventListener('input', onTextInput);
    positionUi();
  }

  function stopTexting(el) {
    el.removeAttribute('contenteditable');
    el.classList.remove('wv-edit-texting');
    if (!el.getAttribute('class')) el.removeAttribute('class');
    el.removeEventListener('blur', onTextBlur);
    el.removeEventListener('keydown', onTextKeydown);
    el.removeEventListener('input', onTextInput);
    editingText = null;
  }

  function commitTextEdit() {
    if (!editingText) return;
    const el = editingText;
    stopTexting(el);
    if (el.innerHTML !== editOrigHtml) {
      record(el, { html: true });
      commit();
    }
    positionUi();
  }

  function cancelTextEdit() {
    if (!editingText) return;
    const el = editingText;
    el.innerHTML = editOrigHtml;
    stopTexting(el);
    positionUi();
  }

  // ── pointer ──────────────────────────────────────────────────────────────
  function onMouseOver(e) {
    if (activeDrag) return;
    const el = selectableFrom(e.target, root, doc);
    if (!el || el === selected) {
      moveHoverTo(null);
      if (el && el !== editingText) doc.documentElement.classList.add('wv-edit-point');
      return;
    }
    moveHoverTo(el);
  }

  function onMouseOut(e) {
    if (activeDrag) return;
    if (isUi(e.relatedTarget)) return;
    moveHoverTo(null);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    // Inside the element currently being typed into: let the browser place
    // the caret / extend a selection normally, no custom drag.
    if (editingText && (e.target === editingText || editingText.contains(e.target))) return;
    if (isUi(e.target)) {
      if (e.target.closest('.wv-edit-rot') && selected) {
        e.preventDefault();
        e.stopPropagation();
        startRotate(selected, e.clientX, e.clientY);
        return;
      }
      const handle = e.target.closest('.wv-edit-handle');
      if (handle && selected) {
        e.preventDefault();
        e.stopPropagation();
        startResize(selected, handle.dataset.pos, e.clientX, e.clientY);
      }
      return;
    }
    e.preventDefault();
    const el = selectableFrom(e.target, root, doc);
    select(el);
    if (el) startMove(el, e.clientX, e.clientY);
  }

  function onDblClick(e) {
    if (isUi(e.target)) return;
    const el = selectableFrom(e.target, root, doc);
    if (!el || !isTextEditable(el)) return;
    e.preventDefault();
    select(el);
    startTextEdit(el);
  }

  // Edit mode never lets the slide's own links/buttons fire while editing.
  function onClickCapture(e) {
    if (editingText && (e.target === editingText || editingText.contains(e.target))) return;
    if (!isUi(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }

  // Keys inside the iframe never reach the host page, so the ones the Editor
  // answers are handled (or forwarded) here.
  function onKeyDown(e) {
    if (editingText) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) onRedo?.(); else onUndo?.();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); onRedo?.(); return; }
    if (!selected) return;
    if (e.key === 'Escape') { e.preventDefault(); select(null); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); run('hide'); return; }
    if (e.key === 'Enter') { e.preventDefault(); run('type'); return; }
    const step = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      const g = geoOf(selected);
      const next = { ...g, tx: g.tx + arrows[e.key][0], ty: g.ty + arrows[e.key][1] };
      selected.style.transform = transformOf(next);
      record(selected, { geo: next });
      commit();
      positionUi();
    }
  }

  doc.addEventListener('mouseover', onMouseOver);
  doc.addEventListener('mouseout', onMouseOut);
  doc.addEventListener('mousedown', onMouseDown);
  doc.addEventListener('dblclick', onDblClick);
  doc.addEventListener('click', onClickCapture, true);
  doc.addEventListener('keydown', onKeyDown);

  const ro = typeof win.ResizeObserver !== 'undefined'
    ? new win.ResizeObserver(() => positionUi())
    : null;
  ro?.observe(doc.documentElement);
  const onWinResize = () => positionUi();
  win.addEventListener('resize', onWinResize);
  win.addEventListener('scroll', onWinResize, true);

  // Work carried over from an earlier visit to this slide.
  applyAll();

  function detach() {
    endDrag();
    commitTextEdit();
    if (selRaf) win.cancelAnimationFrame(selRaf);
    onSelect?.(null);
    ro?.disconnect();
    win.removeEventListener('resize', onWinResize);
    win.removeEventListener('scroll', onWinResize, true);
    doc.removeEventListener('mouseover', onMouseOver);
    doc.removeEventListener('mouseout', onMouseOut);
    doc.removeEventListener('mousedown', onMouseDown);
    doc.removeEventListener('dblclick', onDblClick);
    doc.removeEventListener('click', onClickCapture, true);
    doc.removeEventListener('keydown', onKeyDown);
    doc.body?.classList.remove('wv-edit-on');
    doc.documentElement.classList.remove('wv-edit-point', 'wv-edit-grabbing');
    [style, hoverBox, selBox, tip, guideV, guideH, rotKnob, ...handles].forEach((node) => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  }

  detach.api = {
    run,
    setPatches,
    deselect: () => select(null),
    reposition: positionUi,
    frame,
  };
  return detach;
}

// ── baking ────────────────────────────────────────────────────────────────
// Write a slide's patches into its stored html. `findRoot(doc)` locates the
// slide root in the parsed copy (the same element DynamicLayout edited live).
// Returns the new html, or the input unchanged when nothing could be placed.
export function bakeSlidePatches(html, patches, findRoot, { isDocument = false } = {}) {
  const raw = String(html || '');
  const entries = Object.entries(patches || {});
  if (!raw || !entries.length || typeof DOMParser === 'undefined') return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const root = findRoot(doc);
  if (!root) return raw;
  let placed = 0;
  entries.forEach(([path, patch]) => {
    const el = nodeAt(root, path);
    if (!el) return;
    applyPatchTo(el, patch);
    placed += 1;
  });
  if (!placed) return raw;
  if (isDocument || /<html[\s>]/i.test(raw) || /<!doctype/i.test(raw)) {
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }
  // a fragment: DOMParser hoists leading <style>/<link> into <head> — keep them
  return `${doc.head?.innerHTML || ''}${doc.body?.innerHTML || ''}`;
}

// Swap a slide's whole <article> in its stored html for a new one (the prompt
// band's result). Same root-finding and serialisation as `bakeSlidePatches`.
export function replaceSlideArticle(html, nextArticle, findRoot, { isDocument = false } = {}) {
  const raw = String(html || '');
  if (!raw || !nextArticle || typeof DOMParser === 'undefined') return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const root = findRoot(doc);
  if (!root) return raw;
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(nextArticle).trim();
  const fresh = tpl.content.firstElementChild;
  if (!fresh) return raw;
  root.replaceWith(doc.importNode(fresh, true));
  if (isDocument || /<html[\s>]/i.test(raw) || /<!doctype/i.test(raw)) {
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }
  return `${doc.head?.innerHTML || ''}${doc.body?.innerHTML || ''}`;
}

// The stored <article> for a slide, and the CSS it is drawn with.
export function slideArticleOf(html, findRoot, { maxCss = 30000 } = {}) {
  const raw = String(html || '');
  if (!raw || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const root = findRoot(doc);
  if (!root) return null;
  const css = [...doc.querySelectorAll('style')].map((st) => st.textContent || '').join('\n');
  return { html: root.outerHTML, css: css.length > maxCss ? css.slice(0, maxCss) : css };
}
