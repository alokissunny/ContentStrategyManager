// Debug panel › Preview for a prompt edit: each edited slide BEFORE and AFTER,
// drawn exactly the way the editor draws it — the article is set into a
// carousel document with the carousel's own CSS and direction, and rendered by
// DynamicLayout (the same 1100px design width, the same 4:5 crop). Pictures on
// the slide resolve by their asset keys through the media proxy.
//
// Lazy-loaded by components/AiDebugPanel so the editor's stylesheet and
// renderer only load when a preview is actually opened.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import DynamicLayout from './DynamicLayout';
import { mediaProxyUrl, isProjectMediaKey } from '../../api/media';
import '../weekView.css';

function documentFor(css, direction, article) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${css || ''}</head>`
    + `<body><section data-direction="${direction || 'architectural-minimal'}">${article || ''}</section></body></html>`;
}

// The editor already has the carousel loaded — its iframe holds the theme's
// <style> blocks and font <link>s exactly as they draw the slide. A row that did
// not record the CSS (older rows), or recorded styles without the font links,
// borrows them from there. Read once, before this preview's own frames mount.
function liveTheme(direction) {
  const frames = [...document.querySelectorAll('.wv-dynlay iframe')].filter((f) => !f.closest('.edp'));
  let fallback = null;
  for (const f of frames) {
    let d = null;
    try { d = f.contentDocument; } catch { d = null; }
    if (!d) continue;
    const section = d.querySelector('section[data-direction]');
    const dir = section?.getAttribute('data-direction') || '';
    const nodes = [...d.querySelectorAll('style, link[rel="stylesheet"]')]
      .filter((n) => !n.hasAttribute('data-wv-edit-ui'));
    if (!nodes.length) continue;
    const found = {
      css: nodes.filter((n) => n.tagName === 'STYLE').map((n) => n.outerHTML).join('\n'),
      links: nodes.filter((n) => n.tagName === 'LINK').map((n) => n.outerHTML).join('\n'),
      direction: dir,
    };
    if (!direction || dir === direction) return found;
    if (!fallback) fallback = found;
  }
  return fallback;
}

function imageUrlsOf(article) {
  const urls = [];
  String(article || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    if (!/\bdata-slot\s*=\s*["'](?:image|illustration)["']/i.test(attrs)) return '';
    const key = (attrs.match(/\bdata-asset-key\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    urls.push(key && isProjectMediaKey(key) ? mediaProxyUrl(key) : src || null);
    return '';
  });
  return urls;
}

function indexOf(article, fallback) {
  const m = String(article || '').match(/^<article\b[^>]*\sdata-index\s*=\s*["'](\d+)["']/i);
  return m ? Number(m[1]) : fallback;
}

function SlideView({ css, direction, article, label }) {
  if (!article) {
    return (
      <figure className="edp__fig">
        <div className="edp__canvas edp__canvas--empty">No slide</div>
        <figcaption className="edp__cap">{label}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="edp__fig">
      <div className="edp__canvas wv-ig__photo">
        <DynamicLayout
          html=""
          documentHtml={documentFor(css, direction, article)}
          slideIndex={indexOf(article, 1)}
          direction={direction}
          imageUrls={imageUrlsOf(article)}
          copy={{}}
        />
      </div>
      <figcaption className="edp__cap">{label}</figcaption>
    </figure>
  );
}

export default function EditPreview({ preview, title, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const slides = Array.isArray(preview?.slides) ? preview.slides : [];
  // the theme to draw with: what the row recorded, completed from the editor
  const [theme] = useState(() => {
    const live = liveTheme(preview?.direction);
    const recorded = String(preview?.css || '');
    return {
      css: `${recorded ? '' : (live?.css || '')}${recorded}\n${live?.links || ''}`,
      direction: preview?.direction || live?.direction || '',
      source: recorded ? 'recorded' : (live ? 'editor' : 'none'),
    };
  });
  return createPortal(
    <div className="edp" role="dialog" aria-modal="true" aria-label="Slide preview" onClick={onClose}>
      <div className="edp__panel" onClick={(e) => e.stopPropagation()}>
        <header className="edp__head">
          <strong>{title || 'Slide preview'}</strong>
          <span className="edp__sub">
            {theme.source === 'none'
              ? 'Before and after · open the post in the editor to see it in its theme (this row did not record its styles)'
              : theme.source === 'editor'
                ? 'Before and after · in the theme of the slide open in the editor'
                : 'Before and after · rendered like the editor'}
          </span>
          <button type="button" className="edp__close" onClick={onClose}>Close</button>
        </header>
        <div className="edp__body">
          {slides.map((sl, i) => (
            <section key={`${sl.index}-${i}`} className="edp__row">
              <h3 className="edp__slide">Slide {sl.index}</h3>
              <div className="edp__pair">
                <SlideView css={theme.css} direction={theme.direction} article={sl.before} label="Before" />
                <SlideView css={theme.css} direction={theme.direction} article={sl.after} label="After" />
              </div>
            </section>
          ))}
          {!slides.length && <p className="edp__none">Nothing to preview for this step.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
