import { fillAssetSrcs, mediaProxyUrl } from '../../api/media';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAiDebug, fmtElapsed, fmtCost, fmtTokens } from '../../lib/aiDebug';
import { prepareLayoutHtml, repairStrandedOffsets, shareLayoutStyles } from './layoutHtml';
import { downloadCarouselPreviewPdf } from './carouselPdf';
import DynamicLayout from './DynamicLayout';
import { carouselDocPreview, carouselSlideImageUrls, carouselSlideIndexOf } from './carouselDocPreview';

function pretty(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        return JSON.stringify(JSON.parse(t), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Pull the raw slide HTML out of a Layout-agent response so we can preview it.
// Accepts the parsed object ({ slides: [{ html }] } or { html }) or a raw
// string of layout HTML.
function layoutSlidesHtml(value) {
  if (!value) return [];
  let obj = value;
  if (typeof value === 'string') {
    try {
      obj = JSON.parse(value);
    } catch {
      obj = null;
    }
  }
  const out = [];
  const push = (h) => {
    const s = String(h || '').trim();
    if (s && /<article|<section|class=["'][^"']*\bslide\b|<style/i.test(s)) out.push(s);
  };
  if (obj && Array.isArray(obj.slides)) {
    obj.slides.forEach((s) => {
      if (Array.isArray(s?.options) && s.options.length) s.options.forEach((o) => push(o?.html));
      else push(s?.html);
    });
  } else if (obj && typeof obj.html === 'string') push(obj.html);
  else if (typeof value === 'string') push(value);
  return out;
}

function carouselDocumentHtml(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (/<html[\s>]/i.test(t) || /<!doctype html/i.test(t)) {
      if (/content structure (was )?not included|awaiting content|role not supplied/i.test(t)) return '';
      return t;
    }
    const parsed = parseJson(t);
    const html = parsed?.html || parsed?.parsed?.html;
    if (typeof html === 'string' && /<html[\s>]/i.test(html)) {
      if (/content structure (was )?not included|awaiting content|role not supplied/i.test(html)) return '';
      return html;
    }
    return '';
  }
  const html = value.html || value.parsed?.html;
  if (typeof html === 'string' && /<html[\s>]/i.test(html)) {
    if (/content structure (was )?not included|awaiting content|role not supplied/i.test(html)) return '';
    return html;
  }
  return '';
}

// Same empty-slot treatment as Week View: keep agent CSS/structure, mark empty
// image slots as placeholders without injecting a bitmap src (intrinsic size
// was collapsing / blowing out the agent's flex and cqi sizing).
function previewSlidesHtml(value) {
  const raw = layoutSlidesHtml(value);
  return shareLayoutStyles(raw).map((html) => prepareLayoutHtml(html, { imageUrls: [] }) || html);
}

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Debug › Strategy agent › Preview: a plain wireframe of the brief — one slide
// per narrative unit, the CTA included, with its copy and the photo the post
// shows for that unit (hatched when the brief wants a photo the post has none
// for). A unit the brief places in the caption is drawn and marked as such.
const STRATEGY_SLIDE_CSS = 'font-family:system-ui,-apple-system,sans-serif;background:#f4efe6;color:#1b100d;'
  + 'display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box';
function strategySlidesHtml(brief, postSlides = []) {
  const units = Array.isArray(brief?.narrativeUnits) ? brief.narrativeUnits : [];
  const onSlides = units.filter((u) => u?.copy || u?.purpose || u?.support);
  const allocated = Array.isArray(brief?.allocatedAssets) ? brief.allocatedAssets : [];
  const slides = Array.isArray(postSlides) ? postSlides : [];
  const keyFor = (u, i) => {
    const id = String(u?.id || '');
    const hit = allocated.find((a) => Array.isArray(a?.supportsUnitIds) && a.supportsUnitIds.map(String).includes(id));
    if (hit?.key) return hit.key;
    const sl = slides.find((x) => Array.isArray(x?.coversUnits) && x.coversUnits.map(String).includes(id)) || slides[i];
    const key = sl?.assetKey || (Array.isArray(sl?.assetKeys) ? sl.assetKeys[0] : '');
    return key && !/\/themed-/.test(key) ? key : '';
  };
  return onSlides.map((u, i) => {
    const wantsPhoto = String(u?.visual || '').toLowerCase() === 'photo';
    const key = wantsPhoto ? keyFor(u, i) : '';
    const copy = u?.copy || u?.purpose || '';
    const note = u?.copy ? u?.purpose : u?.support;
    const photo = wantsPhoto
      ? (key
        ? `<img src="${escHtml(mediaProxyUrl(key))}" alt="" style="width:100%;height:52%;object-fit:cover;flex:none;display:block">`
        : '<div style="height:52%;flex:none;display:flex;align-items:center;justify-content:center;font-size:3.4vw;letter-spacing:.12em;color:#6b5f55;background:repeating-linear-gradient(135deg,transparent 0 10px,rgba(27,16,13,.1) 10px 20px),#ddd8ce">PHOTO</div>')
      : '';
    return `<article class="slide" style="${STRATEGY_SLIDE_CSS}">${photo}`
      + '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:2.4vw;padding:7vw">'
      + `<div style="font-size:3vw;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a0522d">${escHtml(`${i + 1} · ${u?.role || 'slide'}${String(u?.placement || '').toLowerCase() === 'caption' ? ' · in caption' : ''}`)}</div>`
      + `<div style="font-size:${wantsPhoto ? 6.4 : 8.4}vw;font-weight:700;line-height:1.08">${escHtml(copy)}</div>`
      + (note ? `<div style="font-size:3.6vw;line-height:1.35;color:#5a4d44">${escHtml(note)}</div>` : '')
      + '</div></article>';
  });
}

// Shell around the agent's markup. Only establishes a real 4:5 viewport so
// height:100% / container-type:size / cqi/cqh work. Hatch is CSS-only.
// Nested slides keep the agent's own width — a 1080px canvas is scaled by the
// preview, not stretched to the cell.
const PREVIEW_SHELL_CSS = [
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}',
  'body>.slide,body>article{width:100%;height:100%;box-sizing:border-box}',
  'img,svg{max-width:none}',
  'img[data-slot="image"]{display:block;object-fit:cover;',
  'background:repeating-linear-gradient(135deg,transparent 0 7px,rgba(27,16,13,.12) 7px 14px),#ddd8ce;',
  'color:transparent;font-size:0;-moz-force-broken-image-icon:0}',
].join('');

// Write the agent's HTML into an iframe document (not srcDoc) so markup is not
// attribute-escaped, and size the frame to the canvas so % / container queries
// resolve. allow-same-origin is required for document.write; scripts stay blocked.
function SlideFrame({ html, label }) {
  const ref = useRef(null);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    const doc = frame.contentDocument;
    if (!doc) return undefined;
    const page = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + `<style>${PREVIEW_SHELL_CSS}</style></head><body>${html}</body></html>`;
    doc.open();
    doc.write(page);
    doc.close();
    repairStrandedOffsets(doc);
    // Force a layout pass so container-query units measure against the frame.
    void doc.documentElement.offsetWidth;
    return undefined;
  }, [html]);

  return (
    <figure className="wv-layprev__frame">
      <div className="wv-layprev__canvas">
        <iframe
          ref={ref}
          title={label}
          sandbox="allow-same-origin"
        />
      </div>
      <figcaption className="wv-layprev__cap">{label}</figcaption>
    </figure>
  );
}

// The agent's html as one string (a document, a JSON row, or a layout object).
function agentHtmlOf(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const parsed = /^\s*[{[]/.test(value) ? parseJson(value) : null;
    return parsed ? String(parsed.html || parsed.parsed?.html || '') : value;
  }
  return String(value.html || value.parsed?.html || '');
}

// One slide drawn from the whole carousel document the way the editor draws it
// (DynamicLayout: 1100px design width, 4:5 crop, photos by asset key).
function DocSlideFrame({ document: doc, direction, article, label }) {
  return (
    <figure className="wv-layprev__frame">
      <div className="wv-layprev__canvas">
        <DynamicLayout
          html=""
          documentHtml={doc}
          slideIndex={carouselSlideIndexOf(article, 1)}
          direction={direction}
          imageUrls={carouselSlideImageUrls(article)}
          copy={{}}
        />
      </div>
      <figcaption className="wv-layprev__cap">{label}</figcaption>
    </figure>
  );
}

function DocumentFrame({ html }) {
  const ref = useRef(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    const doc = frame.contentDocument;
    if (!doc) return undefined;
    doc.open();
    doc.write(html);
    doc.close();
    repairStrandedOffsets(doc);
    return undefined;
  }, [html]);
  return (
    <iframe
      ref={ref}
      title="Carousel preview"
      className="wv-layprev__doc"
      sandbox="allow-same-origin allow-scripts"
    />
  );
}

function LayoutPreview({ slides, documentHtml = '', docPreview = null, onClose }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onDownloadPdf = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pdfBusy) return;
    setPdfError('');
    setPdfBusy(true);
    try {
      await downloadCarouselPreviewPdf({
        documentHtml: docPreview ? fillAssetSrcs(docPreview.document) : documentHtml,
        slides,
        filename: 'carousel-preview.pdf',
      });
    } catch (err) {
      setPdfError(err?.message || 'Could not build the PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  return createPortal(
    <div className="wv-layprev" role="dialog" aria-modal="true" aria-label="Layout preview" onClick={onClose}>
      <div className="wv-layprev__panel" onClick={(e) => e.stopPropagation()}>
        <div className="wv-layprev__head">
          <strong>Carousel preview</strong>
          <span className="wv-layprev__count">
            {docPreview
              ? `${docPreview.slides.length} slide${docPreview.slides.length === 1 ? '' : 's'}`
              : (documentHtml ? 'Full document' : `${slides.length} slide${slides.length === 1 ? '' : 's'}`)}
          </span>
          <div className="wv-layprev__actions">
            {pdfError ? <span className="wv-layprev__err" title={pdfError}>{pdfError}</span> : null}
            <button
              type="button"
              className="wv-agentdbg__copy wv-layprev__pdf"
              onClick={onDownloadPdf}
              disabled={pdfBusy}
            >
              {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
            </button>
            <button type="button" className="wv-agentdbg__copy" onClick={onClose}>Close</button>
          </div>
        </div>
        {docPreview ? (
          <div className="wv-layprev__grid">
            {docPreview.slides.map((sl, i) => (
              <DocSlideFrame
                key={`${sl.index}-${i}`}
                document={docPreview.document}
                direction={docPreview.direction}
                article={sl.after}
                label={`Slide ${sl.index}`}
              />
            ))}
          </div>
        ) : documentHtml ? (
          <div className="wv-layprev__docwrap">
            <DocumentFrame html={documentHtml} />
          </div>
        ) : (
          <div className="wv-layprev__grid">
            {slides.map((h, i) => <SlideFrame key={i} html={h} label={`Slide ${i + 1}`} />)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// value: the agent's output — drawn like the app when it is a whole carousel
// document; older rows fall back to the per-slide frames.
function PreviewButton({ value, slides, documentHtml = '', label = 'Preview' }) {
  const [open, setOpen] = useState(false);
  const docPreview = open ? carouselDocPreview(agentHtmlOf(value)) : null;
  if (!documentHtml && !slides.length) return null;
  const onOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        className="wv-agentdbg__preview"
        onClick={onOpen}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {label}
      </button>
      {open ? <LayoutPreview slides={slides} documentHtml={documentHtml} docPreview={docPreview} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function lastMatching(entries, prefix) {
  const hits = (entries || []).filter((e) => String(e.source || '').startsWith(prefix));
  return hits[0] || null;
}

function costOf(entry) {
  const cost = fmtCost(entry?.estimatedCostUsd);
  const tokens = fmtTokens(entry?.totalTokens);
  const time = fmtElapsed(entry?.elapsedMs);
  return [time, cost ? `~${cost}` : '', tokens ? `${tokens} tok` : ''].filter(Boolean).join(' · ');
}

// Sum time/cost/tokens across several debug entries (e.g. per-slide Visual runs).
function sumEntries(entries) {
  return (entries || []).reduce((acc, e) => ({
    elapsedMs: acc.elapsedMs + (Number(e?.elapsedMs) || 0),
    estimatedCostUsd: acc.estimatedCostUsd + (Number(e?.estimatedCostUsd) || 0),
    totalTokens: acc.totalTokens + (Number(e?.totalTokens) || 0),
  }), { elapsedMs: 0, estimatedCostUsd: 0, totalTokens: 0 });
}

// Visual run summary — like costOf, but includes the image count (image-render
// cost is estimated and not counted in tokens).
function visualCostOf(usage) {
  const time = fmtElapsed(usage?.elapsedMs);
  const cost = fmtCost(usage?.estimatedCostUsd);
  const imgs = Number(usage?.images) || 0;
  const tokens = fmtTokens(usage?.totalTokens);
  return [time, cost ? `~${cost}` : '', imgs ? `${imgs} img` : '', tokens ? `${tokens} tok` : '']
    .filter(Boolean).join(' · ');
}

function briefFromStrategistLog(entries, date) {
  const entry = (entries || []).find((e) => /^Strategist/i.test(String(e.source || '')));
  const parsed = parseJson(entry?.output);
  if (!parsed) return null;
  const briefs = Array.isArray(parsed.briefs)
    ? parsed.briefs
    : (Array.isArray(parsed.plannedDays) ? parsed.plannedDays : []);
  if (!date) return briefs[0] || parsed;
  return briefs.find((b) => String(b?.date || '') === String(date)) || null;
}

function traceForDay(day, entries) {
  const stored = day?.agentTrace && typeof day.agentTrace === 'object' ? day.agentTrace : {};
  const date = String(day?.date || '').trim();
  const strategyEntry = (entries || []).find((e) => /^Strategist/i.test(String(e.source || '')));
  const structureEntry = lastMatching(entries, date ? `Structure:${date}` : 'Structure:');
  const dayHit = lastMatching(entries, date ? `Day:${date}` : 'Day:');
  const layoutEntry = lastMatching(entries, date ? `Carousel:${date}` : 'Carousel:')
    || lastMatching(entries, date ? `Layout:${date}` : 'Layout:')
    || lastMatching(entries, 'Carousel agent');
  const strategyBrief = stored.strategyBrief
    || briefFromStrategistLog(entries, date);
  const structure = stored.structure
    || parseJson(structureEntry?.output);
  const dayWriter = stored.dayWriter
    || parseJson(dayHit?.output);
  const layout = stored.layout
    || stored.carousel
    || parseJson(layoutEntry?.output);
  const visualEntries = (entries || []).filter((e) => /^Visual:/i.test(String(e.source || '')));
  const visual = (stored.visual && (stored.visual.slides || stored.visual.agents) ? stored.visual : null)
    || (visualEntries.length
      ? { agents: visualEntries.map((e) => ({ source: e.source, prompt: e.prompt, output: e.output })) }
      : null);
  const visualUsage = stored.visual?.usage || null;
  const visualCost = visualUsage
    ? visualCostOf(visualUsage)
    : (visualEntries.length ? costOf(sumEntries(visualEntries)) : '');

  const strategyPrompt = stored.strategyPrompt
    || strategyEntry?.prompt
    || '';
  const structurePrompt = stored.structurePrompt
    || structureEntry?.prompt
    || '';
  const dayWriterPrompt = stored.dayWriterPrompt
    || dayHit?.prompt
    || '';
  const layoutPrompt = stored.layoutPrompt
    || layoutEntry?.prompt
    || '';
  const visualPrompt = Array.isArray(stored.visual?.agents) && stored.visual.agents.length
    ? stored.visual.agents.map((a) => [
      a.source ? `# ${a.source}` : '',
      a.prompt || '',
    ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n---\n\n')
    : visualEntries.map((e) => [
      e.source ? `# ${e.source}` : '',
      e.prompt || '',
    ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n---\n\n');

  // Editor › Themes › Upload a reference — the latest run's four steps
  const runs = Array.isArray(stored.themeApply) ? stored.themeApply : [];
  const themeApply = runs.length ? runs[runs.length - 1] : null;

  return {
    themeApply,
    strategyBrief,
    strategyPrompt,
    structure,
    structurePrompt,
    dayWriter,
    dayWriterPrompt,
    layout,
    layoutPrompt,
    visual,
    visualPrompt,
    costs: {
      strategy: costOf(strategyEntry),
      structure: costOf(structureEntry),
      dayWriter: costOf(dayHit),
      layout: costOf(layoutEntry),
      visual: visualCost,
    },
  };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button
      type="button"
      className={`wv-agentdbg__copy${copied ? ' is-copied' : ''}`}
      onClick={onCopy}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// Only agents that actually ran on this post are drawn — a block with nothing
// recorded is left out rather than shown as "Not recorded".
// The slide html an agent was given (Theme Apply's input slide), drawn at its
// 1080×1350 canvas and scaled down. Scripts stay blocked.
const INPUT_FRAME_CSS = 'html,body{margin:0;padding:0;background:#fff;overflow:hidden}'
  + 'section[data-direction]{padding:0!important;gap:0!important;display:block!important}';
function InputSlideFrame({ html, label }) {
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${INPUT_FRAME_CSS}</style></head><body>${fillAssetSrcs(html)}</body></html>`;
  return (
    <figure className="wv-agentdbg__inslide">
      <div className="ai-debug__slidefr"><iframe title={label} sandbox="" srcDoc={page} /></div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

// Where an agent's prompt turns from instructions into the data filled in for
// this post: the first data heading of its template (plan-strategist.md ›
// "## Brand", carousel-layouts/*.md › "STRATEGY AGENT OUTPUT:").
const PROMPT_DATA_MARKERS = [/\n## Brand\n/, /\nSTRATEGY AGENT OUTPUT:\s*\n/];
function splitPromptParts(text) {
  const src = String(text || '');
  for (const re of PROMPT_DATA_MARKERS) {
    const m = re.exec(src);
    if (m) return { system: src.slice(0, m.index).trimEnd(), data: src.slice(m.index + 1) };
  }
  return null;
}
const joinPromptParts = (system, data) => `${system.trimEnd()}\n\n${data.trimStart()}`;

// Input › Edit: a full-screen editor for the prompt, rerun through `onRerun`
// (Debug › Strategy / Carousel agent — runs the agent on this post with the
// edited text). Two tabs when the prompt splits: System prompt (the agent's
// instructions) and Input data (what was filled in for this post); the rerun
// sends both, joined back into one prompt.
// Esc / Cancel closes (asks first when there are edits); ⌘/Ctrl+Enter reruns.
function PromptEditor({ title, text, onRerun, busy, onClose }) {
  const parts = splitPromptParts(text);
  const [tab, setTab] = useState('system');
  const [draft, setDraft] = useState(parts ? { system: parts.system, data: parts.data } : { system: String(text || ''), data: '' });
  const ref = useRef(null);
  const combined = parts ? joinPromptParts(draft.system, draft.data) : draft.system;
  const changed = combined.trim() !== String(text || '').trim();
  const canRun = !busy && Boolean(combined.trim());
  const key = parts ? tab : 'system';
  const value = draft[key];

  const close = () => {
    if (changed && !window.confirm('Discard your edits to this prompt?')) return;
    onClose();
  };
  const run = () => {
    if (!canRun) return;
    onRerun(combined);
    onClose();
  };
  const reset = () => setDraft(parts ? { system: parts.system, data: parts.data } : { system: String(text || ''), data: '' });

  useEffect(() => {
    const ta = ref.current;
    if (ta) { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
  }, [key]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
  };

  const tabChanged = (k) => parts && draft[k].trim() !== parts[k].trim();
  const lines = value.split('\n').length;
  return createPortal(
    <div className="wv-promptedit" role="dialog" aria-modal="true" aria-label={`Edit ${title} prompt`} onKeyDown={onKeyDown}>
      <div className="wv-promptedit__head">
        <strong>{title} · prompt</strong>
        {parts ? (
          <div className="wv-promptedit__tabs" role="tablist">
            {[['system', 'System prompt'], ['data', 'Input data']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`wv-promptedit__tab${tab === k ? ' is-on' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}{tabChanged(k) ? ' •' : ''}
              </button>
            ))}
          </div>
        ) : null}
        <span className="wv-promptedit__meta">
          {changed ? 'Edited · ' : ''}{lines.toLocaleString()} lines · {value.length.toLocaleString()} chars
        </span>
        <div className="wv-promptedit__acts">
          <button type="button" className="wv-agentdbg__copy" disabled={!changed} onClick={reset}>Reset</button>
          <CopyButton text={value} />
          <button type="button" className="wv-agentdbg__copy" onClick={close}>Cancel</button>
          <button
            type="button"
            className="wv-promptedit__run"
            disabled={!canRun}
            onClick={run}
            title={/^Strategy/i.test(title)
              ? "Run the Strategy agent with this prompt (the slides stay until you run the carousel agent) · ⌘/Ctrl+Enter"
              : "Run the carousel agent on this post with this prompt (replaces the post's slides) · ⌘/Ctrl+Enter"}
          >
            {busy ? 'Running…' : 'Rerun with this prompt'}
          </button>
        </div>
      </div>
      <textarea
        ref={ref}
        className="wv-promptedit__text"
        value={value}
        onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, [key]: v })); }}
        spellCheck={false}
      />
    </div>,
    document.body,
  );
}

function EditableInput({ title, text, onRerun, busy }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="wv-agentdbg__section">
      <div className="wv-agentdbg__sechead">
        <span>Input</span>
        <span className="wv-agentdbg__acts">
          <button
            type="button"
            className="wv-agentdbg__copy"
            disabled={busy}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
          >
            {busy ? 'Running…' : 'Edit'}
          </button>
          <CopyButton text={text} />
        </span>
      </div>
      <pre className="wv-agentdbg__pre">{text}</pre>
      {editing ? (
        <PromptEditor title={title} text={text} onRerun={onRerun} busy={busy} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  );
}

function Block({ title, input, output, open = false, cost = '', images = [], inputSlides = [], inputHtml = '', previewSlides = null, onRerunInput = null, rerunBusy = false }) {
  const inputBody = pretty(input);
  const outputBody = pretty(output);
  if (!inputBody && !outputBody && !images.length) return null;
  const slides = previewSlides || previewSlidesHtml(output);
  const documentHtml = carouselDocumentHtml(output);
  const copyAll = [inputBody && `## Input\n\n${inputBody}`, outputBody && `## Output\n\n${outputBody}`]
    .filter(Boolean)
    .join('\n\n');
  return (
    <details className="wv-agentdbg__block" open={open}>
      <summary className="wv-agentdbg__sum">
        <span>{title}</span>
        <span className="wv-agentdbg__acts">
          {cost ? <span className="wv-agentdbg__cost">{cost}</span> : null}
          {inputHtml ? (
            <PreviewButton
              value={inputHtml}
              slides={previewSlidesHtml(inputHtml)}
              documentHtml={carouselDocumentHtml(inputHtml)}
              label="Preview input"
            />
          ) : null}
          <PreviewButton value={output} slides={slides} documentHtml={documentHtml} label={inputHtml ? 'Preview output' : 'Preview'} />
          <CopyButton text={copyAll} />
        </span>
      </summary>
      {inputSlides.length ? (
        <div className="wv-agentdbg__section">
          <div className="wv-agentdbg__sechead">
            <span>Input slide{inputSlides.length > 1 ? 's' : ''} (HTML)</span>
          </div>
          <div className="wv-agentdbg__imgs">
            {inputSlides.map((x) => <InputSlideFrame key={x.label} html={x.html} label={x.label} />)}
          </div>
        </div>
      ) : null}
      {inputBody && onRerunInput ? (
        <EditableInput title={title} text={inputBody} onRerun={onRerunInput} busy={rerunBusy} />
      ) : inputBody ? (
        <div className="wv-agentdbg__section">
          <div className="wv-agentdbg__sechead">
            <span>Input</span>
            <CopyButton text={inputBody} />
          </div>
          <pre className="wv-agentdbg__pre">{inputBody}</pre>
        </div>
      ) : (
        <p className="wv-agentdbg__empty">Input not recorded for this agent.</p>
      )}
      {outputBody ? (
        <div className="wv-agentdbg__section">
          <div className="wv-agentdbg__sechead">
            <span>Output</span>
            <CopyButton text={outputBody} />
          </div>
          <pre className="wv-agentdbg__pre">{outputBody}</pre>
        </div>
      ) : (
        <p className="wv-agentdbg__empty">Output not recorded for this agent.</p>
      )}
      {images.length ? (
        <div className="wv-agentdbg__imgs">
          {images.map((im) => (
            <a key={im.key} href={im.src || mediaProxyUrl(im.key)} target="_blank" rel="noreferrer" title={im.label}>
              <img src={im.src || mediaProxyUrl(im.key)} alt={im.label} loading="lazy" />
              <span>{im.label}</span>
            </a>
          ))}
        </div>
      ) : null}
    </details>
  );
}

export default function PostAgentDebug({
  day,
  onRunLayout,
  onRunStrategy,
  layoutBusy = false,
  layoutErr = '',
  elapsedMs = 0,
  estimatedCostUsd = 0,
  totalTokens = 0,
}) {
  const debug = useAiDebug();
  const trace = traceForDay(day, debug.entries);
  // agentTrace.lastRun: the latest run on this post (set by every run on the server)
  const stored = day?.agentTrace && typeof day.agentTrace === 'object' ? day.agentTrace : {};
  const run = stored.lastRun && Array.isArray(stored.lastRun.agents) ? stored.lastRun : null;
  // The tab lists only the Strategy and Carousel agents. Each stays listed
  // after a run that skipped it (the carousel agent's input is built from the
  // Strategy brief), marked as coming from an earlier run.
  const strategyCarried = !!run && !run.agents.includes('strategy');
  const carouselCarried = !!run && !run.agents.includes('carousel');
  const RUN_LABEL = {
    generate: 'Post generation',
    layout: 'Carousel agent (Fix layout)',
    strategy: 'Strategy agent (edited prompt)',
    theme: 'Theme Apply',
    'remove-theme': 'Remove theme — back to the carousel agent’s design (no agent ran)',
    refine: 'Prompt edit (Slide Edit agent)',
    'add-slide': 'Add slide (Add Slide agent)',
  };
  const runAt = run?.at ? new Date(run.at) : null;
  const runWhen = runAt && !Number.isNaN(runAt.getTime())
    ? runAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const empty = !trace.strategyBrief && !trace.strategyPrompt
    && !trace.layout && !trace.layoutPrompt;
  const took = fmtElapsed(elapsedMs);
  const cost = fmtCost(estimatedCostUsd);
  const tokens = fmtTokens(totalTokens);
  const genMeta = [took, cost ? `~${cost} est.` : '', tokens ? `${tokens} tokens` : ''].filter(Boolean).join(' · ');
  const staleShell = /content structure (was )?not included|awaiting content|role not supplied/i
    .test(String(trace.layout?.html || day?.content?.carouselHtml || ''));

  return (
    <div className="wv-agentdbg">
      {run ? (
        <p className="wv-agentdbg__time">
          Latest run: <strong>{RUN_LABEL[run.kind] || run.kind}</strong>{runWhen ? ` · ${runWhen}` : ''}
        </p>
      ) : null}
      {genMeta && (!run || run.kind === 'generate') ? (
        <p className="wv-agentdbg__time">
          Complete generation <strong>{genMeta}</strong>
        </p>
      ) : null}
      <p className="wv-agentdbg__lead">
        Input and output of the Strategy agent and the Carousel agent on this post.
      </p>
      {staleShell ? (
        <p className="wv-agentdbg__empty">
          Stored carousel HTML is an empty shell from a bad run (structure never reached the model). Click <strong>Run carousel agent</strong> to rebuild — do not trust the old Preview.
        </p>
      ) : null}
      {onRunLayout && (
        <div className="wv-agentdbg__run">
          <button
            type="button"
            className="btn btn--tertiary btn--sm"
            disabled={layoutBusy}
            onClick={onRunLayout}
          >
            {layoutBusy ? 'Composing…' : 'Run carousel agent'}
          </button>
          <span className="wv-agentdbg__runhint">This post only — does not regenerate the week. Takes 1–3 minutes.</span>
        </div>
      )}
      {layoutErr ? <p className="wv-agentdbg__empty">{layoutErr}</p> : null}
      {stored.strategyRerun ? (
        <p className="wv-agentdbg__empty">
          New strategy saved. The slides still show the old one — click <strong>Run carousel agent</strong> to build them from it.
        </p>
      ) : null}
      {empty && (
        <p className="wv-agentdbg__empty">
          No agent trace on this post yet. Generate or replan with debug mode on. Older posts may only show output until you regenerate.
        </p>
      )}
      <Block
        title={strategyCarried ? 'Strategy agent (from post generation)' : 'Strategy agent'}
        input={trace.strategyPrompt}
        output={trace.strategyBrief}
        open={!strategyCarried}
        cost={trace.costs?.strategy}
        previewSlides={strategySlidesHtml(trace.strategyBrief, day?.content?.slides)}
        onRerunInput={onRunStrategy ? (prompt) => onRunStrategy(prompt) : null}
        rerunBusy={layoutBusy}
      />
      <Block
        title={carouselCarried ? 'Carousel agent (from an earlier run)' : 'Carousel agent'}
        input={trace.layoutPrompt}
        output={trace.layout}
        cost={trace.costs?.layout}
        onRerunInput={onRunLayout ? (prompt) => onRunLayout(prompt) : null}
        rerunBusy={layoutBusy}
      />
    </div>
  );
}
