import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { toBlob } from 'html-to-image';
import { reelFontCss, waitForReelFonts } from './reelBrandKit';

// Rasterize the real kit assets and font files once. The podcast renderer burns
// this transparent full-frame plate into the MP4 without substituting fonts.
export async function preparePodcastBranding({ kit, title, aspectRatio = '16:9', signal }) {
  if (!kit) return null;
  signal?.throwIfAborted();
  const width = aspectRatio === '9:16' ? 720 : 1280;
  const height = aspectRatio === '9:16' ? 1280 : 720;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    const corner = kit.logo?.position || 'top-left';
    const logoStyle = { position: 'absolute', width: '18%', height: '9%', objectFit: 'contain',
      [corner.includes('right') ? 'right' : 'left']: '4%', [corner.includes('bottom') ? 'bottom' : 'top']: '4%' };
    const bandTop = corner.includes('bottom');
    flushSync(() => root.render(<div data-podcast-brand-frame style={{ position: 'relative', width, height, background: 'transparent' }}>
      {kit.fonts?.length > 0 && <style>{reelFontCss(kit)}</style>}
      {kit.logo && <img src={kit.logo.url} crossOrigin="anonymous" alt="" style={logoStyle} />}
      <div style={{ position: 'absolute', left: '4%', right: '4%', [bandTop ? 'top' : 'bottom']: '4%', padding: '16px 22px',
        borderLeft: `8px solid ${kit.palette.accent}`, background: kit.palette.ground, color: kit.palette.fg, borderRadius: 8 }}>
        {kit.name && <div style={{ fontFamily: kit.typography.detail.stack, fontSize: 16, letterSpacing: '0.08em', marginBottom: 6 }}>{kit.name}</div>}
        <div style={{ fontFamily: kit.typography.headline.stack, fontSize: aspectRatio === '9:16' ? 26 : 30, fontWeight: 700,
          lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Podcast'}</div>
      </div>
    </div>));
    await waitForReelFonts(kit);
    for (const image of host.querySelectorAll('img')) {
      try { await image.decode(); } catch { throw new Error('Could not load your brand logo. Check Brand Kit and retry.'); }
    }
    signal?.throwIfAborted();
    const blob = await toBlob(host.firstElementChild, { width, height, pixelRatio: 1 });
    signal?.throwIfAborted();
    if (!blob) throw new Error('Could not prepare the podcast branding. Please retry.');
    return blob;
  } finally { root.unmount(); host.remove(); }
}
