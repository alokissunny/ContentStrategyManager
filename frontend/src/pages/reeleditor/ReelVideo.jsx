import React, { useEffect, useRef, useState } from 'react';

// Keep the video as the playback/audio clock. A transparent canvas holds only
// the person, letting the selected CSS background show through behind them.
export default function ReelVideo({ videoRef, background, src, style, ...videoProps }) {
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const enabled = background !== 'original';

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let segmenter;
    let raf = 0;
    let lastTime = -1;
    let lastFrameAt = -Infinity;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const maskCanvas = document.createElement('canvas');
    const maskContext = maskCanvas.getContext('2d');
    let maskImage;
    setStatus('loading');

    function draw(now) {
      if (disposed) return;
      // Cap inference at 24 fps, and do no work for unchanged paused frames.
      if (video.readyState >= 2 && !video.seeking && video.currentTime !== lastTime && now - lastFrameAt >= 1000 / 24) {
        try {
          const width = Math.max(1, Math.round(video.videoWidth * Math.min(1, 720 / video.videoHeight)));
          const height = Math.max(1, Math.round(video.videoHeight * Math.min(1, 720 / video.videoHeight)));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          segmenter.segmentForVideo(video, now, (result) => {
            // The pinned selfie model has a single confidence mask: person.
            const mask = result.confidenceMasks?.[0];
            if (!mask) throw new Error('Person mask unavailable');
            if (!maskImage || maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
              maskCanvas.width = mask.width;
              maskCanvas.height = mask.height;
              maskImage = maskContext.createImageData(mask.width, mask.height);
            }
            const confidence = mask.getAsFloat32Array();
            for (let i = 0; i < confidence.length; i += 1) {
              // Soft edges preserve hair while suppressing low-confidence room pixels.
              const alpha = Math.max(0, Math.min(1, (confidence[i] - 0.2) / 0.6));
              maskImage.data[i * 4 + 3] = Math.round(alpha * alpha * (3 - 2 * alpha) * 255);
            }
            maskContext.putImageData(maskImage, 0, 0);
            context.globalCompositeOperation = 'source-over';
            context.clearRect(0, 0, width, height);
            context.drawImage(video, 0, 0, width, height);
            context.globalCompositeOperation = 'destination-in';
            context.drawImage(maskCanvas, 0, 0, width, height);
            context.globalCompositeOperation = 'source-over';
          });
          lastTime = video.currentTime;
          lastFrameAt = now;
          setStatus((previous) => previous === 'ready' ? previous : 'ready');
        } catch {
          setStatus('error');
          segmenter?.close();
          segmenter = null;
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    }

    import('../../lib/personSegmentation').then(({ createPersonSegmenter }) => createPersonSegmenter()).then((instance) => {
      if (disposed) { instance.close(); return; }
      segmenter = instance;
      if (!context || !maskContext) throw new Error('Canvas unavailable');
      raf = requestAnimationFrame(draw);
    }).catch(() => {
      if (!disposed) setStatus('error');
      segmenter?.close();
      segmenter = null;
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      segmenter?.close();
    };
  }, [enabled, src, attempt, videoRef]);

  const ready = enabled && status === 'ready';
  return (
    <>
      <video {...videoProps} ref={videoRef} src={src} style={{ ...style, opacity: ready ? 0 : 1 }} />
      {enabled && <canvas ref={canvasRef} className="rl-person" style={{ ...style, visibility: ready ? 'visible' : 'hidden' }} aria-hidden="true" />}
      {enabled && status !== 'ready' && (
        <div className="rl-background-status" role="status" onClick={(event) => event.stopPropagation()}>
          {status === 'error' ? <>Could not apply background. Showing original. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></> : 'Preparing virtual background…'}
        </div>
      )}
    </>
  );
}
