import { useMemo } from 'react';

function trim(value) {
  return String(value || '').trim();
}

function wordCount(value) {
  return trim(value).split(/\s+/).filter(Boolean).length;
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

function SafeLayout({ copy, imageUrls }) {
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
        <h1 className={`wv-safe__bleedtitle${wordCount(title) >= 10 ? ' is-long' : ''}`}>{title}</h1>
      </div>
    );
  }

  if (src) {
    return (
      <div className="wv-safe wv-safe--stack">
        <div className="wv-safe__photo"><img src={src} alt="" /></div>
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

export default function DynamicLayout({ copy, imageUrls }) {
  return (
    <div className="wv-dynlay">
      <SafeLayout copy={copy} imageUrls={imageUrls} />
    </div>
  );
}
