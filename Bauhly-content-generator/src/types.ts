// Shared domain types for the multi-agent Instagram content generator.

export type IGFormat = "post" | "carousel" | "reel" | "video" | "montage";

export type AssetKind = "image" | "video";

export type AspectRatio = "1:1" | "4:5" | "9:16";

export type CropStrategy = "center" | "attention" | "entropy";

export type OverlayPosition = "top" | "center" | "bottom";

/** Curated caption font families that resolve to real fonts on the host. */
export type CaptionFont =
  | "modern-sans"
  | "bold-impact"
  | "elegant-serif"
  | "editorial-serif"
  | "clean-rounded";

/** How captions/overlays should look — chosen by the Strategy Agent per brand. */
export interface CaptionStyle {
  font: CaptionFont;
  weight: "regular" | "bold";
  /** Sentence case vs ALL CAPS for headline/hook text. */
  case: "normal" | "upper";
  /** Text colour, hex. */
  textColor: string;
  /** Legibility treatment behind the text. */
  background: "scrim" | "box" | "none";
}

export interface BrandKit {
  /** Dominant brand colour, hex. */
  primaryColor: string;
  /** Secondary/support colour, hex. */
  secondaryColor: string;
  /** Accent colour for highlights, hex. */
  accentColor: string;
  /** Colour to render overlay text in, hex. */
  textColor: string;
  /** One or two words describing the visual mood, e.g. "warm minimal". */
  mood: string;
}

/** Structured brief produced by the Strategy Agent from the user's prose. */
export interface StrategyBrief {
  brandName: string;
  audience: string;
  tone: string;
  contentPillars: string[];
  hashtags: string[];
  cta: string;
  brandKit: BrandKit;
  captionStyle: CaptionStyle;
}

export interface OverlayText {
  headline: string;
  subtext: string;
  position: OverlayPosition;
}

/** How the Editor Agent should render one image (one post / one carousel slide / a reel cover). */
export interface SlidePlan {
  /** Filename of the source asset to use (must be one of the provided assets). */
  assetFile: string;
  aspectRatio: AspectRatio;
  /** Role of this slide in the piece, e.g. "hook", "slide 2", "cover". */
  role: string;
  crop: CropStrategy;
  adjustments: {
    /** 0.5..1.5, 1 = unchanged */
    brightness: number;
    /** 0..2, 1 = unchanged */
    saturation: number;
    /** 0.5..1.5, 1 = unchanged */
    contrast: number;
    /** -100..100, negative = cooler, positive = warmer */
    warmth: number;
  };
  /** Optional text baked onto the image. Omit for clean photo slides. */
  overlay?: OverlayText;
}

/** One kept slice of the source video, on the ORIGINAL timeline. */
export interface VideoSegment {
  startSec: number;
  endSec: number;
  /** Playback speed, 0.5..2 (1 = normal). */
  speed: number;
  /** Why this moment was kept (internal note). */
  label: string;
}

/** A text overlay timed against the FINAL edited timeline. */
export interface VideoOverlay {
  text: string;
  atSec: number;
  durationSec: number;
  position: OverlayPosition;
}

/** How the Video Director Agent wants the uploaded clip cut into viral content. */
export interface VideoEditPlan {
  /** Source video filename (must be one of the provided assets). */
  sourceFile: string;
  concept: string;
  targetAspect: AspectRatio;
  targetDurationSec: number;
  /** Big hook line shown in the first ~2.5s. */
  hook: string;
  /** Suggested music/energy mood (informational for now). */
  musicMood: string;
  segments: VideoSegment[];
  overlays: VideoOverlay[];
}

/** One segment of a montage, drawn from a video clip OR a photo. */
export interface MontageSegment {
  /** Source asset filename (a video or a photo from the pool). */
  sourceFile: string;
  kind: "video" | "photo";
  /** For video sources: in/out point on the original clip. */
  startSec?: number;
  endSec?: number;
  /** For photo sources: how long the still is shown (seconds). */
  durationSec?: number;
  /** For video sources: playback speed 0.5..2. */
  speed?: number;
  label: string;
}

/** A single combined video stitched from many videos + photos. */
export interface MontagePlan {
  concept: string;
  targetAspect: AspectRatio;
  targetDurationSec: number;
  hook: string;
  musicMood: string;
  segments: MontageSegment[];
  overlays: VideoOverlay[];
}

/** A single content piece planned by the Creative Director / Video Director. */
export interface PiecePlan {
  format: IGFormat;
  /** Internal working title. */
  title: string;
  /** One-line description of the creative concept. */
  concept: string;
  /** Viral on-screen hook (from the Hook Agent), baked into the final output. */
  hook?: string;
  /** Present for image pieces (post/carousel/reel). */
  slides?: SlidePlan[];
  /** Present for single-source video pieces. */
  videoPlan?: VideoEditPlan;
  /** Present for a montage piece (many videos + photos → one video). */
  montagePlan?: MontagePlan;
}

/** Caption copy produced by the Copywriter Agent for one piece. */
export interface Caption {
  hook: string;
  body: string;
  hashtags: string[];
  cta: string;
}

/** Fully rendered piece with paths to the generated media and its caption. */
export interface RenderedPiece {
  plan: PiecePlan;
  caption: Caption;
  /** Output image paths (relative to the output dir), in slide order. Empty for video pieces. */
  images: string[];
  /** Output video path (relative), for video pieces. */
  video?: string;
  /** Poster/cover image (relative) for a video piece. */
  cover?: string;
}

export interface UsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface QAPieceVerdict {
  format: IGFormat;
  title: string;
  action: "pass" | "edit" | "regenerate";
  score: number;
  issues: string[];
}

export interface QASummary {
  reviewed: number;
  edited: number;
  regenerated: number;
  averageScore: number;
  pieces: QAPieceVerdict[];
}

export interface ContentPlan {
  strategyInput: string;
  brief: StrategyBrief;
  pieces: RenderedPiece[];
  generatedAt: string;
  engine: "claude" | "mock";
  model: string;
  usage: UsageSummary;
  qa?: QASummary;
  /** New photos generated to fill strategy gaps in the uploads. */
  generatedAssets: GeneratedAsset[];
}

export interface AssetInfo {
  file: string;
  absPath: string;
  mediaType: string;
  width: number;
  height: number;
  kind: AssetKind;
  /** For video assets: duration in seconds. */
  durationSec?: number;
  /** For video assets: whether an audio stream is present. */
  hasAudio?: boolean;
  /** True if this asset was generated by the Asset Planner, not uploaded. */
  generated?: boolean;
}

/** A new photo the Asset Planner decided the strategy needs but the uploads lack. */
export interface AssetRequest {
  purpose: string;
  /** Text-to-image prompt for the generator. */
  prompt: string;
  aspectRatio: AspectRatio;
  style: string;
}

/** Record of a generated asset for the content plan. */
export interface GeneratedAsset {
  file: string;
  purpose: string;
  prompt: string;
  provider: string;
}
