import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPostPreview } from '../../services/customers/liveRepository'

/*
 * One generated post, slide by slide, as the customer sees it. The post's own
 * carousel document is drawn in a sandboxed iframe (no scripts) at its real
 * 1080px width and scaled down; one <article class="slide"> is shown at a time
 * — the same crop the customer app makes. Brand Kit colour/font overrides and
 * the logo overlay the app adds at view time are not drawn.
 */

const WIDTH = 1080

/** The document with only slide `index` (0-based) on its canvas. */
export function slideDocument(html: string, index: number, height: number): string {
  // slide order = data-index (the slide number), not document order: a Theme
  // Apply slide sits in its own <section>, often last in the document
  const tags: { at: number; pos: number }[] = []
  for (const m of html.matchAll(/<article\b[^>]*>/gi)) {
    if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(m[0])) continue
    const n = Number((/\bdata-index\s*=\s*["']?(\d+)/i.exec(m[0]) || [])[1])
    tags.push({ at: Number.isFinite(n) && n > 0 ? n : tags.length + 1, pos: tags.length })
  }
  const want = [...tags].sort((x, y) => x.at - y.at || x.pos - y.pos)[index]?.pos ?? -1
  let n = -1
  const marked = html.replace(/<article\b[^>]*>/gi, (tag) => {
    if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(tag)) return tag
    n += 1
    return n === want ? tag.replace(/^<article\b/i, '<article data-pv="1"') : tag
  })
  const css = `<style>
html,body{margin:0!important;padding:0!important;width:${WIDTH}px!important;height:${height}px!important;overflow:hidden!important;background:#fff}
body *{visibility:hidden!important}
article[data-pv],article[data-pv] *{visibility:visible!important}
article[data-pv]{position:fixed!important;left:0!important;top:0!important;width:${WIDTH}px!important;margin:0!important;transform:none!important;z-index:2147483647}
</style>`
  return /<\/head>/i.test(marked) ? marked.replace(/<\/head>/i, `${css}</head>`) : `${css}${marked}`
}

export function PostPreview({
  customerId,
  postId,
  includeAdmins,
}: {
  customerId: string
  postId: string
  includeAdmins: boolean
}) {
  const [at, setAt] = useState(0)
  const [large, setLarge] = useState(false)
  const q = useQuery({
    queryKey: ['post-preview', customerId, postId, includeAdmins],
    queryFn: () => getPostPreview(customerId, postId, { includeAdmins }),
    staleTime: 60_000,
  })
  const p = q.data
  const count = p?.slideCount ?? 0
  const safe = Math.min(at, Math.max(count - 1, 0))
  const doc = useMemo(
    () => (p?.html && count ? slideDocument(p.html, safe, p.height) : ''),
    [p?.html, p?.height, count, safe],
  )

  if (q.isPending) return <div className="pv-frame pv-frame--wait" role="status">Loading preview…</div>
  if (q.isError) return <p className="act-empty">Couldn’t load the preview.</p>
  if (!p || !doc) return <p className="act-empty">No preview stored for this post.</p>

  const w = large ? 480 : 300
  const scale = w / WIDTH
  const h = Math.round(p.height * scale)

  return (
    <div className="pv">
      <div className="pv-frame" style={{ width: w, height: h }}>
        <iframe
          key={safe}
          title={`Slide ${safe + 1} of ${count}`}
          sandbox=""
          srcDoc={doc}
          loading="lazy"
          style={{ width: WIDTH, height: p.height, transform: `scale(${scale})` }}
        />
      </div>
      <div className="pv-bar">
        <button type="button" className="pv-step" onClick={() => setAt(Math.max(safe - 1, 0))} disabled={safe === 0} aria-label="Previous slide">‹</button>
        <div className="pv-dots" role="tablist" aria-label="Slides">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === safe}
              aria-label={`Slide ${i + 1}`}
              className={`pv-dot ${i === safe ? 'is-on' : ''}`}
              onClick={() => setAt(i)}
            />
          ))}
        </div>
        <button type="button" className="pv-step" onClick={() => setAt(Math.min(safe + 1, count - 1))} disabled={safe >= count - 1} aria-label="Next slide">›</button>
        <span className="pv-n">{`${safe + 1} / ${count}`}</span>
        <button type="button" className="act-link pv-size" onClick={() => setLarge(!large)}>
          {large ? 'Smaller' : 'Larger'}
        </button>
      </div>
    </div>
  )
}

/** One slide of a carousel document, drawn `width` px wide. */
export function SlideFrame({
  html,
  index,
  height,
  width,
  title,
}: {
  html: string
  index: number
  height: number
  width: number
  title: string
}) {
  const doc = useMemo(() => slideDocument(html, index, height), [html, index, height])
  const scale = width / WIDTH
  return (
    <div className="pv-frame" style={{ width, height: Math.round(height * scale) }}>
      <iframe
        title={title}
        sandbox=""
        srcDoc={doc}
        loading="lazy"
        style={{ width: WIDTH, height, transform: `scale(${scale})` }}
      />
    </div>
  )
}
