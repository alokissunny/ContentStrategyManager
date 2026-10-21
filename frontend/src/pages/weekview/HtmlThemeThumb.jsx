import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HTML_THEME_FONTS_URL } from '../../lib/htmlThemes';

// A 1080 × 1350 HTML template drawn small: the real page in an inert iframe,
// scaled to whatever width the tile has.
export default function HtmlThemeThumb({ html }) {
  const wrap = useRef(null);
  const [scale, setScale] = useState(0.1);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const fit = () => setScale((el.clientWidth || 108) / 1080);
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${HTML_THEME_FONTS_URL}"><style>html,body{margin:0;overflow:hidden;background:transparent}</style></head><body>${html || ''}</body></html>`, [html]);
  return (
    <span ref={wrap} className="wv-em__htmlthumb" aria-hidden="true">
      <iframe
        title=""
        tabIndex={-1}
        sandbox=""
        srcDoc={doc}
        style={{ transform: `scale(${scale})` }}
      />
    </span>
  );
}
