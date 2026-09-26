import React, { useLayoutEffect, useRef, useState } from 'react';
import ReelVideo from './ReelVideo';
import ReelMediaOverlays from './ReelMediaOverlays';
import { ReelOverlay, VIDEO_BASE, zoomScale } from './reelOverlay';
import { reelBrandStyle, reelFontCss } from '../../lib/reelBrandKit';
import { getReelBackground } from './reelBackgrounds';

// One fixed design surface for preview, editing and export. Scaling the surface
// (rather than changing its layout) preserves wrapping and text placement.
export const SCENE_WIDTH = 300;
export const SCENE_HEIGHT = SCENE_WIDTH * 16 / 9;
export default function ReelScene({ videoRef, videoUrl, spec, time, playing = false, videoProps = {},
  screenRef, sceneRef, exporting = false, className = '', children, ...events }) {
  const wrapper = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / SCENE_WIDTH));
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const background = getReelBackground(spec?.background);
  return <div ref={(node) => { wrapper.current = node; if (screenRef) screenRef.current = node; }}
    className={`reel-phone__screen ${className}`} style={{ height: scale * SCENE_HEIGHT }} {...events}>
    <div ref={sceneRef} className={`reel-scene${spec?.brandKit ? ' reel-scene--branded' : ''}`} style={{ width: SCENE_WIDTH, height: SCENE_HEIGHT,
      transform: `scale(${scale})`, background: background.background,
      '--reel-accent': spec?.brand?.accent || spec?.strategy?.accent || undefined, ...reelBrandStyle(spec?.brandKit) }}>
      {spec?.brandKit?.fonts?.length > 0 && <style>{reelFontCss(spec.brandKit)}</style>}
      <div className="rl-video-layer">
        <ReelVideo exporting={exporting} videoRef={videoRef} background={background.id} mix={spec?.backgroundMix} src={videoUrl}
          className="rl-video" style={{ ...VIDEO_BASE, transform: `scale(${zoomScale(spec?.animations, time)})` }}
          playsInline preload="auto" {...videoProps} />
        {spec?.grade && <div className="rl-grade" />}
      </div>
      <ReelMediaOverlays spec={spec} time={time} playing={playing} />
      <ReelOverlay spec={spec} time={time} />
    </div>
    {children}
  </div>;
}
