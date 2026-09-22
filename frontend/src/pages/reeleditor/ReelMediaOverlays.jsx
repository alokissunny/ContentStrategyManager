import React, { useEffect, useRef, useState } from 'react';

function Visual({ overlay, asset, time, playing }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || asset.kind !== 'video') return;
    const target = (overlay.sourceStart || 0) + time - overlay.start;
    if (Math.abs(video.currentTime - target) > .2) video.currentTime = Math.max(0, target);
    if (playing) video.play().catch(() => {}); else video.pause();
  }, [time, playing, overlay, asset.kind]);
  const style = overlay.mode === 'cutaway' ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#111' }
    : { position: 'absolute', left: `${overlay.position?.x ?? 72}%`, top: `${overlay.position?.y ?? 30}%`, width: `${overlay.width || 40}%`, maxHeight: '70%', objectFit: 'contain', transform: 'translate(-50%, -50%)', border: '3px solid white', borderRadius: 8 };
  if (failed) return <span role="status" style={style}>Could not load visual</span>;
  return asset.kind === 'video' ? <video ref={ref} src={asset.url} muted playsInline onLoadedMetadata={() => { if (ref.current) ref.current.currentTime = Math.max(0, (overlay.sourceStart || 0) + time - overlay.start); }} onError={() => setFailed(true)} style={style} /> : <img src={asset.url} alt={asset.name || 'Visual overlay'} style={style} onError={() => setFailed(true)} />;
}
export default function ReelMediaOverlays({ spec, time, playing }) {
  const assets = [...(spec?.sourceVisualAssets || []), ...(spec?.visualAssets || [])];
  return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>{(spec?.mediaOverlays || []).map((overlay, i) => {
    const asset = assets.find((a) => a.id === overlay.assetId);
    return asset && time >= overlay.start && time < overlay.end ? <Visual key={`${i}:${overlay.assetId}`} overlay={overlay} asset={asset} time={time} playing={playing} /> : null;
  })}</div>;
}
