/**
 * Discover every editable text run on a carousel / layout-agent slide so
 * Edit text can show one field per visible line (not just Heading + Body).
 */
import { plainOf } from '../../lib/slidetext';

const MEDIA_SLOTS = new Set(['image', 'illustration']);
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'SVG', 'PATH', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT',
  'IMG', 'VIDEO', 'SOURCE', 'BR', 'HR', 'NOSCRIPT',
]);

const SLOT_META = {
  title: { label: 'Heading', typeSlot: 'headline', marked: true },
  subtitle: { label: 'Subtitle', typeSlot: 'body', marked: false },
  'supporting-text': { label: 'Body', typeSlot: 'body', marked: false },
  body: { label: 'Body', typeSlot: 'body', marked: false },
  eyebrow: { label: 'Eyebrow', typeSlot: 'detail', marked: false },
  kicker: { label: 'Kicker', typeSlot: 'detail', marked: false },
  label: { label: 'Label', typeSlot: 'detail', marked: false },
  caption: { label: 'Caption', typeSlot: 'detail', marked: false },
  note: { label: 'Note', typeSlot: 'detail', marked: false },
  detail: { label: 'Detail', typeSlot: 'detail', marked: false },
  quote: { label: 'Quote', typeSlot: 'headline', marked: false },
  stat: { label: 'Number', typeSlot: 'headline', marked: false },
  action: { label: 'Action', typeSlot: 'body', marked: false },
  annotation: { label: 'Annotation', typeSlot: 'detail', marked: false },
  index: { label: 'Index', typeSlot: 'detail', marked: false },
  accent: { label: 'Accent', typeSlot: 'detail', marked: false },
  comparisonA: { label: 'Side A', typeSlot: 'body', marked: false },
  comparisonB: { label: 'Side B', typeSlot: 'body', marked: false },
  items: { label: 'List', typeSlot: 'body', marked: false },
};

function titleCaseSlot(name) {
  return String(name || '')
    .replace(/^line-/, 'Line ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Text';
}

export function metaForSlotName(name) {
  return SLOT_META[name] || { label: titleCaseSlot(name), typeSlot: 'body', marked: false };
}

export function parseRoleSlotKey(key) {
  const raw = String(key || '');
  const m = raw.match(/^(.*)#(\d+)$/);
  if (m) return { slot: m[1], at: Number(m[2]) || 0, line: false };
  if (/^line-\d+$/.test(raw)) {
    return { slot: raw, at: 0, line: true, lineAt: Number(raw.slice(5)) || 0 };
  }
  return { slot: raw, at: 0, line: false };
}

function slideArticleOf(html, { direction, index } = {}) {
  const raw = String(html || '');
  if (!raw || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const idx = String(Number(index) > 0 ? Number(index) : 1);
  const dir = String(direction || '').trim();
  if (dir) {
    const scoped = [...doc.querySelectorAll(`section[data-direction="${dir}"] article.slide`)];
    if (scoped.length) {
      return scoped.find((el) => String(el.getAttribute('data-index')) === idx)
        || scoped[Number(idx) - 1]
        || scoped[0];
    }
  }
  const all = [...doc.querySelectorAll('article.slide, article[data-index], .slide')];
  return all.find((el) => String(el.getAttribute('data-index')) === idx)
    || all[Number(idx) - 1]
    || doc.querySelector('article.slide, .slide, article')
    || null;
}

/** Inline marks only — a div/span that wraps other text runs must be walked. */
function hasOnlyInlineMarks(el) {
  return ![...el.children].some((c) => !/^(EM|I|STRONG|B|BR|WBR)$/.test(c.tagName));
}

function isEditableTextElement(el) {
  if (!el || el.nodeType !== 1) return false;
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (el.closest('svg, script, style, button, noscript')) return false;
  const slot = el.getAttribute('data-slot');
  if (slot && MEDIA_SLOTS.has(slot)) return false;
  // Slotted roots are always one field (title may contain <em>, etc.).
  if (slot) return true;
  if (!/^(H[1-6]|P|FIGCAPTION|BLOCKQUOTE|LI|SPAN|DIV|SMALL|LABEL)$/.test(el.tagName)) {
    return false;
  }
  // Nested under a slotted ancestor → already covered by that slot.
  if (el.parentElement?.closest('[data-slot]')) return false;
  if (el.querySelector('h1,h2,h3,h4,h5,h6,p,figcaption,blockquote,li,[data-slot]')) return false;
  // Do not collapse "LEON'S HOME" + "THE STAIR" into one Body field: walk into
  // unlabeled wrappers that hold multiple text children.
  if (/^(DIV|SPAN)$/.test(el.tagName) && !hasOnlyInlineMarks(el)) return false;
  const text = plainOf(el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > 0;
}

function guessLineLabel(el) {
  const blob = `${el.className || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
  if (/eyebrow|kicker/.test(blob)) return 'Eyebrow';
  if (/caption|figcaption/.test(blob) || el.tagName === 'FIGCAPTION') return 'Caption';
  if (/note|disclaimer|aside/.test(blob)) return 'Note';
  if (/label|meta|tag|brand|handle/.test(blob)) return 'Label';
  if (/footer|foot|credit/.test(blob)) return 'Footer';
  if (/action|cta|next|nav/.test(blob)) return 'Action';
  if (/quote|pull/.test(blob) || el.tagName === 'BLOCKQUOTE') return 'Quote';
  if (/^H[1-6]$/.test(el.tagName)) return 'Heading';
  if (el.tagName === 'P') return 'Body';
  return 'Line';
}

export function collectEditableElements(slide) {
  if (!slide) return [];
  const out = [];
  const walk = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (isEditableTextElement(node)) {
      out.push(node);
      return;
    }
    [...node.children].forEach(walk);
  };
  walk(slide);
  return out;
}

function roleKeyForSlot(slotName, occurrence, counts) {
  const total = counts[slotName] || 1;
  if (total <= 1) return slotName;
  return `${slotName}#${occurrence}`;
}

function textFromEditable(el, marked) {
  const leaf = el?.querySelector?.('h1, h2, h3, h4, h5, h6, p') || el;
  if (!leaf) return '';
  if (!marked) return plainOf(leaf.textContent || '').replace(/\s+/g, ' ').trim();
  let out = '';
  leaf.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent || '';
    else if (n.nodeType === 1 && /^(EM|I)$/.test(n.nodeName)) {
      const t = plainOf(n.textContent || '').trim();
      if (t) out += `{{accent|${t}}}`;
    } else if (n.nodeType === 1) out += n.textContent || '';
  });
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Reading-order roles for Edit text on an agent HTML slide.
 * → [{ key, label, slot, hint, htmlSlot, occurrence, marked, text, lineAt? }]
 */
export function discoverSlideTextRoles(html, { direction, index } = {}) {
  const slide = slideArticleOf(html, { direction, index });
  if (!slide) return [];
  const els = collectEditableElements(slide);
  const counts = {};
  const lineLabelTotals = {};
  els.forEach((el) => {
    const slot = el.getAttribute('data-slot') || 'line';
    counts[slot] = (counts[slot] || 0) + 1;
    if (!el.getAttribute('data-slot')) {
      const base = guessLineLabel(el);
      lineLabelTotals[base] = (lineLabelTotals[base] || 0) + 1;
    }
  });
  const seen = {};
  const roles = [];
  els.forEach((el) => {
    const slotName = el.getAttribute('data-slot');
    const text = textFromEditable(el, Boolean(slotName && metaForSlotName(slotName).marked));
    if (!text) return;
    if (slotName) {
      const at = seen[slotName] || 0;
      seen[slotName] = at + 1;
      const meta = metaForSlotName(slotName);
      const stampedLine = /^line-\d+$/.test(slotName);
      const baseLabel = stampedLine ? guessLineLabel(el) : meta.label;
      const labelKey = stampedLine ? `ll:${baseLabel}` : slotName;
      const labelAt = stampedLine ? (seen[labelKey] || 0) : at;
      if (stampedLine) seen[labelKey] = labelAt + 1;
      const labelTotal = stampedLine
        ? els.filter((node) => {
          const s = node.getAttribute('data-slot');
          return s && /^line-\d+$/.test(s) && guessLineLabel(node) === baseLabel;
        }).length
        : counts[slotName];
      roles.push({
        key: stampedLine ? slotName : roleKeyForSlot(slotName, at, counts),
        label: labelTotal > 1 ? `${baseLabel} ${labelAt + 1}` : baseLabel,
        slot: meta.typeSlot,
        hint: 'On this slide.',
        htmlSlot: slotName,
        occurrence: stampedLine ? Number(slotName.slice(5)) || 0 : at,
        marked: Boolean(meta.marked),
        text,
        ...(stampedLine ? { lineAt: Number(slotName.slice(5)) || 0 } : {}),
      });
      return;
    }
    const lineAt = seen.line || 0;
    seen.line = lineAt + 1;
    const base = guessLineLabel(el);
    const labelAt = seen[`ll:${base}`] || 0;
    seen[`ll:${base}`] = labelAt + 1;
    roles.push({
      key: `line-${lineAt}`,
      label: lineLabelTotals[base] > 1 ? `${base} ${labelAt + 1}` : base,
      slot: 'detail',
      hint: 'On this slide.',
      htmlSlot: '',
      occurrence: lineAt,
      marked: false,
      text,
      lineAt,
    });
  });
  return roles;
}

export function agentHtmlSource(slide, visual) {
  const doc = String(visual?.documentHtml || '').trim();
  if (doc) return doc;
  return String(slide?.layoutHtml || '').trim();
}

export function isAgentHtmlSlide(slide) {
  if (!slide || slide.blank || slide.layout === 'blank') return false;
  if (slide.manual || String(slide.layout || '').startsWith('el-')) return false;
  return Boolean(String(slide.layoutHtml || '').trim()) || slide.layout === 'dynamic';
}
