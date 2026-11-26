// The reel composition's media components in this app (vite.config.js
// `reelWebMedia` swaps backend/remotion/src/media.ts for this file):
// @remotion/media's <Audio>/<Video>, which both the Player preview and the
// in-browser renderer (@remotion/web-renderer) use. The server renderer keeps
// Remotion's classic <Audio>/<OffthreadVideo>.
//
// Loudness: the browser's mix comes out a steady +3 dB (×√2) over the server's
// for the same reel (measured 2026-11-26, every second of a 39 s voiceover
// reel). While lib/browserReelRender.js renders, it sets
// window.__reelRenderGain = 1/√2 and every volume here is scaled by it.
import React from 'react';
import { Audio as MediaAudio, Video as MediaVideo } from '@remotion/media';

const gain = () => (typeof window !== 'undefined' && Number(window.__reelRenderGain)) || 1;

function scaled(volume) {
  const g = gain();
  if (g === 1) return volume;
  if (typeof volume === 'function') return (f) => volume(f) * g;
  return (volume ?? 1) * g;
}

export const Audio = React.forwardRef((props, ref) => React.createElement(MediaAudio, { ...props, ref, volume: scaled(props.volume) }));
Audio.displayName = 'ReelAudio';

export const OffthreadVideo = React.forwardRef((props, ref) => React.createElement(MediaVideo, { ...props, ref, volume: scaled(props.volume) }));
OffthreadVideo.displayName = 'ReelVideo';
