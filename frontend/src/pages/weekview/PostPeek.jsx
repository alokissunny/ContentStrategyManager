/*
 * Month-menu post peek — same slide paint as WeekView (`SlideMedia`), scaled
 * into the day menu. Dots step the carousel; the artwork is inert.
 */
import React, { useEffect, useMemo, useState } from 'react';
import DynamicLayout from './DynamicLayout';
import { SlideCompose } from './slideLayouts';
import { BrandMark } from '../visuallibrary/BrandMark';
import {
  withSharedLayoutStyles,
  layoutDirectionOf,
  slideIsThemed,
  isCarouselDocument,
} from './layoutHtml';
import {
  mediaProxyUrl,
  toDisplayUrl,
  isProjectMediaKey,
  splitMediaKeys,
  iframeSafeUrl,
  canvasSafeUrl,
} from '../../api/media';
import { paintAll, logoPositionOf, markForTone } from '../../lib/identity';
import { styleOf, groundOf } from '../../lib/visualbrand';
import { useStore } from '../../lib/store';
import '../weekView.css';

const PEEK_MS = 2800;
const PEEK_STAGE = 420; /* compose height; CSS scales to --peek-h */
const FEED_AR = 0.645; /* Instagram feed ceiling — tall formats trim */
const FEED_CANVAS = 0.8; /* 4:5 */
const MOTION_AR = 9 / 16;

function canvasAr(format) {
  return /^(Reel|Story)/i.test(String(format || '')) ? MOTION_AR : FEED_CANVAS;
}

function brandStyleVars(store) {
  const paint = paintAll(store?.libraryEdits);
  const ground = groundOf(styleOf(store?.brandStyle));
  const vars = {
    ...paint,
    '--wv-accent': paint['--t-accent-bg'],
    '--wv-primary': paint['--t-ground-fg'],
    '--wv-neutral': paint['--t-ground-bg'],
    '--wv-post-font': paint['--t-headline-face'],
  };
  if (ground.own && ground.url) vars['--wv-ground-img'] = `url(${ground.url})`;
  return vars;
}

function keysFromLayoutHtml(html) {
  const keys = [];
  const seen = new Set();
  String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    if (!/data-slot\s*=\s*(["'](?:image|illustration)["']|(?:image|illustration)(?=[\s>/]|$))/i.test(attrs)) return _;
    const m = String(attrs).match(/\bdata-asset-key\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const key = String(m?.[2] || m?.[3] || m?.[4] || '').trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    return _;
  });
  return keys;
}

function keysOf(slide) {
  const listed = splitMediaKeys(slide?.assetKeys);
  if (listed.length) return listed;
  const single = splitMediaKeys(slide?.assetKey);
  if (single.length) return single;
  const fromVisual = splitMediaKeys(slide?.visual?.assetKey || slide?.image?.key);
  if (fromVisual.length) return fromVisual;
  return keysFromLayoutHtml(slide?.layoutHtml);
}

function mediaUrlOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.url || value.thumb || '').trim();
}

function urlForKey(key, slide) {
  if (!key) return null;
  if (slide?.image?.key === key) {
    const known = mediaUrlOf(slide.image);
    if (known) return toDisplayUrl(known, key) || (isProjectMediaKey(key) ? mediaProxyUrl(key) : null);
  }
  if (!isProjectMediaKey(key)) return null;
  return toDisplayUrl('', key) || mediaProxyUrl(key) || null;
}

function slideCopy(slide) {
  const title = String(slide?.title || slide?.quote || slide?.action || '').trim();
  const sub = String(slide?.subtitle || '').trim();
  const body = String(slide?.body || '').trim();
  const items = Array.isArray(slide?.items) ? slide.items.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const cmpA = String(slide?.comparisonA || '').trim();
  const cmpB = String(slide?.comparisonB || '').trim();
  const showCmp = Boolean(cmpA || cmpB);
  return {
    title,
    sub,
    body: body && body !== sub && body !== title ? body : '',
    items,
    cmpA: showCmp ? cmpA : '',
    cmpB: showCmp ? cmpB : '',
    stat: String(slide?.stat || '').trim(),
    quote: String(slide?.quote || '').trim() && String(slide?.quote || '').trim() !== title
      ? String(slide.quote).trim() : '',
    annotation: null,
  };
}

function carouselDocumentOf(day) {
  const t = day?.agentTrace && typeof day.agentTrace === 'object' ? day.agentTrace : {};
  const html = day?.content?.carouselHtml
    || t.layout?.html
    || t.carousel?.html
    || t.layout?.parsed?.html
    || t.carousel?.parsed?.html
    || '';
  const raw = String(html || '').trim();
  if (!raw) return '';
  if (/content structure (was )?not included|awaiting content|role not supplied/i.test(raw)) {
    return '';
  }
  return (/<!doctype html/i.test(raw) || /<html[\s>]/i.test(raw)) ? raw : '';
}

/** How many frames a carousel HTML document actually contains. */
function docSlideCount(html) {
  if (!html || !isCarouselDocument(html)) return 0;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const n = doc.querySelectorAll('article.slide').length;
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function slidesOf(day) {
  const existing = Array.isArray(day?.content?.slides) ? day.content.slides : [];
  const mapped = existing.map((s, i) => ({
    ...s,
    index: Number(s?.index) > 0 ? Number(s.index) : i + 1,
    title: s?.title || s?.words || '',
    subtitle: s?.subtitle || s?.body || '',
  }));
  const structure = day?.agentTrace?.structure?.slidesOrScenes;
  const structN = Array.isArray(structure) ? structure.length : 0;
  const docN = docSlideCount(carouselDocumentOf(day));
  const n = Math.max(mapped.length, docN, structN);
  if (n <= 0) {
    const title = String(day?.title || day?.contentType || day?.direction || '').trim();
    const fallback = /carousel/i.test(String(day?.format || '')) ? 5 : 1;
    return Array.from({ length: fallback }, (_, i) => ({
      index: i + 1,
      title: i === 0 ? title : '',
      layoutHtml: '',
    }));
  }
  if (mapped.length >= n) return mapped;
  /* Themed carousels often ship one shared document + N <article.slide>s while
     content.slides is short — pad so the peek dots match the real post. */
  const seed = mapped[0] || {
    index: 1,
    title: String(day?.title || '').trim(),
    layoutHtml: '',
  };
  return Array.from({ length: n }, (_, i) => {
    const hit = mapped[i];
    if (hit) return hit;
    return { ...seed, index: i + 1 };
  });
}

function PeekSlide({ slide, paint, themed, documentHtml, carouselLayoutHtmls, slideIndex }) {
  const copy = slideCopy(slide);
  const urls = keysOf(slide).map((k) => urlForKey(k, slide));
  if (!urls[0]) {
    const lead = slide?.image?.url || slide?.image?.thumb || '';
    if (lead) urls[0] = toDisplayUrl(lead, slide?.image?.key) || lead;
  }
  const layoutHtml = withSharedLayoutStyles(
    slide?.layoutHtml,
    Array.isArray(carouselLayoutHtmls) && carouselLayoutHtmls.length
      ? carouselLayoutHtmls
      : [slide?.layoutHtml],
  );
  const store = useStore();
  const mark = markForTone(store.brandLogos, urls[0] ? 'photo' : 'ground');
  const logo = mark?.key
    ? { ...mark, url: canvasSafeUrl(mark.url, mark.key) || mark.url }
    : mark;
  const logoPosition = logoPositionOf(store.libraryEdits);
  /* Prefer the shared carousel document whenever it exists — themed or not —
     so stepping slideIndex actually changes the frame. */
  const useDoc = Boolean(documentHtml) && (
    slideIsThemed(slide) || docSlideCount(documentHtml) > 1
  );

  if (layoutHtml || useDoc) {
    return (
      <div className="wv-ig__lay" style={paint}>
        <DynamicLayout
          html={layoutHtml}
          documentHtml={useDoc ? documentHtml : ''}
          slideIndex={Number(slide?.index) > 0 ? Number(slide.index) : slideIndex}
          direction={layoutDirectionOf(slide)}
          copyDraft={null}
          subjects={[]}
          needsVisual={false}
          themed={themed}
          copy={{
            title: copy.title,
            subtitle: copy.sub,
            body: copy.body,
            items: copy.items,
            comparisonA: copy.cmpA,
            comparisonB: copy.cmpB,
            stat: copy.stat,
            quote: copy.quote,
            action: String(slide?.action || '').trim(),
            annotation: null,
          }}
          imageUrls={urls.map(iframeSafeUrl).filter(Boolean)}
          paint={paint}
        />
        <BrandMark mark={logo} position={logoPosition} />
      </div>
    );
  }

  return (
    <div className="wv-ig__lay" style={paint}>
      <SlideCompose
        kind="best-fit"
        copy={copy}
        urls={urls}
        slide={slide}
        showVisualHint={false}
        need={null}
        subjects={[]}
      />
      <BrandMark mark={logo} position={logoPosition} />
    </div>
  );
}

/** Scaled post thumbnail for the month day menu, or full-width feed frame.
 *  `phone` = taller peek inside the mobile day sheet (bauhly-v3). */
export function DayPeek({ day, feed = false, phone = false }) {
  const store = useStore();
  const paint = useMemo(() => brandStyleVars(store), [store]);
  const themed = useMemo(
    () => Object.keys(paintAll(store?.libraryEdits) || {}).length > 0,
    [store?.libraryEdits],
  );
  const slides = useMemo(() => slidesOf(day), [day]);
  const n = slides.length;
  const ar = canvasAr(day?.format);
  const [slide, setSlide] = useState(0);
  const [restart, setRestart] = useState(0);
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));

  useEffect(() => {
    if (!feed) return undefined;
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [feed]);

  useEffect(() => { setSlide(0); setRestart(0); }, [day?._id, day?.date]);
  useEffect(() => {
    if (n < 2 || feed) return undefined; /* feed: studio pages with dots */
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const t = setInterval(() => setSlide((i) => (i + 1) % n), PEEK_MS);
    return () => clearInterval(t);
  }, [day?._id, day?.date, n, restart, feed]);

  const safe = Math.min(Math.max(slide, 0), Math.max(n - 1, 0));
  const cur = slides[safe] || slides[0];
  const doc = carouselDocumentOf(day);
  const carouselHtmls = slides.map((s) => s?.layoutHtml || '');

  const pickSlide = (i, e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    setSlide(i);
    setRestart((t) => t + 1);
  };

  const dots = n > 1 ? (
    <div className="yw-peek__dots" role="tablist" aria-label="Slides">
      {slides.map((_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          className={`yw-peek__dot${i === safe ? ' is-on' : ''}`}
          aria-label={`Slide ${i + 1} of ${n}`}
          aria-selected={i === safe}
          onClick={(e) => pickSlide(i, e)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ))}
    </div>
  ) : null;

  const slideNode = cur ? (
    <PeekSlide
      key={`${day?._id || day?.date}-${safe}`}
      slide={cur}
      paint={paint}
      themed={themed}
      documentHtml={doc}
      carouselLayoutHtmls={carouselHtmls}
      slideIndex={safe + 1}
    />
  ) : null;

  if (feed) {
    const natH = vw / ar;
    const boxH = Math.min(natH, vw / FEED_AR);
    return (
      <div className="yw-peek yw-peek--feed">
        <div
          className="yw-peek__frame yw-peek__frame--feed"
          style={{ width: '100%', height: `${Math.round(boxH)}px` }}
          aria-hidden="true"
        >
          <div className="wv-ig__photo yw-peek__photo-root yw-peek__photo-root--feed">
            {slideNode}
          </div>
        </div>
        {dots}
      </div>
    );
  }

  /* height-first: peek-h capped so actions stay on screen; width from ratio.
     Phone sheet uses 210px (bauhly-v3 `.msheet .yw-peek`). */
  const deskH = Math.min(phone ? 210 : 176, Math.round((phone ? 260 : 220) / ar));
  const deskW = Math.round(deskH * ar);
  const stageH = PEEK_STAGE;
  const stageW = Math.round(stageH * ar);

  return (
    <div
      className={`yw-peek${phone ? ' is-phone' : ''}`}
      style={{ '--peek-h': `${deskH}px`, '--peek-stage': `${stageH}px` }}
    >
      <div
        className="yw-peek__frame"
        style={{ width: `${deskW}px`, height: `${deskH}px` }}
        aria-hidden="true"
      >
        <div
          className="yw-peek__stage"
          style={{ width: `${stageW}px`, height: `${stageH}px`, aspectRatio: ar }}
        >
          <div className="wv-ig__photo yw-peek__photo-root">
            {slideNode}
          </div>
        </div>
      </div>
      {dots}
    </div>
  );
}

export default DayPeek;
