/*
 * Month-menu post peek — same slide paint as WeekView (`SlideMedia`), scaled
 * into the day menu. Dots step the carousel; the artwork is inert.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DynamicLayout from './DynamicLayout';
import { SlideCompose } from './slideLayouts';
import { BrandMark } from '../visuallibrary/BrandMark';
import {
  withSharedLayoutStyles,
  layoutDirectionOf,
  slideIsThemed,
  isCarouselDocument,
  carouselDocumentOf,
} from './layoutHtml';
import {
  mediaProxyUrl,
  toDisplayUrl,
  isProjectMediaKey,
  splitMediaKeys,
  iframeSafeUrl,
  canvasSafeUrl,
} from '../../api/media';
import { paintAll, logoPositionOf, markForSlide, themesOf, activeThemeIdOf, activeThemeAtOf, brandFontVars } from '../../lib/identity';
import { isThemedPicture } from '../../lib/themedSlide';
import { styleOf, groundOf } from '../../lib/visualbrand';
import { useStore } from '../../lib/store';
import { slideTick } from '../../native/haptics';
import '../weekView.css';

const PEEK_MS = 2800;
const PEEK_STAGE = 420; /* compose height; CSS scales to --peek-h */
const FEED_AR = 0.645; /* Instagram feed ceiling — tall formats trim */
/* the opened (lifted) feed post (bauhly-v3 FeedPost `lifted`): the air kept
   round it inside the band above the caption sheet, and the travel's timing */
const CAP_AIR = 32;
const LIFT_IN = { duration: 560, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
const LIFT_OUT = { duration: 440, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
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
  if (paint['--t-ground-image']) vars['--wv-ground-img'] = paint['--t-ground-image'];
  else if (ground.own && ground.url) vars['--wv-ground-img'] = `url(${ground.url})`;
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

// A Theme Apply render (`…/themed-…`) is the picture only on a themed-image
// slide; an HTML slide's photo slots take the original photos.
const THEMED_RENDER = /\/themed-/;
function keysOf(slide) {
  const themed = /^themed-image/.test(String(slide?.layoutTheme || ''));
  const own = (list) => (themed ? list : list.filter((k) => !THEMED_RENDER.test(k)));
  const listed = own(splitMediaKeys(slide?.assetKeys));
  if (listed.length) return listed;
  const single = own(splitMediaKeys(slide?.assetKey));
  if (single.length) return single;
  const fromVisual = own(splitMediaKeys(slide?.visual?.assetKey || slide?.image?.key));
  if (fromVisual.length) return fromVisual;
  return own(keysFromLayoutHtml(slide?.layoutHtml));
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
  // a Theme Apply picture carries its logo painted in — no overlay on it
  const mark = isThemedPicture(slide)
    ? null
    : markForSlide(store.brandLogos, slide, urls[0] ? 'photo' : 'ground');
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
export function DayPeek({ day, feed = false, phone = false, lifted = false, liftSheet = 0 }) {
  const store = useStore();
  const paint = useMemo(() => brandStyleVars(store), [store]);
  // Same rule as WeekView's own preview: agent-generated slides render as the
  // raw model output, never auto-repainted with Library visual settings — so
  // this calendar peek always matches what the post actually looks like open.
  // ...except the Brand Kit colour set, as WeekView's paintFor draws it: the
  // slide's own set, else the kit's default ('original' = generated colours).
  const kitSets = useMemo(() => themesOf(store?.libraryEdits), [store?.libraryEdits]);
  const kitDefault = useMemo(() => activeThemeIdOf(store?.libraryEdits), [store?.libraryEdits]);
  const kitDefaultAt = useMemo(() => activeThemeAtOf(store?.libraryEdits), [store?.libraryEdits]);
  const setPaint = (sl) => {
    // a post's own pick holds only if made since the Brand Kit default last changed
    const own = (Number(sl?.colorSetAt) || 0) >= kitDefaultAt ? String(sl?.colorSet || '') : '';
    const id = own === 'original' ? ''
      : (own || (isThemedPicture(sl) ? '' : kitDefault));
    const p = (id && kitSets.find((t) => t.id === id)?.palette) || null;
    if (!p) return null;
    const out = {};
    if (p.ground) out['--t-ground-bg'] = p.ground;
    if (p.fg) out['--t-ground-fg'] = p.fg;
    if (p.accent) out['--t-accent-bg'] = p.accent;
    return Object.keys(out).length ? out : null;
  };
  const slides = useMemo(() => slidesOf(day), [day]);
  const n = slides.length;
  const ar = canvasAr(day?.format);
  const [slide, setSlide] = useState(0);
  const [restart, setRestart] = useState(0);
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375));
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 812));
  const frameRef = useRef(null);
  const lastRect = useRef(null);
  const trackRef = useRef(null);
  const seen = useRef(0);

  /* the post travels between the feed and its lifted place (FLIP): the frame's
     box is read after every layout, and when `lifted` flips the new box is
     animated in from the one it had — `translate`/`scale` compose with the
     lifted frame's own `transform`, so the two never fight */
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!feed || !el) return;
    const now = el.getBoundingClientRect();
    const was = lastRect.current;
    lastRect.current = { rect: now, lifted };
    if (!was || was.lifted === lifted || !now.width || !was.rect.width) return;
    if (typeof el.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const k = was.rect.width / now.width;
    el.animate([
      { translate: `${was.rect.left - now.left}px ${was.rect.top - now.top}px`, scale: `${k}` },
      { translate: '0px 0px', scale: '1' },
    ], lifted ? LIFT_IN : LIFT_OUT);
  });

  useEffect(() => {
    if (!feed) return undefined;
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [feed]);

  useEffect(() => {
    setSlide(0);
    setRestart(0);
    seen.current = 0;
    if (trackRef.current) trackRef.current.scrollLeft = 0;
  }, [day?._id, day?.date]);
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
    const track = trackRef.current;
    if (feed && track) {
      // the feed's slides are a swipe track: a dot scrolls it, and the scroll
      // sets the slide
      track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
      return;
    }
    setSlide(i);
    setRestart((t) => t + 1);
  };

  /* the feed's track: whichever slide the scroll has settled nearest is the
     current one (dots + a light haptic tick in the app) */
  const onTrackScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const i = Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
    if (i === seen.current) return;
    seen.current = i;
    setSlide(i);
    slideTick();
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

  const nodeFor = (i) => {
    const sl = slides[i];
    if (!sl) return null;
    const set = setPaint(sl);
    // Brand Kit Typography, as WeekView's paintFor (not on a Theme Apply render)
    const fonts = !isThemedPicture(sl) ? brandFontVars(store?.libraryEdits) : {};
    return (
      <PeekSlide
        key={`${day?._id || day?.date}-${i}`}
        slide={sl}
        paint={{ ...(set ? { ...paint, '--t-ground-image': '', '--wv-ground-img': '', ...set } : paint), ...fonts }}
        themed={set ? 'colours' : false}
        documentHtml={doc}
        carouselLayoutHtmls={carouselHtmls}
        slideIndex={i + 1}
      />
    );
  };
  const slideNode = cur ? nodeFor(safe) : null;

  if (feed) {
    const natH = vw / ar;
    const boxH = Math.min(natH, vw / FEED_AR);
    /* Lifted: the WHOLE post (no feed trim), drawn at full width and scaled
       down into the band the caption sheet leaves, centred in it. The box in
       the feed keeps its height so nothing under it moves (bauhly-v3). */
    let liftStyle = null;
    if (lifted) {
      const sheetH = liftSheet > 0 ? liftSheet : Math.min(vh * 0.5, 620);
      const band = Math.max(180, vh - sheetH);
      const liftH = Math.min(natH, band - CAP_AIR);
      const scale = natH > 0 ? liftH / natH : 1;
      liftStyle = {
        position: 'fixed',
        top: `${Math.round((band - liftH) / 2)}px`,
        left: `${Math.round((vw - liftH * ar) / 2)}px`,
        '--lift-w': `${Math.round(vw)}px`,
        height: `${Math.round(natH)}px`,
        transformOrigin: 'top left',
        transform: `scale(${scale.toFixed(4)})`,
        borderRadius: `${(18 / scale).toFixed(2)}px`,
      };
    }
    return (
      <div className="yw-peek yw-peek--feed">
        <div className="yw-peek__hold" style={{ height: `${Math.round(boxH)}px` }}>
          <div
            ref={frameRef}
            className={`yw-peek__frame yw-peek__frame--feed${lifted ? ' is-lift' : ''}`}
            style={liftStyle || { width: '100%', height: `${Math.round(boxH)}px` }}
            aria-hidden="true"
          >
            {/* every slide side by side in a scroll-snapping track, so a
                swipe moves between them with the phone's own scrolling
                (momentum, rubber-band); only the current slide and its
                neighbours are drawn */}
            <div className="yw-peek__track" ref={trackRef} onScroll={n > 1 ? onTrackScroll : undefined}>
              {slides.map((_, i) => (
                <div className="yw-peek__cell" key={i}>
                  <div className="wv-ig__photo yw-peek__photo-root yw-peek__photo-root--feed">
                    {Math.abs(i - safe) <= 1 ? nodeFor(i) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {dots}
      </div>
    );
  }

  /* height-first: peek-h capped so actions stay on screen; width from ratio.
     Phone sheet uses 210px (bauhly-v3 `.msheet .yw-peek`). */
  // desktop menu: the slide fills a ~232px column at its own ratio (bauhly-v3
  // shows the post large enough to recognise; 176 left a 4:5 slide 141px wide)
  const deskH = Math.min(phone ? 210 : 290, Math.round((phone ? 260 : 232) / ar));
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
