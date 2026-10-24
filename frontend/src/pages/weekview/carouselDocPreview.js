// The carousel agent's answer as a whole document, for the debug previews
// (AiDebugPanel › Preview and the post's Debug tab). Each slide is drawn from
// this document by DynamicLayout — its own <style>, font <link>s and every
// slide, at the same 1100px design width and 4:5 crop as the editor — never one
// article lifted out and drawn on its own.
import { mediaProxyUrl, isProjectMediaKey } from '../../api/media';

/**
 * @param {string} text  the agent's output (a full document or a bare <section>)
 * @returns {{ document: string, direction: string, slides: { index: number, before: string, after: string }[] } | null}
 */
export function carouselDocPreview(text) {
  const out = String(text || '').replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '');
  const docAt = out.search(/<!doctype html|<html[\s>]|<section\b[^>]*data-direction/i);
  if (docAt < 0 || !/<style\b/i.test(out)) return null;
  const end = out.toLowerCase().lastIndexOf('</html>');
  let document = end > docAt ? out.slice(docAt, end + 7) : out.slice(docAt);
  // a bare <section> (styles inside it) is still the whole carousel
  if (!/<html[\s>]/i.test(document)) document = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${document}</body></html>`;
  const articles = document.match(/<article\b[\s\S]*?<\/article>/gi) || [];
  if (!articles.length) return null;
  const direction = (document.match(/<section\b[^>]*data-direction\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  return {
    document,
    direction,
    slides: articles.map((a, i) => ({
      index: Number((a.match(/^<article\b[^>]*\sdata-index\s*=\s*["'](\d+)["']/i) || [])[1]) || i + 1,
      before: '',
      after: a,
    })),
  };
}

// The slide's pictures, resolved by asset key through the media proxy.
export function carouselSlideImageUrls(article) {
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

export function carouselSlideIndexOf(article, fallback) {
  const m = String(article || '').match(/^<article\b[^>]*\sdata-index\s*=\s*["'](\d+)["']/i);
  return m ? Number(m[1]) : fallback;
}
