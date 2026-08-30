import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { prepareLayoutHtml, splitLayoutDocument } from './layoutHtml';
import { boxOf, fmtBox, mapBoxToCover, mapPointToCover, normalizeSubjects, placeFromBox, resolveTargetBox } from './subjectBox';
import { useAiDebug } from '../../lib/aiDebug';

function trim(value) {
  return String(value || '').trim();
}

function wordCount(value) {
  return trim(value).split(/\s+/).filter(Boolean).length;
}

const ANNOTE_REGIONS = new Set([
  'top-left', 'top', 'top-right', 'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]);

function annotationOf(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = trim(value);
    return text ? { text, targetSubject: '', targetRegion: 'center' } : null;
  }
  const text = trim(value.text);
  if (!text) return null;
  const region = trim(value.targetRegion).toLowerCase().replace(/[_\s]+/g, '-');
  return {
    text,
    targetSubject: trim(value.targetSubject),
    targetRegion: ANNOTE_REGIONS.has(region) ? region : 'center',
    targetBox: boxOf(value.targetBox),
  };
}

const LABEL_AT = {
  'top-left': { x: 58, y: 16 },
  top: { x: 14, y: 36 },
  'top-right': { x: 10, y: 16 },
  left: { x: 56, y: 16 },
  center: { x: 60, y: 14 },
  right: { x: 8, y: 16 },
  'bottom-left': { x: 52, y: 14 },
  bottom: { x: 60, y: 16 },
  'bottom-right': { x: 8, y: 16 },
};

const TARGET_AT = {
  'top-left': { x: 22, y: 26 },
  top: { x: 50, y: 22 },
  'top-right': { x: 78, y: 26 },
  left: { x: 22, y: 48 },
  center: { x: 46, y: 46 },
  right: { x: 78, y: 48 },
  'bottom-left': { x: 24, y: 68 },
  bottom: { x: 50, y: 70 },
  'bottom-right': { x: 78, y: 68 },
};

function curvePath(from, to) {
  const sx = from.x + (to.x > from.x ? 10 : 2);
  const sy = from.y + 7;
  const mx = (sx + to.x) / 2;
  const my = (sy + to.y) / 2;
  const cx = mx + (to.y - sy) * 0.22;
  const cy = my - (to.x - sx) * 0.22;
  return `M${sx},${sy} Q${cx.toFixed(1)},${cy.toFixed(1)} ${to.x},${to.y}`;
}

function placedAnnotation(annotation, subjects) {
  const data = annotationOf(annotation);
  if (!data) return null;
  const resolved = resolveTargetBox(data, subjects);
  const fromBox = placeFromBox(resolved.box, {
    name: resolved.subject?.name || '',
    query: data.targetSubject || data.text,
    point: resolved.point,
  });
  if (fromBox) return { ...data, ...fromBox };
  return {
    ...data,
    label: LABEL_AT[data.targetRegion] || LABEL_AT.center,
    target: TARGET_AT[data.targetRegion] || TARGET_AT.center,
  };
}

function SubjectDebug({ annotation, subjects, img }) {
  const debug = useAiDebug();
  if (!debug.enabled) return null;
  const data = annotationOf(annotation);
  const resolved = resolveTargetBox(data, subjects);
  const items = normalizeSubjects(subjects);
  const mapped = (box) => (img ? mapBoxToCover(box, img) : boxOf(box));
  return (
    <div className="wv-boxdbg" aria-hidden="true">
      {items.map((s, i) => {
        const vis = mapped(s.box);
        if (!vis) return null;
        const hit = resolved.subject && s.name === resolved.subject.name;
        return (
          <div
            key={`${s.name}-${i}`}
            className={`wv-boxdbg__box${hit ? ' is-hit' : ''}`}
            style={{ left: `${vis.x}%`, top: `${vis.y}%`, width: `${vis.w}%`, height: `${vis.h}%` }}
          >
            <span>{s.name} · {fmtBox(s.box)}</span>
          </div>
        );
      })}
      {resolved.box && !resolved.subject?.box ? (
        <div
          className="wv-boxdbg__box is-hit"
          style={{
            left: `${(mapped(resolved.box) || resolved.box).x}%`,
            top: `${(mapped(resolved.box) || resolved.box).y}%`,
            width: `${(mapped(resolved.box) || resolved.box).w}%`,
            height: `${(mapped(resolved.box) || resolved.box).h}%`,
          }}
        >
          <span>targetBox · {fmtBox(resolved.box)}</span>
        </div>
      ) : null}
      {resolved.box ? (() => {
        const aim = resolved.point || { x: resolved.box.x + resolved.box.w / 2, y: resolved.box.y + resolved.box.h / 2 };
        const visAim = img ? mapPointToCover(aim, img) : aim;
        return visAim ? (
          <i
            className="wv-boxdbg__aim"
            style={{ left: `${visAim.x}%`, top: `${visAim.y}%` }}
          />
        ) : null;
      })() : null}
      <p className="wv-boxdbg__readout">
        {resolved.box
          ? `${resolved.source || 'box'} · ${data?.targetSubject || data?.text || 'subject'} · ${fmtBox(resolved.box)}`
          : 'no subject box — using region guess'}
      </p>
    </div>
  );
}

function PhotoPinnedOverlay({ annotation, subjects, canvasRef, paint }) {
  const [frame, setFrame] = useState(null);
  const [imgEl, setImgEl] = useState(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.closest('.wv-dynlay');
    const img = canvas?.querySelector('img[data-slot="image"]');
    setImgEl(img || null);
    if (!host || !img) return undefined;
    const update = () => {
      const hr = host.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      if (!hr.width || !hr.height || !ir.width || !ir.height) return;
      setFrame({
        left: ((ir.left - hr.left) / hr.width) * 100,
        top: ((ir.top - hr.top) / hr.height) * 100,
        width: (ir.width / hr.width) * 100,
        height: (ir.height / hr.height) * 100,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(host);
    ro.observe(img);
    img.addEventListener('load', update);
    return () => {
      ro.disconnect();
      img.removeEventListener('load', update);
    };
  }, [canvasRef, annotation]);
  const style = frame
    ? {
      left: `${frame.left}%`,
      top: `${frame.top}%`,
      width: `${frame.width}%`,
      height: `${frame.height}%`,
      right: 'auto',
      bottom: 'auto',
    }
    : undefined;
  return (
    <div className="wv-annote-pin" style={style}>
      <AnnotationOverlay annotation={annotation} subjects={subjects} img={imgEl} paint={paint} />
    </div>
  );
}

export function AnnotationOverlay({ annotation, markerId, subjects, img, paint }) {
  const data = placedAnnotation(annotation, subjects);
  const autoId = useId().replace(/:/g, '');
  const id = markerId || `annote-${autoId}`;
  if (!data) return null;
  const label = data.label;
  const target = data.target;
  const head = paint?.['--t-headline-face'];
  return (
    <div className="wv-annote" data-slot="annotation" aria-hidden="true">
      <SubjectDebug annotation={annotation} subjects={subjects} img={img} />
      <p
        className="wv-annote__label"
        style={{ left: `${label.x}%`, top: `${label.y}%`, ...(head ? { fontFamily: head } : {}) }}
      >
        {data.text}
      </p>
      <svg className="wv-annote__arrow" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id={id} markerWidth="5" markerHeight="5" refX="4.2" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </marker>
        </defs>
        <path
          d={curvePath(label, target)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#${id})`}
        />
      </svg>
    </div>
  );
}

function CopyBlock({ copy }) {
  const title = trim(copy?.title);
  const subtitle = trim(copy?.subtitle);
  const body = trim(copy?.body);
  const items = Array.isArray(copy?.items) ? copy.items.map(trim).filter(Boolean) : [];
  const cmpA = trim(copy?.comparisonA);
  const cmpB = trim(copy?.comparisonB);
  const stat = trim(copy?.stat);
  const quote = trim(copy?.quote);
  const action = trim(copy?.action);
  const long = wordCount(title) >= 10;
  const restBody = body && body !== subtitle && body !== title ? body : '';
  return (
    <div className="wv-safe__copy">
      {stat ? <p className="wv-safe__stat">{stat}</p> : null}
      {quote ? <blockquote className="wv-safe__quote">{quote}</blockquote> : null}
      {title ? <h1 className={`wv-safe__title${long ? ' is-long' : ''}`}>{title}</h1> : null}
      {subtitle && subtitle !== title ? <p className="wv-safe__sub">{subtitle}</p> : null}
      {restBody ? <p className="wv-safe__body">{restBody}</p> : null}
      {items.length ? (
        <ul className="wv-safe__items">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {cmpA || cmpB ? (
        <div className="wv-safe__cmp">
          {cmpA ? <p>{cmpA}</p> : null}
          {cmpA && cmpB ? <i className="wv-safe__rule" aria-hidden="true" /> : null}
          {cmpB ? <p>{cmpB}</p> : null}
        </div>
      ) : null}
      {action ? <p className="wv-safe__action">{action}</p> : null}
    </div>
  );
}

function SafeLayout({ copy, imageUrls, subjects, paint }) {
  const src = (Array.isArray(imageUrls) ? imageUrls : []).find(Boolean) || '';
  const title = trim(copy?.title);
  const hasCopy = Boolean(
    title
    || trim(copy?.subtitle)
    || trim(copy?.body)
    || (Array.isArray(copy?.items) && copy.items.some(trim))
    || trim(copy?.comparisonA)
    || trim(copy?.comparisonB)
    || trim(copy?.stat)
    || trim(copy?.quote)
    || trim(copy?.action),
  );
  const annote = annotationOf(copy?.annotation);
  const titleOnly = Boolean(
    src && title && !trim(copy?.subtitle) && !trim(copy?.body)
    && !(copy?.items || []).some(trim)
    && !trim(copy?.comparisonA) && !trim(copy?.comparisonB)
    && !trim(copy?.stat) && !trim(copy?.quote) && !trim(copy?.action),
  );

  if (titleOnly) {
    return (
      <div className="wv-safe wv-safe--bleed">
        <img className="wv-safe__bleedimg" src={src} alt="" />
        <div className="wv-safe__scrim" aria-hidden="true" />
        {annote ? <AnnotationOverlay annotation={annote} subjects={subjects} paint={paint} /> : null}
        <h1 className={`wv-safe__bleedtitle${wordCount(title) >= 10 ? ' is-long' : ''}`}>{title}</h1>
      </div>
    );
  }

  if (src) {
    return (
      <div className="wv-safe wv-safe--stack">
        <div className="wv-safe__photo">
          <img src={src} alt="" />
          {annote ? <AnnotationOverlay annotation={annote} subjects={subjects} paint={paint} /> : null}
        </div>
        {hasCopy ? <CopyBlock copy={copy} /> : null}
      </div>
    );
  }

  return (
    <div className="wv-safe wv-safe--type">
      <CopyBlock copy={copy} />
    </div>
  );
}

function CopyOnPhoto({ copy, paint }) {
  const title = trim(copy?.title);
  const sub = trim(copy?.subtitle) || trim(copy?.body);
  const items = Array.isArray(copy?.items) ? copy.items.map(trim).filter(Boolean) : [];
  const quote = trim(copy?.quote);
  const stat = trim(copy?.stat);
  const action = trim(copy?.action);
  if (!title && !sub && !items.length && !quote && !stat && !action) return null;
  const head = paint?.['--t-headline-face'];
  const body = paint?.['--t-body-face'];
  return (
    <div className="wv-copy-pin" aria-hidden="true">
      <div className="wv-copy-pin__scrim" />
      <div className="wv-copy-pin__words" style={head ? { fontFamily: head } : undefined}>
        {stat ? <p className="wv-copy-pin__stat" style={head ? { fontFamily: head } : undefined}>{stat}</p> : null}
        {quote ? <p className="wv-copy-pin__quote" style={head ? { fontFamily: head } : undefined}>{quote}</p> : null}
        {title ? <h1 className={wordCount(title) >= 10 ? 'is-long' : ''} style={head ? { fontFamily: head } : undefined}>{title}</h1> : null}
        {sub && sub !== title ? <p style={body ? { fontFamily: body } : undefined}>{sub}</p> : null}
        {items.length ? (
          <ul>
            {items.map((item) => <li key={item} style={body ? { fontFamily: body } : undefined}>{item}</li>)}
          </ul>
        ) : null}
        {action && action !== title ? <p style={body ? { fontFamily: body } : undefined}>{action}</p> : null}
      </div>
    </div>
  );
}

function copyKey(copy) {
  if (!copy) return '';
  const items = Array.isArray(copy.items) ? copy.items.join('\n') : '';
  const ann = copy.annotation;
  const annKey = typeof ann === 'string' ? ann : `${ann?.text || ''}|${ann?.targetSubject || ''}`;
  return [
    copy.title, copy.subtitle, copy.body, copy.stat, copy.quote, copy.action,
    copy.comparisonA, copy.comparisonB, items, annKey,
  ].join('\0');
}

export default function DynamicLayout({ html, copy, imageUrls, subjects, paint }) {
  const scope = `wv${useId().replace(/:/g, '')}`;
  const canvasRef = useRef(null);
  const shownFor = useRef('');
  const [, bump] = useState(0);
  const urls = Array.isArray(imageUrls) ? imageUrls : [];
  const urlKey = urls.filter(Boolean).join('|');
  const packedCopy = copyKey(copy);
  const markup = useMemo(
    () => prepareLayoutHtml(html, { scope, imageUrls: urls, copy }),
    // urls/copy are new objects each parent render; urlKey and packedCopy are the inputs.
    [html, scope, urlKey, packedCopy],
  );
  const { css, body } = useMemo(() => splitLayoutDocument(markup), [markup]);
  const paintKey = `${html}\0${packedCopy}`;
  const ready = shownFor.current === paintKey;
  const annote = annotationOf(copy?.annotation);
  const overlayCopy = Boolean(
    urls.some(Boolean)
    && (trim(copy?.title) || trim(copy?.subtitle) || trim(copy?.body)
      || trim(copy?.quote) || trim(copy?.stat) || trim(copy?.action)
      || (Array.isArray(copy?.items) && copy.items.some(trim))),
  );

  useLayoutEffect(() => {
    const node = canvasRef.current;
    if (node) void node.offsetWidth;
    if (shownFor.current === paintKey) return undefined;
    shownFor.current = paintKey;
    bump((n) => n + 1);
    return undefined;
  }, [paintKey]);

  if (markup && body) {
    return (
      <div className={`wv-dynlay${annote && urls.some(Boolean) ? ' is-annote-over' : ''}${overlayCopy ? ' is-copy-over' : ''}${ready ? ' is-ready' : ''}`} style={paint}>
        {css ? <style>{css}</style> : null}
        <div ref={canvasRef} className={`wv-dynlay__canvas ${scope}`} dangerouslySetInnerHTML={{ __html: body }} />
        {overlayCopy ? <CopyOnPhoto copy={copy} paint={paint} /> : null}
        {urls.some(Boolean) && annote
          ? <PhotoPinnedOverlay annotation={annote} subjects={subjects} canvasRef={canvasRef} paint={paint} />
          : null}
      </div>
    );
  }

  return (
    <div className="wv-dynlay is-ready" style={paint}>
      <SafeLayout copy={copy} imageUrls={urls} subjects={subjects} paint={paint} />
    </div>
  );
}
