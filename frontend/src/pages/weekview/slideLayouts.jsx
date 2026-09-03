/*
 * The four compositions offered by Change layout — wireframe shapes the
 * studio can apply to a slide without going through the Visual Library.
 */

import { COLOUR_VAR, titleRuns } from '../../lib/slidetext';

export const CHANGE_LAYOUTS = [
  {
    id: 'fit-split',
    name: 'Text & picture',
    kind: 'split',
    when: 'Headline and body beside a tall photograph.',
    imgs: [null],
    art: {
      head: 'Why we move the kitchen before we touch the walls',
      body: 'Most of the plans we inherit put the kitchen where the plumbing already is.',
    },
  },
  {
    id: 'fit-before-after',
    name: 'Before & after',
    kind: 'before-after',
    when: 'One claim, with before and after stacked beside it.',
    imgs: [null, null],
    art: {
      head: 'Same footprint, one wall fewer',
      labels: ['Before', 'After'],
    },
  },
  {
    id: 'fit-process',
    name: 'Process steps',
    kind: 'process',
    when: 'A short title over named steps, each with its own line.',
    imgs: [],
    art: {
      head: 'How a project runs',
      items: [
        { label: 'Walk', body: 'We spend a morning in the space before drawing anything.' },
        { label: 'Draw', body: 'Two plans, not ten. Each one answers a different question.' },
        { label: 'Decide', body: 'You choose the plan. We fix the budget to it.' },
        { label: 'Build', body: 'One site visit a week, and a photo the same evening.' },
      ],
    },
  },
  {
    id: 'fit-quote',
    name: 'Quote & picture',
    kind: 'quote-split',
    when: 'A short statement held beside a tall photograph.',
    imgs: [null],
    art: {
      head: 'The room was never too small. It was too divided.',
    },
  },
];

export function findChangeLayout(id) {
  if (!id) return null;
  return CHANGE_LAYOUTS.find((l) => l.id === id) || null;
}

export function shotsForLayout(layout) {
  return Math.max(0, layout?.imgs?.length || 0);
}

/** Parse a slide item into { label, body } for the process layout. */
export function stepOf(item, index) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const label = String(item.label || item.title || '').trim();
    const body = String(item.body || item.text || item.line || '').trim();
    if (label || body) return { label: label || String(index + 1).padStart(2, '0'), body: body || label };
  }
  const raw = String(item || '').trim();
  if (!raw) return null;
  const m = raw.match(/^([^—:\n]{1,28})\s*[—:]\s+(.+)$/s);
  if (m) return { label: m[1].trim(), body: m[2].trim() };
  return { label: String(index + 1).padStart(2, '0'), body: raw };
}

export function stepsOf(slide, copy) {
  const fromItems = (Array.isArray(slide?.items) ? slide.items : [])
    .map((it, i) => stepOf(it, i))
    .filter(Boolean);
  if (fromItems.length) return fromItems;
  const body = copy?.sub || copy?.body || '';
  if (body) return [{ label: '01', body }];
  return [];
}

/** Grey wireframe specimen for the Change layout picker. */
export function LayoutSpecimen({ layout }) {
  const kind = layout?.kind || 'split';
  if (kind === 'before-after') {
    return (
      <span className="wv-spec wv-spec--ba" aria-hidden="true">
        <span className="wv-spec__line wv-spec__line--lg" />
        <span className="wv-spec__stack">
          <span className="wv-spec__ba">
            <em>Before</em>
            <span className="wv-spec__ph" />
          </span>
          <span className="wv-spec__ba">
            <em>After</em>
            <span className="wv-spec__ph" />
          </span>
        </span>
      </span>
    );
  }
  if (kind === 'process') {
    return (
      <span className="wv-spec wv-spec--process" aria-hidden="true">
        <span className="wv-spec__line wv-spec__line--sm" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="wv-spec__step">
            <span className="wv-spec__line wv-spec__line--xs" />
            <span className="wv-spec__line wv-spec__line--md" />
          </span>
        ))}
      </span>
    );
  }
  if (kind === 'quote-split') {
    return (
      <span className="wv-spec wv-spec--quote" aria-hidden="true">
        <span className="wv-spec__copy">
          <span className="wv-spec__line" />
          <span className="wv-spec__line" />
          <span className="wv-spec__line wv-spec__line--short" />
        </span>
        <span className="wv-spec__ph" />
      </span>
    );
  }
  return (
    <span className="wv-spec wv-spec--split" aria-hidden="true">
      <span className="wv-spec__copy">
        <span className="wv-spec__line" />
        <span className="wv-spec__line" />
        <span className="wv-spec__line wv-spec__line--short" />
        <span className="wv-spec__line wv-spec__line--body" />
        <span className="wv-spec__line wv-spec__line--body" />
        <span className="wv-spec__line wv-spec__line--body wv-spec__line--short" />
      </span>
      <span className="wv-spec__ph" />
    </span>
  );
}

function PhotoSlot({ src, className = '' }) {
  return (
    <div className={`wv-fit__frame${className ? ` ${className}` : ''}`}>
      {src ? <img className="wv-fit__photo" src={src} alt="" /> : <span className="wv-fit__ph" aria-hidden="true" />}
    </div>
  );
}

/** Paint {{accent|…}} (and other palette marks) instead of showing the tags. */
function MarkedLine({ text, as: Tag = 'p', className }) {
  const src = String(text || '');
  if (!src.trim()) return null;
  const runs = titleRuns(src);
  return (
    <Tag className={className}>
      {runs.map((r, i) => (
        r.mark
          ? <em key={`${r.mark}-${i}`} style={{ color: COLOUR_VAR[r.mark] || COLOUR_VAR.accent }}>{r.text}</em>
          : <span key={`fg-${i}`}>{r.text}</span>
      ))}
    </Tag>
  );
}

/**
 * Compose a slide into one of the Change layout shapes (or fall back to the
 * stacked best-fit used when no layout is chosen).
 */
export function SlideCompose({
  kind = 'best-fit',
  copy,
  urls = [],
  slide,
  showVisualHint = false,
  need = null,
  subjects = null,
  AnnotationOverlay = null,
}) {
  const src = urls[0] || null;
  const showHint = Boolean(need) && showVisualHint && !src;

  if (kind === 'split') {
    return (
      <div className={`wv-fit wv-fit--split${showHint ? ' is-needvisual' : ''}`}>
        <div className="wv-fit__copy">
          <MarkedLine className="wv-fit__title" text={copy.title} />
          <MarkedLine className="wv-fit__sub" text={copy.sub || copy.body} />
        </div>
        <PhotoSlot src={src} />
      </div>
    );
  }

  if (kind === 'quote-split') {
    const line = copy.title || copy.quote || copy.sub || '';
    return (
      <div className={`wv-fit wv-fit--quote${showHint ? ' is-needvisual' : ''}`}>
        <div className="wv-fit__copy">
          <MarkedLine className="wv-fit__title" text={line} />
        </div>
        <PhotoSlot src={src} />
      </div>
    );
  }

  if (kind === 'before-after') {
    const labels = ['Before', 'After'];
    return (
      <div className={`wv-fit wv-fit--ba${showHint ? ' is-needvisual' : ''}`}>
        <div className="wv-fit__copy">
          <MarkedLine className="wv-fit__title" text={copy.title} />
        </div>
        <div className="wv-fit__stack">
          {[0, 1].map((i) => (
            <div key={i} className="wv-fit__ba">
              <span className="wv-fit__label">{labels[i]}</span>
              <PhotoSlot src={urls[i] || null} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (kind === 'process') {
    const steps = stepsOf(slide, copy);
    return (
      <div className={`wv-fit wv-fit--process${showHint ? ' is-needvisual' : ''}`}>
        <MarkedLine className="wv-fit__kicker" text={copy.title} />
        <div className="wv-fit__steps">
          {steps.map((step) => (
            <div key={`${step.label}-${step.body}`} className="wv-fit__step">
              <MarkedLine as="span" className="wv-fit__label" text={step.label} />
              <MarkedLine className="wv-fit__title" text={step.body} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* best-fit — stacked copy, optional full-bleed photo */
  return (
    <div className={`wv-fit${src ? ' has-photo' : ''}${showHint ? ' is-needvisual' : ''}`}>
      <div className="wv-fit__slot">
        {src ? <img className="wv-fit__photo" src={src} alt="" /> : null}
        {src && copy.annotation && AnnotationOverlay
          ? <AnnotationOverlay annotation={copy.annotation} subjects={subjects} />
          : null}
      </div>
      <div className="wv-fit__copy">
        <MarkedLine className="wv-fit__stat" text={copy.stat} />
        <MarkedLine className="wv-fit__title" text={copy.title} />
        <MarkedLine className="wv-fit__sub" text={copy.sub} />
        {copy.body && copy.body !== copy.sub ? <MarkedLine className="wv-fit__sub" text={copy.body} /> : null}
        {copy.cmpA || copy.cmpB ? (
          <p className="wv-fit__pair">
            {copy.cmpA ? <MarkedLine as="span" text={copy.cmpA} /> : null}
            {copy.cmpA && copy.cmpB ? <i className="wv-fit__rule" aria-hidden="true" /> : null}
            {copy.cmpB ? <MarkedLine as="span" text={copy.cmpB} /> : null}
          </p>
        ) : null}
        <MarkedLine className="wv-fit__quote" text={copy.quote} />
        {copy.items?.length ? (
          <ul className="wv-fit__list">
            {copy.items.map((item) => (
              <li key={item}><MarkedLine as="span" text={item} /></li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
