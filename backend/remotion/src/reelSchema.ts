/**
 * Capture Reel timeline contract — what services/captureReelAgent.js hands the
 * CaptureReel composition. Frames, not seconds: the backend aligns every cut
 * and caption to the voice track before rendering.
 */
export type ReelLook = {
  overlay: 'serif-stack' | 'serif-center' | 'serif-accent' | 'two-weight' | 'bold-sans' | 'pill' | 'none';
  hook: 'stack-repeat' | 'serif-center' | 'listicle' | 'two-weight' | 'slam' | 'title';
  captions: 'subtitle' | 'two-weight' | 'karaoke' | 'narrative' | 'twovoice' | 'none';
  font: 'condensed-serif' | 'serif' | 'serif-italic' | 'sans' | 'sans-bold';
  textCase: 'upper' | 'lower' | 'sentence';
  captionCase?: 'lower' | 'sentence';
  color: string;
  captionColor?: string;
  position: 'top' | 'center' | 'lower';
  grade: 'warm' | 'neutral' | 'bright' | 'cool' | 'clean' | 'moody';
  endCard: 'card' | 'text-on-shot' | 'none';
  progress: boolean;
  kinetic?: boolean; // overlay words pop in one by one
};

export type ReelAnnotation = {
  type: 'circle' | 'arrow' | 'label' | 'spotlight' | 'zoom' | 'measure';
  text?: string;
  atFrame: number; // from the start of its shot
  box: { x: number; y: number; w: number; h: number }; // % of the image
  point: { x: number; y: number };
  point2?: { x: number; y: number }; // measure: the second end
};

export type ReelScene = {
  from: number;
  durationInFrames: number;
  kind: 'image' | 'video' | 'card';
  src: string;
  sourceStartSec?: number; // video trim-in
  volume?: number; // clip audio (0 = muted)
  motion: 'push-in' | 'pull-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'none';
  transition: 'cut' | 'zoom' | 'whip' | 'slide' | 'flash' | 'soft' | 'fade' | 'dissolve';
  // J-cut: the scene's sound starts this many frames before its picture (the picture stays hidden until then)
  revealFrames?: number;
  // punch-ins: frames (from the scene start) where the framing steps tighter / back (a cut-in on the same shot)
  punches?: number[];
  focusX?: number; // 0–100, object-position
  focusY?: number;
  kicker?: string;
  overlayText?: string; // styled reels: the words on this shot
  textY?: number; // 0–1: where the words sit (the default director places them)
  cardNumber?: number; // kind 'card': numbered chapter card
  cardTitle?: string;
  playbackRate?: number;
  zoom?: number; // fixed punch-in (1 = none, 1.15 medium, 1.3 close) — talking-head framing
  graded?: boolean; // the style's colour grade is already baked into src
  annotations?: ReelAnnotation[]; // teaser overlays anchored on the photo
  srcW?: number; // the photo's size (maps anchors through the cover crop)
  srcH?: number;
  beforeSrc?: string; // before → after wipe
  speaker?: boolean; // talking reels: the person speaking (the base layer)
  layout?: 'split'; // a cutaway on the top half while the speaker stays below
  exit?: 'fade'; // talking reels: an insert fades back to the speaker instead of cutting
  // a landscape shot shown WHOLE: full width, its own aspect, centred on a blurred still backdrop (never cropped to 9:16)
  frame?: { aspect: number; backdrop?: string };
  card?: { verdict: 'good' | 'bad'; title: string }; // motion agent: the photo as a ✓/✗ explainer card
  explainer?: ReelExplainer; // explainer agent: an animated line drawing (explainers.tsx)
  // the picture inside letterbox bands baked into a clip (fractions of the frame)
  crop?: { x: number; y: number; w: number; h: number };
};

export type ReelExplainer = {
  scene: 'measure' | 'light' | 'compare' | 'flow' | 'checklist' | 'open_plan' | 'stat';
  verdict: 'good' | 'bad' | 'none';
  title: string;
  subject?: string;
  figure?: 'standing' | 'seated' | 'foot' | 'none';
  dimension?: 'height' | 'depth' | 'gap' | 'width' | 'none';
  value?: string;
  dimension2?: 'height' | 'depth' | 'gap' | 'width' | 'none';
  value2?: string;
  label?: string;
  items?: { text: string; value: string; verdict: 'good' | 'bad' | 'none'; atSec?: number; icon?: string }[]; // atSec: when the item is said; icon: what it pictures
  resume?: boolean; // a long list split by the backend: this card returns after footage (header already shown)
};

export type ReelCaptionWord = { text: string; fromFrame: number; toFrame: number; em?: boolean };
export type ReelCaption = {
  fromFrame: number; toFrame: number; words: ReelCaptionWord[];
  // two-voice captions (caption agent): the key word's index, its face, where the caption sits
  key?: number; keyStyle?: 'strong' | 'soft' | 'spaced' | 'condensed' | 'serif' | 'none'; pos?: 'top' | 'lower' | 'center';
  // contrast (measured on the picture behind it): the words' ink, a soft scrim, the key word's Brand Kit colour
  ink?: string; scrim?: 'dark' | 'light'; keyColor?: string; keyBg?: string; onCard?: boolean; posY?: number; // posY: explicit centre (% of height) — the free band beside a framed shot // keyBg: the brand colour as a marker behind the key word
};

// Motion graphic reel (backend services/motionReelPlanner.js → MotionReel.tsx)
export type MotionMedia = {
  src: string;
  w: number;
  h: number;
  focal?: { x: number; y: number; w: number; h: number }; // % of the picture
  swatches?: { hex: string; share: number }[];
  video?: string; // a clip still: the clip itself, played muted from videoStart (s)
  videoStart?: number;
};
export type MotionAccent = {
  kind: 'fact_captions' | 'stat_badge' | 'hotspot_tags' | 'palette_strip' | 'poll_sticker';
  items?: string[];
  text?: string;
  productIds?: string[];
  question?: string;
};
export type MotionSegment = {
  type: 'intro' | 'main' | 'outro';
  formatId: string;
  from: number;
  durationInFrames: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: Record<string, any>;
  accents: MotionAccent[];
};
export type MotionTimeline = {
  segments: MotionSegment[];
  media: Record<string, MotionMedia>;
  products: Record<string, { name: string; price: string; assetId: string; point: { x: number; y: number } }>;
  coverFrame: number;
};

export type ReelSpec = {
  format: { width: number; height: number; fps: number; durationInFrames: number };
  brand: { accent: string; accentInk: string; headlineFont?: string; bodyFont?: string; ground?: string; fg?: string; fonts?: import('./brandFonts').BrandFonts; palette?: import('./brandPalette').BrandPalette };
  hook?: { text: string; emphasis?: string; durationInFrames: number; ink?: string; scrim?: 'dark' | 'light' };
  scenes: ReelScene[];
  captions: ReelCaption[];
  cta?: { line: string; sub?: string; fromFrame: number; durationInFrames: number };
  audio?: {
    voiceoverSrc?: string; voiceVolume?: number; startFrame?: number; musicSrc?: string; musicVolume?: number; sfx?: boolean;
    // a voiceover with on-camera moments: the voice track plays in stretches around them
    voiceSegments?: { fromFrame: number; trimBeforeFrames: number; durationInFrames: number }[];
    // the music dips under on-camera speech
    duck?: { fromFrame: number; toFrame: number }[];
  };
  look?: ReelLook; // set = a reel style (reelLook.tsx); unset = the default look
  chapters?: { text: string; fromFrame: number; durationInFrames: number; ink?: string; scrim?: 'dark' | 'light' }[]; // chapter title cards
  motion?: MotionTimeline; // set = a motion graphic reel (MotionReel.tsx)
  postGrain?: boolean; // grain added by ffmpeg after the render instead of drawn in every frame
  // the default (photo) look with the talking-reel caption agent's captions: key word, Brand Kit faces,
  // measured contrast, rise+fade motion (narrative.tsx TwoVoiceCaptions) instead of the karaoke chunks
  captionStyle?: 'twovoice';
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
