import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAiDebug, fmtElapsed } from '../../lib/aiDebug';
import { prepareLayoutHtml, shareLayoutStyles } from './layoutHtml';

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
  if (obj && Array.isArray(obj.slides)) obj.slides.forEach((s) => push(s?.html));
  else if (obj && typeof obj.html === 'string') push(obj.html);
  else if (typeof value === 'string') push(value);
  return out;
}

// Same empty-slot treatment as Week View: keep agent CSS/structure, mark empty
// image slots as placeholders without injecting a bitmap src (intrinsic size
// was collapsing / blowing out the agent's flex and cqi sizing).
function previewSlidesHtml(value) {
  const raw = layoutSlidesHtml(value);
  return shareLayoutStyles(raw).map((html) => prepareLayoutHtml(html, { imageUrls: [] }) || html);
}

// Shell around the agent's markup. Only establishes a real 4:5 viewport so
// height:100% / container-type:size / cqi/cqh work. Hatch is CSS-only.
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

function LayoutPreview({ slides, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="wv-layprev" role="dialog" aria-modal="true" aria-label="Layout preview" onClick={onClose}>
      <div className="wv-layprev__panel" onClick={(e) => e.stopPropagation()}>
        <div className="wv-layprev__head">
          <strong>Layout preview</strong>
          <span className="wv-layprev__count">{slides.length} slide{slides.length === 1 ? '' : 's'}</span>
          <button type="button" className="wv-agentdbg__copy" onClick={onClose}>Close</button>
        </div>
        <div className="wv-layprev__grid">
          {slides.map((h, i) => <SlideFrame key={i} html={h} label={`Slide ${i + 1}`} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PreviewButton({ slides }) {
  const [open, setOpen] = useState(false);
  if (!slides.length) return null;
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
        Preview
      </button>
      {open ? <LayoutPreview slides={slides} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function lastMatching(entries, prefix) {
  const hits = (entries || []).filter((e) => String(e.source || '').startsWith(prefix));
  return hits[0] || null;
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
  const strategyBrief = stored.strategyBrief
    || briefFromStrategistLog(entries, date);
  const structure = stored.structure
    || parseJson(lastMatching(entries, date ? `Structure:${date}` : 'Structure:')?.output);
  const dayHit = lastMatching(entries, date ? `Day:${date}` : 'Day:');
  const dayWriter = stored.dayWriter
    || parseJson(dayHit?.output);
  const layout = stored.layout
    || parseJson(lastMatching(entries, date ? `Layout:${date}` : 'Layout:')?.output);
  return { strategyBrief, structure, dayWriter, layout };
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

function Block({ title, value, open = false }) {
  const body = pretty(value);
  if (!body) {
    return (
      <details className="wv-agentdbg__block">
        <summary className="wv-agentdbg__sum">{title}</summary>
        <p className="wv-agentdbg__empty">Not recorded for this post.</p>
      </details>
    );
  }
  const slides = previewSlidesHtml(value);
  return (
    <details className="wv-agentdbg__block" open={open}>
      <summary className="wv-agentdbg__sum">
        <span>{title}</span>
        <span className="wv-agentdbg__acts">
          <PreviewButton slides={slides} />
          <CopyButton text={body} />
        </span>
      </summary>
      <pre className="wv-agentdbg__pre">{body}</pre>
    </details>
  );
}

export default function PostAgentDebug({ day, onRunLayout, layoutBusy = false, layoutErr = '', elapsedMs = 0 }) {
  const debug = useAiDebug();
  const trace = traceForDay(day, debug.entries);
  const empty = !trace.strategyBrief && !trace.structure && !trace.dayWriter && !trace.layout;
  const took = fmtElapsed(elapsedMs);

  return (
    <div className="wv-agentdbg">
      {took ? (
        <p className="wv-agentdbg__time">
          Complete generation <strong>{took}</strong>
        </p>
      ) : null}
      <p className="wv-agentdbg__lead">
        Agent outputs for this post. Strategy decides the brief; Structure locks the slide map; Day Writer writes the copy; Layout composes the slide.
      </p>
      {onRunLayout && (
        <div className="wv-agentdbg__run">
          <button
            type="button"
            className="btn btn--tertiary btn--sm"
            disabled={layoutBusy}
            onClick={onRunLayout}
          >
            {layoutBusy ? 'Laying out…' : 'Run layout agent'}
          </button>
          <span className="wv-agentdbg__runhint">This post only — does not regenerate the week.</span>
        </div>
      )}
      {layoutErr ? <p className="wv-agentdbg__empty">{layoutErr}</p> : null}
      {empty && (
        <p className="wv-agentdbg__empty">
          No agent trace on this post yet. Generate or replan a week with debug mode on. Posts created before this will only show a trace if this session still has the prompt log.
        </p>
      )}
      <Block title="Strategy brief" value={trace.strategyBrief} open />
      <Block title="Structure agent" value={trace.structure} />
      <Block title="Day Writer" value={trace.dayWriter} />
      <Block title="Layout agent" value={trace.layout} />
    </div>
  );
}
