/**
 * Rasterise carousel-agent slides and download them as a multi-page PDF.
 * Uses the same toSvg → canvas path as Week View publish (avoids hanging toBlob).
 */
import { toSvg } from 'html-to-image';
import { repairStrandedOffsets } from './layoutHtml';

const SLIDE_W = 1080;
const SLIDE_H = 1350;
const EXPORT_IMG_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rasterizeNode(node, { width, height, timeoutMs = 20000 } = {}) {
  const w = width || node.offsetWidth;
  const h = height || node.offsetHeight;
  if (!w || !h) return Promise.reject(new Error('Slide has no size to render.'));

  const restored = [];
  node.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || img.classList.contains('is-placeholder')) {
      restored.push([img, src]);
      img.setAttribute('src', EXPORT_IMG_PLACEHOLDER);
    }
  });
  const restoreImgs = () => {
    restored.forEach(([img, prev]) => {
      if (prev == null || prev === '') img.removeAttribute('src');
      else img.setAttribute('src', prev);
    });
  };

  return toSvg(node, {
    cacheBust: true,
    skipFonts: true,
    width: w,
    height: h,
    imagePlaceholder: EXPORT_IMG_PLACEHOLDER,
  })
    .finally(restoreImgs)
    .then(
      (dataUrl) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          const timer = setTimeout(() => reject(new Error('Rendering the slide timed out.')), timeoutMs);
          img.onload = () => {
            clearTimeout(timer);
            try {
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              ctx.drawImage(img, 0, 0, w, h);
              canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the slide image.'))),
                'image/jpeg',
                0.92,
              );
            } catch (err) {
              reject(err);
            }
          };
          img.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Could not render the slide image.'));
          };
          img.src = dataUrl;
        }),
    );
}

function blobToUint8(blob) {
  return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/** Minimal PDF: one JPEG image per page at the image pixel size (no extra deps). */
function buildPdfFromJpegs(pages) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];

  const push = (chunk) => {
    if (typeof chunk === 'string') parts.push(enc.encode(chunk));
    else parts.push(chunk);
  };
  const byteLength = () => parts.reduce((n, p) => n + p.length, 0);
  const beginObj = (id) => {
    offsets[id] = byteLength();
    push(`${id} 0 obj\n`);
  };
  const endObj = () => push('endobj\n');

  // Object plan:
  // 1 = Catalog
  // 2 = Pages
  // then per page: Image, Content, Page  (3 objects each)
  const pageCount = pages.length;
  const pageObjIds = [];
  let nextId = 3;
  const pageSpecs = pages.map((page) => {
    const imageId = nextId;
    nextId += 1;
    const contentId = nextId;
    nextId += 1;
    const pageId = nextId;
    nextId += 1;
    pageObjIds.push(pageId);
    return { page, imageId, contentId, pageId };
  });

  push('%PDF-1.4\n');

  beginObj(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  endObj();

  beginObj(2);
  push(`<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\n`);
  endObj();

  pageSpecs.forEach(({ page, imageId, contentId, pageId }) => {
    beginObj(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push('\nendstream\n');
    endObj();

    const ops = `q ${page.width} 0 0 ${page.height} 0 0 cm /Im0 Do Q\n`;
    const opsBytes = enc.encode(ops);
    beginObj(contentId);
    push(`<< /Length ${opsBytes.length} >>\nstream\n`);
    push(ops);
    push('endstream\n');
    endObj();

    beginObj(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>\n`,
    );
    endObj();
  });

  const xrefStart = byteLength();
  const size = nextId;
  push(`xref\n0 ${size}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < size; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\n`);
  push(`startxref\n${xrefStart}\n%%EOF\n`);

  const total = byteLength();
  const out = new Uint8Array(total);
  let at = 0;
  parts.forEach((p) => {
    out.set(p, at);
    at += p.length;
  });
  return out;
}

async function mountDocument(html) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.cssText = 'position:fixed;left:-12000px;top:0;width:1200px;height:8000px;opacity:0;pointer-events:none;border:0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  repairStrandedOffsets(doc);
  await wait(80);
  if (doc.fonts?.ready) {
    try { await Promise.race([doc.fonts.ready, wait(1500)]); } catch { /* ignore */ }
  }
  await wait(40);
  return {
    iframe,
    doc,
    dispose: () => { try { iframe.remove(); } catch { /* ignore */ } },
  };
}

function slideShell(innerHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;background:#fff}
body>.slide,body>article{width:100%;height:100%;box-sizing:border-box;aspect-ratio:auto!important}
img[data-slot="image"]{display:block;object-fit:cover;
background:repeating-linear-gradient(135deg,transparent 0 7px,rgba(27,16,13,.12) 7px 14px),#ddd8ce}
</style></head><body>${innerHtml}</body></html>`;
}

async function jpegPagesFromDocument(documentHtml) {
  const { doc, dispose } = await mountDocument(documentHtml);
  try {
    const nodes = [...doc.querySelectorAll('article.slide, article[data-index], .slide')]
      .filter((el) => el && el.tagName !== 'SECTION');
    if (!nodes.length) throw new Error('No slides found in the carousel document.');
    const pages = [];
    for (const node of nodes) {
      node.style.width = `${SLIDE_W}px`;
      node.style.height = `${SLIDE_H}px`;
      node.style.maxWidth = `${SLIDE_W}px`;
      node.style.aspectRatio = 'auto';
      void node.offsetWidth;
      const blob = await rasterizeNode(node, { width: SLIDE_W, height: SLIDE_H });
      pages.push({ jpeg: await blobToUint8(blob), width: SLIDE_W, height: SLIDE_H });
    }
    return pages;
  } finally {
    dispose();
  }
}

async function jpegPagesFromSlideHtml(slides) {
  const pages = [];
  for (const html of slides) {
    const { doc, dispose } = await mountDocument(slideShell(html));
    try {
      const node = doc.querySelector('article.slide, article, .slide, body > *') || doc.body.firstElementChild;
      if (!node) throw new Error('Could not find a slide to render.');
      node.style.width = `${SLIDE_W}px`;
      node.style.height = `${SLIDE_H}px`;
      void node.offsetWidth;
      const blob = await rasterizeNode(node, { width: SLIDE_W, height: SLIDE_H });
      pages.push({ jpeg: await blobToUint8(blob), width: SLIDE_W, height: SLIDE_H });
    } finally {
      dispose();
    }
  }
  return pages;
}

function triggerDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Download a PDF of the carousel preview (one page per slide).
 * Prefer full agent `documentHtml` when present; else per-slide HTML fragments.
 */
export async function downloadCarouselPreviewPdf({
  documentHtml = '',
  slides = [],
  filename = 'carousel-preview.pdf',
} = {}) {
  const pages = documentHtml
    ? await jpegPagesFromDocument(documentHtml)
    : await jpegPagesFromSlideHtml(slides);
  if (!pages.length) throw new Error('Nothing to export.');
  const pdf = buildPdfFromJpegs(pages);
  triggerDownload(pdf, filename);
  return pages.length;
}
