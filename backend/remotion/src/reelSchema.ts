/**
 * Capture Reel timeline contract — what services/captureReelAgent.js hands the
 * CaptureReel composition. Frames, not seconds: the backend aligns every cut
 * and caption to the voice track before rendering.
 */
export type ReelScene = {
  from: number;
  durationInFrames: number;
  kind: 'image' | 'video';
  src: string;
  sourceStartSec?: number; // video trim-in
  volume?: number; // clip audio (0 = muted)
  motion: 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'none';
  transition: 'cut' | 'zoom' | 'whip' | 'slide' | 'flash';
  focusX?: number; // 0–100, object-position
  focusY?: number;
  kicker?: string;
  // the picture inside letterbox bands baked into a clip (fractions of the frame)
  crop?: { x: number; y: number; w: number; h: number };
};

export type ReelCaptionWord = { text: string; fromFrame: number; toFrame: number };
export type ReelCaption = { fromFrame: number; toFrame: number; words: ReelCaptionWord[] };

export type ReelSpec = {
  format: { width: number; height: number; fps: number; durationInFrames: number };
  brand: { accent: string; accentInk: string; headlineFont?: string; bodyFont?: string };
  hook?: { text: string; emphasis?: string; durationInFrames: number };
  scenes: ReelScene[];
  captions: ReelCaption[];
  cta?: { line: string; sub?: string; fromFrame: number; durationInFrames: number };
  audio?: { voiceoverSrc?: string; voiceVolume?: number; startFrame?: number };
};

const IMG = 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=1080';
export const sampleReel: ReelSpec = {
  format: { width: 1080, height: 1920, fps: 30, durationInFrames: 180 },
  brand: { accent: '#D7F24A', accentInk: '#111111', headlineFont: 'Montserrat', bodyFont: 'Inter' },
  hook: { text: 'Stunning kitchens start with dust', emphasis: 'dust', durationInFrames: 45 },
  scenes: [
    { from: 0, durationInFrames: 75, kind: 'image', src: IMG, motion: 'push-in', transition: 'cut' },
    { from: 75, durationInFrames: 105, kind: 'image', src: IMG, motion: 'pan-left', transition: 'zoom', kicker: 'Week 3' },
  ],
  captions: [
    { fromFrame: 48, toFrame: 90, words: [{ text: 'Planning', fromFrame: 48, toFrame: 66 }, { text: 'comes', fromFrame: 66, toFrame: 78 }, { text: 'first', fromFrame: 78, toFrame: 90 }] },
  ],
  cta: { line: 'Save this for your remodel', sub: 'Follow for more', fromFrame: 130, durationInFrames: 50 },
};
