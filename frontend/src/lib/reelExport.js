import { waitForReelFonts } from './reelBrandKit';
import { getFontEmbedCSS } from 'html-to-image';
import { createReelFrameCompositor } from './reelFrameCompositor';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export function checkAbort(signal) { signal?.throwIfAborted(); }
const delay = () => new Promise((resolve) => setTimeout(resolve, 12));
export async function waitFor(check, signal, message, timeout = 30000) {
  const started = performance.now();
  while (!check()) {
    checkAbort(signal);
    if (performance.now() - started > timeout) throw new Error(message);
    await delay();
  }
  checkAbort(signal);
}
export async function seekVideo(video, time, signal) {
  await waitFor(() => {
    if (video.error) throw new Error('Could not load a video used in this reel.');
    return video.readyState >= 2;
  }, signal, 'Video loading timed out. Please try again.');
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - .001));
  if (Math.abs(video.currentTime - target) <= .0001 && !video.seeking) return;
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      video.removeEventListener('seeked', ready);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Could not seek a reel video.'));
    const aborted = () => finish(signal.reason || new DOMException('Export cancelled', 'AbortError'));
    const timer = setTimeout(failed, 30000);
    video.addEventListener('seeked', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    try { checkAbort(signal); video.currentTime = target; } catch (error) { finish(error); }
  });
}

export async function renderReelVideo({ scene, video, spec, setTime, signal, onProgress }) {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame) throw new Error('MP4 export needs a browser with WebCodecs. Try an up-to-date Chrome or Edge browser.');
  const config = { codec: 'avc1.42001f', width: 720, height: 1280, bitrate: 5_000_000, framerate: 30, avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode H.264 MP4. Try Chrome or Edge on another device.');
  await waitForReelFonts(spec.brandKit);
  await document.fonts.ready;
  await seekVideo(video, 0, signal);
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 185) throw new Error('Export requires a reel up to 3 minutes long.');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: 720, height: 1280 }, fastStart: 'in-memory', firstTimestampBehavior: 'strict' });
  let failure;
  const encoder = new VideoEncoder({ output: (chunk, metadata) => {
    try { muxer.addVideoChunk(chunk, metadata); } catch (error) { failure = error; }
  }, error: (error) => { failure = error; } });
  encoder.configure(config);
  try {
    const fontEmbedCSS = await getFontEmbedCSS(scene);
    const captureFrame = await createReelFrameCompositor(scene, spec, fontEmbedCSS);
    const frames = Math.ceil(duration * 30);
    for (let index = 0; index < frames; index++) {
      checkAbort(signal);
      if (failure) throw failure;
      const time = index / 30;
      setTime(time); // caller uses flushSync so the DOM is updated before seeking
      await seekVideo(video, time, signal);
      const overlays = (spec.mediaOverlays || []).filter((o) => time >= o.start && time < o.end);
      for (const overlay of overlays) {
        const element = scene.querySelector(`[data-overlay-id="${(spec.mediaOverlays || []).indexOf(overlay)}"]`);
        if (!element) throw new Error('An overlay is missing. Re-add it before exporting.');
        const overlayVideo = element.matches('video') ? element : null;
        if (overlayVideo) await seekVideo(overlayVideo, (overlay.sourceStart || 0) + time - overlay.start, signal);
      }
      await waitFor(() => [...scene.querySelectorAll('img')].every((img) => {
        if (img.complete && !img.naturalWidth) throw new Error('An image could not be loaded. Re-add it before exporting.');
        return img.complete && img.naturalWidth;
      }), signal, 'An image used in the reel could not be loaded.');
      if (scene.querySelector('[data-media-error]')) throw new Error('A visual overlay could not be loaded. Re-add it before exporting.');
      const person = scene.querySelector('.rl-person');
      if (person) await waitFor(() => {
        if (person.dataset.backgroundStatus === 'error') throw new Error('The virtual background could not be rendered. Retry or choose Original.');
        return person.dataset.backgroundStatus === 'ready' && Math.abs(Number(person.dataset.frameTime) - video.currentTime) < .001;
      }, signal, 'Virtual background rendering timed out.', 60000);
      const canvas = await captureFrame(time);
      checkAbort(signal);
      const timestamp = Math.round(index * 1_000_000 / 30);
      const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(Math.min(duration, (index + 1) / 30) * 1_000_000) - timestamp });
      try { encoder.encode(frame, { keyFrame: index % 60 === 0 }); } finally { frame.close(); }
      if (encoder.encodeQueueSize > 8) await encoder.flush();
      onProgress((index + 1) / frames);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally { if (encoder.state !== 'closed') encoder.close(); }
}
