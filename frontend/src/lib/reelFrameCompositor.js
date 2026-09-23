import { toSvg } from 'html-to-image';
import { zoomScale } from '../pages/reeleditor/reelOverlay';

const WIDTH = 720, HEIGHT = 1280;
// Limit snapshots to properties used by the shared reel scene. Copying every
// browser CSS property onto every word is expensive and bloats each SVG frame.
const SCENE_STYLE_PROPERTIES = `
  display position inset top right bottom left z-index box-sizing
  width height min-width min-height max-width max-height aspect-ratio
  margin margin-top margin-right margin-bottom margin-left
  padding padding-top padding-right padding-bottom padding-left
  overflow overflow-x overflow-y visibility opacity isolation
  background background-color background-image background-size background-position background-repeat
  border border-top border-right border-bottom border-left border-radius
  border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
  box-shadow color font font-family font-size font-style font-weight font-stretch
  font-variant font-feature-settings font-kerning font-variation-settings
  line-height letter-spacing word-spacing white-space word-break overflow-wrap
  text-align text-transform text-decoration text-indent text-shadow text-overflow
  -webkit-text-stroke -webkit-text-fill-color -webkit-font-smoothing
  vertical-align flex flex-direction flex-wrap flex-grow flex-shrink flex-basis
  align-items align-self align-content justify-content justify-items justify-self
  gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row
  transform transform-origin transform-box filter backdrop-filter mix-blend-mode
  object-fit object-position clip-path animation animation-name animation-duration
  animation-timing-function animation-delay animation-iteration-count animation-direction
  animation-fill-mode animation-play-state content
`.trim().split(/\s+/);
const SVG_OPTIONS = { width: 300, height: 300 * 16 / 9, pixelRatio: 1, includeStyleProperties: SCENE_STYLE_PROPERTIES };

// Decode immediately rather than waiting for a display refresh as toCanvas does.
// Export frames run on an offline clock, independently of the screen refresh rate.
async function snapshot(node, options) {
  const image = new Image();
  image.src = await toSvg(node, { ...SVG_OPTIONS, ...options });
  await image.decode();
  return image;
}

function drawCover(context, source, scale) {
  const width = source.videoWidth || source.width;
  const height = source.videoHeight || source.height;
  const fit = Math.max(WIDTH / width, HEIGHT / height) * scale;
  const w = width * fit, h = height * fit;
  context.drawImage(source, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

export async function createReelFrameCompositor(scene, spec, fontEmbedCSS) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  const options = { fontEmbedCSS, style: { transform: 'none' } };
  // Background and colour grade never change during an export.
  const background = await snapshot(scene, { ...options, filter: () => false });
  const gradeNode = scene.querySelector('.rl-grade');
  const grade = gradeNode ? await snapshot(gradeNode, { ...options, style: { mixBlendMode: 'normal' } }) : null;
  let textKey, textImage, mediaKey, mediaImage;
  const pixelCanvas = document.createElement('canvas');
  const pixelContext = pixelCanvas.getContext('2d');

  return async (time) => {
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(background, 0, 0, WIDTH, HEIGHT);
    // Feed decoded video/person pixels straight into the encoder's canvas.
    // No per-frame video -> PNG -> DOM image -> SVG -> image round trip.
    const person = scene.querySelector('.rl-person');
    drawCover(context, person || scene.querySelector('.rl-video'), zoomScale(spec.animations, time));
    if (grade) {
      context.globalCompositeOperation = 'multiply';
      context.drawImage(grade, 0, 0, WIDTH, HEIGHT);
      context.globalCompositeOperation = 'source-over';
    }
    const media = scene.querySelector('[data-reel-media]');
    if (media?.childElementCount) {
      const videos = [...media.querySelectorAll('video')];
      const key = media.innerHTML;
      if (videos.length || key !== mediaKey) {
        const replacements = [];
        try {
          for (const video of videos) {
            if (pixelCanvas.width !== video.videoWidth || pixelCanvas.height !== video.videoHeight) {
              pixelCanvas.width = video.videoWidth; pixelCanvas.height = video.videoHeight;
            }
            pixelContext.drawImage(video, 0, 0);
            const image = new Image();
            image.src = pixelCanvas.toDataURL();
            image.style.cssText = video.style.cssText;
            await image.decode();
            video.after(image); replacements.push(image);
          }
          mediaImage = await snapshot(media, { ...options, filter: (node) => node.tagName !== 'VIDEO' });
          mediaKey = key;
        } finally { replacements.forEach((image) => image.remove()); }
      }
      context.drawImage(mediaImage, 0, 0, WIDTH, HEIGHT);
    }
    const overlay = scene.querySelector('.rl-overlay');
    const key = overlay.innerHTML;
    if (key !== textKey) {
      textImage = await snapshot(overlay, options);
      textKey = key;
    }
    context.drawImage(textImage, 0, 0, WIDTH, HEIGHT);
    return canvas;
  };
}
