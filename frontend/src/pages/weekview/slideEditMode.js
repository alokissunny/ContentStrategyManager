// Experimental "Edit mode" — a Canva-lite direct manipulator for a rendered
// slide. The slide already lives in a same-origin iframe (see DynamicLayout),
// so this reaches straight into `frame.contentDocument` and layers plain DOM
// nodes (hover outline, selection box, eight resize handles) over the agent's
// own markup, positioned with `getBoundingClientRect()` — which is always in
// the iframe's own viewport space, so it stays correct regardless of any CSS
// transform/scale the parent applies to the <iframe> element itself for the
// carousel-crop preview.
//
// Edits are applied as a `transform: translate()` (move) plus explicit
// `width`/`height` (resize) on the target element's inline style. They are
// visual-only and client-side for this pass — nothing is written back to the
// slide's stored layoutHtml, and a re-render (theme swap, applying a layout,
// picking a new photo) discards them along with the rest of the iframe doc.

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
// center before it snaps there — Canva's "smart guide" alignment behaviour.
const SNAP_PX = 6;

const STYLE_TEXT = `
  [data-wv-edit-ui] { position: fixed; box-sizing: border-box; z-index: 2147483000; }
  .wv-edit-hover {
    pointer-events: none; border: 1.5px dashed rgba(31,107,255,.65);
    border-radius: 2px;
  }
  .wv-edit-sel {
    pointer-events: none; border: 1.5px solid #1f6bff; border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255,255,255,.9);
  }
  .wv-edit-sel--texting { border-color: #16a34a; }
  .wv-edit-handle {
    width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
    background: #fff; border: 1.5px solid #1f6bff; border-radius: 3px;
  }
  .wv-edit-reset {
    pointer-events: auto; display: flex; align-items: center; gap: 4px;
    padding: 3px 8px 3px 6px; border-radius: 999px; background: #1f6bff;
    color: #fff; font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    cursor: pointer; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,.18);
  }
  .wv-edit-reset:hover { background: #1554cc; }
  .wv-edit-tip {
    pointer-events: none; background: #16161a; color: #fff;
    font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 3px 8px; border-radius: 6px; white-space: nowrap;
    transform: translate(-50%, -100%);
  }
  .wv-edit-guide { pointer-events: none; background: #ff3d81; }
  .wv-edit-guide--v { width: 1px; }
  .wv-edit-guide--h { height: 1px; }
  body.wv-edit-on { cursor: default; user-select: none; }
  .wv-edit-texting, .wv-edit-texting * {
    cursor: text !important; user-select: text !important;
  }
`;

function isUi(el) {
  return Boolean(el && el.closest && el.closest('[data-wv-edit-ui]'));
}

function within(el, root) {
  if (!root) return true;
  return root === el || (root.contains && root.contains(el));
}

const NON_TEXT_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'BR', 'HR']);

function hasDirectText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

// Double-click enters inline text editing — only for elements that plausibly
// hold their own words (a heading, a paragraph, a leaf label), never a photo
// or a layout wrapper whose "text" is really its children's.
function isTextEditable(el) {
  if (!el || NON_TEXT_TAGS.has(el.tagName)) return false;
  if (hasDirectText(el)) return true;
  return !el.children.length && Boolean(el.textContent.trim());
}

// Elements too structural to usefully "move" on their own — picking the
// slide root or its immediate frame would just drag the whole canvas.
function selectableFrom(target, root, doc) {
  let el = target;
  while (el && el !== doc.documentElement) {
    if (isUi(el)) return null;
    if (el === root) return null;
    if (within(el, root) && el.nodeType === 1) return el;
    el = el.parentElement;
  }
  return null;
}

export function attachSlideEditMode(frame, { root: rootEl } = {}) {
  const doc = frame?.contentDocument;
  const win = frame?.contentWindow;
  if (!doc || !win || !doc.body) return () => {};

  const root = rootEl && doc.contains(rootEl) ? rootEl : doc.body;

  const style = doc.createElement('style');
  style.setAttribute('data-wv-edit-ui', '1');
  style.textContent = STYLE_TEXT;
  doc.head?.appendChild(style);
  doc.body.classList.add('wv-edit-on');

  const hoverBox = doc.createElement('div');
  hoverBox.setAttribute('data-wv-edit-ui', '1');
  hoverBox.className = 'wv-edit-hover';
  hoverBox.style.display = 'none';
  doc.body.appendChild(hoverBox);

  const selBox = doc.createElement('div');
  selBox.setAttribute('data-wv-edit-ui', '1');
  selBox.className = 'wv-edit-sel';
  selBox.style.display = 'none';
  doc.body.appendChild(selBox);

  const resetChip = doc.createElement('div');
  resetChip.setAttribute('data-wv-edit-ui', '1');
  resetChip.className = 'wv-edit-reset';
  resetChip.style.display = 'none';
  resetChip.textContent = 'Reset';
  doc.body.appendChild(resetChip);

  const tip = doc.createElement('div');
  tip.setAttribute('data-wv-edit-ui', '1');
  tip.className = 'wv-edit-tip';
  tip.style.display = 'none';
  doc.body.appendChild(tip);

  const guideV = doc.createElement('div');
  guideV.setAttribute('data-wv-edit-ui', '1');
  guideV.className = 'wv-edit-guide wv-edit-guide--v';
  guideV.style.display = 'none';
  doc.body.appendChild(guideV);

  const guideH = doc.createElement('div');
  guideH.setAttribute('data-wv-edit-ui', '1');
  guideH.className = 'wv-edit-guide wv-edit-guide--h';
  guideH.style.display = 'none';
  doc.body.appendChild(guideH);

  const handles = HANDLE_POS.map((pos) => {
    const h = doc.createElement('div');
    h.setAttribute('data-wv-edit-ui', '1');
    h.dataset.pos = pos;
    h.className = 'wv-edit-handle';
    h.style.display = 'none';
    h.style.cursor = CURSOR_FOR[pos];
    doc.body.appendChild(h);
    return h;
  });

  let selected = null;
  let activeDrag = null; // { onMove, onUp } — cancelled on detach
  let editingText = null;
  let editOrigHtml = '';
  const origHtmlMap = new WeakMap();

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

  function positionUi() {
    hoverBox.style.display = hoverBox.dataset.on === '1' ? 'block' : 'none';
    if (!selected || !selected.isConnected) {
      selBox.style.display = 'none';
      resetChip.style.display = 'none';
      handles.forEach((h) => { h.style.display = 'none'; });
      return;
    }
    const r = selected.getBoundingClientRect();
    const texting = selected === editingText;
    selBox.style.display = 'block';
    selBox.classList.toggle('wv-edit-sel--texting', texting);
    selBox.style.left = `${r.left}px`;
    selBox.style.top = `${r.top}px`;
    selBox.style.width = `${r.width}px`;
    selBox.style.height = `${r.height}px`;
    handles.forEach((h) => {
      const p = handlePoint(h.dataset.pos, r);
      h.style.display = texting ? 'none' : 'block';
      h.style.left = `${p.x}px`;
      h.style.top = `${p.y}px`;
    });
    const edited = selected.dataset.wvEdited === '1';
    resetChip.style.display = edited && !texting ? 'flex' : 'none';
    resetChip.style.left = `${r.right - 6}px`;
    resetChip.style.top = `${Math.max(4, r.top - 24)}px`;
  }

  function moveHoverTo(el) {
    if (!el) { hoverBox.dataset.on = '0'; positionUi(); return; }
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

  // Canva-style smart guide: a magenta line through the slide's own center
  // as soon as the dragged element's center comes within SNAP_PX of it.
  // Returns how far off-center the element still is on each axis, so the
  // caller can pull it the rest of the way in (the actual "snap").
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

  function captureBase(el) {
    if (el.dataset.wvBaseTransform === undefined) {
      el.dataset.wvBaseTransform = el.style.transform || '';
    }
    return el.dataset.wvBaseTransform;
  }

  function select(el) {
    if (editingText && el !== editingText) commitTextEdit();
    selected = el || null;
    if (selected && selected.dataset.wvEdited === undefined) {
      selected.dataset.wvEdited = '0';
      selected.dataset.wvOrigStyle = selected.getAttribute('style') || '';
      origHtmlMap.set(selected, selected.innerHTML);
    }
    moveHoverTo(null);
    positionUi();
  }

  function endDrag() {
    if (!activeDrag) return;
    win.removeEventListener('mousemove', activeDrag.onMove);
    win.removeEventListener('mouseup', activeDrag.onUp);
    activeDrag = null;
    hideTip();
    hideGuides();
  }

  function startMove(el, startX, startY) {
    const baseTx = parseFloat(el.dataset.wvTx || '0');
    const baseTy = parseFloat(el.dataset.wvTy || '0');
    const base = captureBase(el);
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let tx = baseTx + dx;
      let ty = baseTy + dy;
      el.style.transform = `${base ? `${base} ` : ''}translate(${tx}px, ${ty}px)`;
      let rect = el.getBoundingClientRect();
      const snap = centerGuides(rect);
      if (snap.snapX || snap.snapY) {
        tx += snap.dx;
        ty += snap.dy;
        el.style.transform = `${base ? `${base} ` : ''}translate(${tx}px, ${ty}px)`;
        rect = el.getBoundingClientRect();
      }
      el.dataset.wvTx = String(tx);
      el.dataset.wvTy = String(ty);
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) el.dataset.wvEdited = '1';
      const rr = root.getBoundingClientRect();
      showTip(`x ${Math.round(rect.left - rr.left)}, y ${Math.round(rect.top - rr.top)}`, rect);
      positionUi();
    };
    const onUp = () => endDrag();
    activeDrag = { onMove, onUp };
    win.addEventListener('mousemove', onMove);
    win.addEventListener('mouseup', onUp, { once: true });
  }

  function startResize(el, pos, startX, startY) {
    const spec = HANDLE_SPEC[pos];
    const rect = el.getBoundingClientRect();
    const startW = rect.width;
    const startH = rect.height;
    const baseTx = parseFloat(el.dataset.wvTx || '0');
    const baseTy = parseFloat(el.dataset.wvTy || '0');
    const base = captureBase(el);
    if (!el.style.boxSizing) el.style.boxSizing = 'border-box';
    // A flex/grid child otherwise ignores (or stretches past) an explicit
    // width/height — flex-basis and stretch alignment both override it. Opt
    // this one element out so the drag actually has a visible effect.
    if (spec.dw !== 0 && !el.style.flex) el.style.flex = 'none';
    if (!el.style.alignSelf) el.style.alignSelf = 'flex-start';
    if (!el.style.justifySelf) el.style.justifySelf = 'start';
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (spec.dw !== 0) el.style.width = `${Math.max(MIN_SIZE, startW + spec.dw * dx)}px`;
      if (spec.dh !== 0) el.style.height = `${Math.max(MIN_SIZE, startH + spec.dh * dy)}px`;
      const tx = baseTx + spec.tx * dx;
      const ty = baseTy + spec.ty * dy;
      el.style.transform = `${base ? `${base} ` : ''}translate(${tx}px, ${ty}px)`;
      el.dataset.wvTx = String(tx);
      el.dataset.wvTy = String(ty);
      el.dataset.wvEdited = '1';
      const rect = el.getBoundingClientRect();
      showTip(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect);
      positionUi();
    };
    const onUp = () => endDrag();
    activeDrag = { onMove, onUp };
    win.addEventListener('mousemove', onMove);
    win.addEventListener('mouseup', onUp, { once: true });
  }

  function resetSelected() {
    if (!selected) return;
    const orig = selected.dataset.wvOrigStyle || '';
    if (orig) selected.setAttribute('style', orig);
    else selected.removeAttribute('style');
    if (origHtmlMap.has(selected)) selected.innerHTML = origHtmlMap.get(selected);
    delete selected.dataset.wvTx;
    delete selected.dataset.wvTy;
    delete selected.dataset.wvBaseTransform;
    selected.dataset.wvEdited = '0';
    positionUi();
  }

  function onTextBlur() { commitTextEdit(); }
  function onTextKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); }
  }

  function startTextEdit(el) {
    if (editingText === el) return;
    if (editingText) commitTextEdit();
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
    positionUi();
  }

  function commitTextEdit() {
    if (!editingText) return;
    const el = editingText;
    el.contentEditable = 'false';
    el.classList.remove('wv-edit-texting');
    el.removeEventListener('blur', onTextBlur);
    el.removeEventListener('keydown', onTextKeydown);
    if (el.innerHTML !== editOrigHtml) el.dataset.wvEdited = '1';
    editingText = null;
    positionUi();
  }

  function cancelTextEdit() {
    if (!editingText) return;
    editingText.innerHTML = editOrigHtml;
    commitTextEdit();
  }

  function onMouseOver(e) {
    if (activeDrag) return;
    const el = selectableFrom(e.target, root, doc);
    if (!el || el === selected) { moveHoverTo(null); return; }
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
      if (e.target.closest('.wv-edit-reset')) {
        e.preventDefault();
        e.stopPropagation();
        resetSelected();
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

  doc.addEventListener('mouseover', onMouseOver);
  doc.addEventListener('mouseout', onMouseOut);
  doc.addEventListener('mousedown', onMouseDown);
  doc.addEventListener('dblclick', onDblClick);
  doc.addEventListener('click', onClickCapture, true);

  const ro = typeof win.ResizeObserver !== 'undefined'
    ? new win.ResizeObserver(() => positionUi())
    : null;
  ro?.observe(doc.documentElement);
  const onWinResize = () => positionUi();
  win.addEventListener('resize', onWinResize);

  return function detach() {
    endDrag();
    commitTextEdit();
    ro?.disconnect();
    win.removeEventListener('resize', onWinResize);
    doc.removeEventListener('mouseover', onMouseOver);
    doc.removeEventListener('mouseout', onMouseOut);
    doc.removeEventListener('mousedown', onMouseDown);
    doc.removeEventListener('dblclick', onDblClick);
    doc.removeEventListener('click', onClickCapture, true);
    doc.body?.classList.remove('wv-edit-on');
    [style, hoverBox, selBox, resetChip, tip, guideV, guideH, ...handles].forEach((node) => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  };
}
