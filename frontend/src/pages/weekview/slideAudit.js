// Layout audit for one RENDERED slide — what the Slide Edit agent cannot see
// from markup alone. Runs in the editor's own iframe (real fonts, real CSS) and
// returns plain-language problems the agent can act on in a repair pass:
//
//   · text over text     — glyph lines of two different text runs intersect
//   · outside the frame  — a text run's glyphs extend past the slide
//   · cut off            — an ancestor with hidden overflow clips the glyphs,
//                          or the run itself scrolls (content taller than box)
//   · too small to read  — headline / body text under ~2.2% of the slide width
//                          (kickers, labels, captions are small on purpose)
//
// Each problem is { key, say }: `key` names the KIND and the slots involved (not
// the words), so the editor can compare an audit taken before an edit with one
// taken after and only repair what the edit introduced.
// Measured on the TEXT (Range client rects per line), never on element boxes —
// a block-level <p> spans the column's full width, so boxes would report
// overlaps that no reader would ever see.

const SLOT_NAMES = {
  title: 'headline', eyebrow: 'kicker', kicker: 'kicker', subtitle: 'subtitle',
  'supporting-text': 'supporting line', body: 'body text', label: 'label', caption: 'caption',
  note: 'note', detail: 'detail', action: 'call to action', quote: 'quote', stat: 'stat', index: 'number',
};

function isUi(el) {
  return Boolean(el.closest?.('[data-wv-edit-ui]'));
}

function visible(el, win) {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  }
  return true;
}

function hasDirectText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

// The text runs a reader sees: a data-slot element, or the outermost element
// that carries text of its own. Nested inline marks (<em>) belong to their run.
function textRuns(root) {
  const runs = [];
  root.querySelectorAll('*').forEach((el) => {
    if (isUi(el) || /^(IMG|SVG|PICTURE|VIDEO|STYLE|SCRIPT|BR)$/i.test(el.tagName)) return;
    const slot = el.getAttribute('data-slot');
    const isRun = (slot && slot !== 'image' && slot !== 'illustration' && el.textContent.trim())
      || hasDirectText(el);
    if (!isRun) return;
    if (runs.some((r) => r.contains(el))) return; // inside a run already taken
    for (let i = runs.length - 1; i >= 0; i -= 1) if (el.contains(runs[i])) runs.splice(i, 1);
    runs.push(el);
  });
  return runs;
}

function lineRects(el) {
  const doc = el.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

function union(rects) {
  if (!rects.length) return null;
  const u = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  rects.forEach((r) => {
    u.left = Math.min(u.left, r.left); u.top = Math.min(u.top, r.top);
    u.right = Math.max(u.right, r.right); u.bottom = Math.max(u.bottom, r.bottom);
  });
  return u;
}

const READING_SLOTS = new Set(['title', 'subtitle', 'supporting-text', 'body', 'quote', 'stat']);
function slotOf(el) {
  return el.getAttribute('data-slot') || (/^H[1-3]$/.test(el.tagName) ? 'title' : el.tagName.toLowerCase());
}

function nameOf(el) {
  const slot = el.getAttribute('data-slot') || '';
  const kind = SLOT_NAMES[slot] || (/^H[1-3]$/.test(el.tagName) ? 'headline' : 'text');
  const words = el.textContent.replace(/\s+/g, ' ').trim();
  return `the ${kind} "${words.length > 42 ? `${words.slice(0, 40)}…` : words}"`;
}

export function auditSlideLayout(root) {
  if (!root?.ownerDocument?.defaultView) return [];
  const win = root.ownerDocument.defaultView;
  const R = root.getBoundingClientRect();
  if (R.width < 20 || R.height < 20) return [];
  const pctW = (px) => `${Math.round((px / R.width) * 100)}% of the slide width`;
  const pctH = (px) => `${Math.max(1, Math.round((px / R.height) * 100))}% of the slide height`;
  const issues = [];
  const add = (key, say) => { if (!issues.some((x) => x.key === key)) issues.push({ key, say }); };
  const runs = textRuns(root)
    .filter((el) => visible(el, win))
    .map((el) => ({ el, lines: lineRects(el) }))
    .filter((r) => r.lines.length);

  // text over text
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const A = runs[i]; const B = runs[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      let hit = null;
      for (const a of A.lines) {
        for (const b of B.lines) {
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w <= 2 || h <= 2) continue;
          const small = Math.min(a.width * a.height, b.width * b.height);
          if (w * h > small * 0.12) { hit = { h }; break; }
        }
        if (hit) break;
      }
      if (hit) {
        add(`overlap:${[slotOf(A.el), slotOf(B.el)].sort().join('|')}`,
          `${nameOf(A.el)} overlaps ${nameOf(B.el)} (by about ${pctH(hit.h)}). Reflow them so neither covers the other.`);
      }
    }
  }

  runs.forEach(({ el, lines }) => {
    const u = union(lines);
    // outside the frame
    const out = [];
    if (u.left < R.left - 2) out.push('left');
    if (u.right > R.right + 2) out.push('right');
    if (u.top < R.top - 2) out.push('top');
    if (u.bottom > R.bottom + 2) out.push('bottom');
    if (out.length) add(`outside:${slotOf(el)}`, `${nameOf(el)} runs outside the slide (${out.join(', ')} edge). Keep it inside the frame with margin.`);
    // cut off: the run's own box scrolls, or an ancestor that hides overflow
    // clips its glyphs (the slide edge is already reported above)
    const own = win.getComputedStyle(el);
    const scrolls = /(hidden|clip)/.test(`${own.overflowX} ${own.overflowY}`)
      && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
    if (scrolls) {
      add(`cut:${slotOf(el)}`, `${nameOf(el)} is cut off — its text is bigger than its box. Let the box grow or shorten the text.`);
    } else {
      for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
        const cs = win.getComputedStyle(n);
        if (!/(hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) continue;
        const b = n.getBoundingClientRect();
        if (u.bottom > b.bottom + 2 || u.right > b.right + 2 || u.top < b.top - 2 || u.left < b.left - 2) {
          add(`cut:${slotOf(el)}`, `${nameOf(el)} is cut off by its container. Give it room instead of clipping it.`);
          break;
        }
      }
    }
    // too small to read — reading text only
    const size = parseFloat(win.getComputedStyle(el).fontSize) || 0;
    const words = el.textContent.trim().split(/\s+/).length;
    if (READING_SLOTS.has(slotOf(el)) && words > 3 && size && size < R.width * 0.022) {
      add(`small:${slotOf(el)}`, `${nameOf(el)} is too small to read on a phone (${pctW(size)}). Make it at least about 3%.`);
    }
  });

  return issues.slice(0, 8);
}

// What the slide REALLY looks like, for the Slide Edit agent: the model sees the
// slide's html but not the carousel's theme CSS, and that CSS decides the type
// size — a headline with no inline font-size can render at 90px+ and run into a
// line positioned for a 32px one. So the editor measures the live slide and
// sends compact metrics: the canvas size, and per text run its font, size,
// line-height, line count and box (px in the slide's own coordinate space, the
// same space its inline left/top/width values use). Images get their box too.
export function measureSlide(root) {
  if (!root?.ownerDocument?.defaultView) return null;
  const win = root.ownerDocument.defaultView;
  const R = root.getBoundingClientRect();
  if (R.width < 20 || R.height < 20) return null;
  // bounding rects are post-transform screen px; the slide's own px may be
  // scaled — convert back to the slide's layout px
  const k = (root.offsetWidth || R.width) / R.width;
  const px = (v) => Math.round(v * k);
  const box = (r) => ({ x: px(r.left - R.left), y: px(r.top - R.top), w: px(r.width), h: px(r.height) });
  const runs = textRuns(root)
    .filter((el) => visible(el, win))
    .map((el) => {
      const lines = lineRects(el);
      if (!lines.length) return null;
      const u = union(lines);
      const cs = win.getComputedStyle(el);
      const lineTops = new Set(lines.map((r) => Math.round(r.top)));
      return {
        slot: slotOf(el),
        tag: el.tagName.toLowerCase(),
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 48),
        font: `${cs.fontWeight} ${Math.round(parseFloat(cs.fontSize) || 0)}px/${cs.lineHeight === 'normal' ? 'normal' : `${Math.round(parseFloat(cs.lineHeight) || 0)}px`} ${String(cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim()}`,
        lines: lineTops.size,
        position: cs.position,
        box: box({ left: u.left, top: u.top, width: u.right - u.left, height: u.bottom - u.top }),
      };
    })
    .filter(Boolean);
  const images = [...root.querySelectorAll('img')]
    .filter((img) => visible(img, win))
    .map((img) => ({ slot: img.getAttribute('data-slot') || 'img', box: box(img.getBoundingClientRect()) }))
    .filter((i) => i.box.w > 4 && i.box.h > 4);
  return { width: px(R.width), height: px(R.height), runs, images };
}

// The theme CSS that actually applies to THIS slide, for the Slide Edit agent.
// A carousel document carries every slide's rules (and, in older runs, several
// directions' worth), so the whole stylesheet is mostly noise. This keeps only:
//   · style rules whose selector matches the slide, one of its elements, or an
//     ancestor (the direction <section>, body, html — where theme variables live),
//   · @media / @supports blocks around kept rules,
//   · @font-face for families the slide really uses, and @import (fonts).
// Edit-UI styles are skipped. Matched on the live DOM, so it is exact.
export function slideCssOf(root, max = 14000) {
  const doc = root?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return '';
  const els = [root, ...root.querySelectorAll('*')].filter((el) => !isUi(el));
  for (let n = root.parentElement; n; n = n.parentElement) els.push(n);
  const families = new Set();
  els.forEach((el) => {
    String(win.getComputedStyle(el).fontFamily || '').split(',')
      .forEach((f) => families.add(f.replace(/["']/g, '').trim().toLowerCase()));
  });
  // `:hover`, `::before` etc. never match a static query — test the base selector
  const base = (sel) => sel.replace(/::?[a-z-]+(\([^)]*\))?/gi, (m) => (/^:(not|is|where|has)\(/i.test(m) ? m : '')).trim() || '*';
  const applies = (selectorText) => String(selectorText || '').split(',').some((part) => {
    try { return els.some((el) => el.matches(base(part))); } catch { return false; }
  });
  const keep = (rules) => {
    const out = [];
    [...rules].forEach((r) => {
      if (r.type === 1) { // CSSStyleRule
        if (applies(r.selectorText)) out.push(r.cssText);
      } else if (r.type === 4 || r.type === 12) { // @media / @supports
        const inner = keep(r.cssRules);
        if (inner.length) out.push(`${r.cssText.slice(0, r.cssText.indexOf('{'))}{\n${inner.join('\n')}\n}`);
      } else if (r.type === 5) { // @font-face
        const fam = String(r.style?.getPropertyValue('font-family') || '').replace(/["']/g, '').trim().toLowerCase();
        if (families.has(fam)) out.push(r.cssText);
      } else if (r.type === 3) { // @import
        out.push(r.cssText);
      }
    });
    return out;
  };
  const kept = [];
  [...doc.styleSheets].forEach((sheet) => {
    if (sheet.ownerNode?.hasAttribute?.('data-wv-edit-ui')) return;
    let rules;
    try { rules = sheet.cssRules; } catch { return; } // cross-origin font css
    kept.push(...keep(rules));
  });
  let css = [...new Set(kept)].join('\n');
  if (css.length > max) {
    // font faces are the least useful to the model — drop them first
    css = [...new Set(kept)].filter((r) => !/^@font-face/i.test(r)).join('\n');
  }
  return css.length > max ? `${css.slice(0, max)}\n/* …truncated */` : css;
}
