// TEMPORAL FX — Core Types
// These types define the complete serializable state of the tool.
// The state can be saved/loaded as JSON.

export type BlendMode =
  | "screen"
  | "add"
  | "multiply"
  | "overlay"
  | "difference"
  | "average";

export type PixelWeightMode = "uniform" | "luminance" | "darkness" | "motion";

// A bezier curve defined by four control points (P0, P1, P2, P3).
// All x/y values are normalized 0..1.
// P0 and P3 can be moved for custom start/end positions.
export interface BezierCurve {
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
}

// RGB color as 0..1 floats
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface FXState {
  // Temporal
  historyDepth: number;        // 0..60 frames
  feedbackMix: number;         // 0=original, 1=processed
  historyCurve: BezierCurve;   // weight of each history frame

  // Pixel weight
  pixelWeightMode: PixelWeightMode;
  pixelWeightCurve: BezierCurve; // maps weight value -> contribution

  // Blend
  blendMode: BlendMode;
  blendStrength: number;       // 0..1
  chromaticSpread: number;     // 0..10 frames

  // Mask colors (5 slots)
  maskColors: RGBColor[];

  // When true, pixels inside the mask region are excluded from the temporal effect
  excludeMaskFromEffect: boolean;

  // How many mask color slots are active (1..5)
  maskCount: number;

// Debug view: 0=normal, 1=subject only, 2=background only
  debugView: 0 | 1 | 2;

  // Input format: true = side-by-side hstack (left=base, right=mask)
  isHstack: boolean;

  // Post-processing effects
  postFX: PostFXState;
}

// Bloom effect parameters
export interface BloomState {
  enabled: boolean;
  threshold: number;  // 0-1: luminance threshold for bright extraction
  intensity: number;  // 0-2: strength of bloom overlay
  radius: number;     // 1-20: blur radius in pixels
}

// Halation effect parameters (warm glow bleeding from bright areas, simulating old film)
export interface HalationState {
  enabled: boolean;
  threshold: number;  // 0-1: luminance threshold (typically lower than bloom ~0.5)
  intensity: number;  // 0-2: strength of halation overlay
  radius: number;     // 1-40: blur radius in pixels (larger than bloom for softer glow)
  tint: RGBColor;     // warm tint color (default: orange {r: 1.0, g: 0.4, b: 0.2})
}

// Soft Glow effect parameters (dreamy full-image blur + exposure boost)
export interface SoftGlowState {
  enabled: boolean;
  blurRadius: number;   // 4-40px: blur amount
  exposure: number;     // 0.5-2.0: brightness boost
  intensity: number;    // 0-2: blend strength
}

// Orton Effect parameters (final sandwich pass: blend FX result with sharp original)
export interface OrtonState {
  enabled: boolean;
  blendOpacity: number;     // 0-1: how much of the sharp original to blend in
  blendMode: 'screen' | 'softLight' | 'average';  // blend mode for combining
}

// Extensible post-processing state (add future effects here)
export interface PostFXState {
  bloom: BloomState;
  halation: HalationState;
  softGlow: SoftGlowState;
  orton: OrtonState;
}

export const DEFAULT_STATE: FXState = {
  historyDepth: 8,
  feedbackMix: 0.0,
  historyCurve: { p0x: 0, p0y: 0, p1x: 0.25, p1y: 0.75, p2x: 0.75, p2y: 0.25, p3x: 1, p3y: 1 },
  pixelWeightMode: "uniform",
  pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67, p3x: 1, p3y: 1 },
  blendMode: "screen",
  blendStrength: 0.6,
  chromaticSpread: 0,
  excludeMaskFromEffect: false,
  maskCount: 1,
  debugView: 0,
  isHstack: true,
  maskColors: [
    { r: 0.0, g: 1.0, b: 0.0 },  // green screen default
    { r: 0.0, g: 0.0, b: 1.0 },
    { r: 1.0, g: 0.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 1.0 },
  ],
  postFX: {
    bloom: {
      enabled: false,
      threshold: 0.7,
      intensity: 1.0,
      radius: 8,
    },
    halation: {
      enabled: false,
      threshold: 0.5,
      intensity: 0.8,
      radius: 16,
      tint: { r: 1.0, g: 0.4, b: 0.2 },
    },
    softGlow: {
      enabled: false,
      blurRadius: 16,
      exposure: 1.2,
      intensity: 0.6,
    },
    orton: {
      enabled: false,
      blendOpacity: 0.5,
      blendMode: 'screen',
    },
  },
};

export const PRESETS: Record<string, Partial<FXState>> = {
  "Light Leak": {
    historyDepth: 12,
    feedbackMix: 0.1,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.1, p1y: 0.9, p2x: 0.4, p2y: 0.6, p3x: 1, p3y: 1 },
    pixelWeightMode: "luminance",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.5, p1y: 0.0, p2x: 1.0, p2y: 0.5, p3x: 1, p3y: 1 },
    blendMode: "screen",
    blendStrength: 0.55,
    chromaticSpread: 1,
  },
  "Slow Shutter": {
    historyDepth: 20,
    feedbackMix: 0.0,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.25, p1y: 0.75, p2x: 0.75, p2y: 0.75, p3x: 1, p3y: 1 },
    pixelWeightMode: "uniform",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67, p3x: 1, p3y: 1 },
    blendMode: "average",
    blendStrength: 0.8,
    chromaticSpread: 0,
  },
  "Chromatic Ghost": {
    historyDepth: 6,
    feedbackMix: 0.2,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.0, p1y: 1.0, p2x: 0.5, p2y: 0.5, p3x: 1, p3y: 1 },
    pixelWeightMode: "motion",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.2, p1y: 0.0, p2x: 0.8, p2y: 1.0, p3x: 1, p3y: 1 },
    blendMode: "screen",
    blendStrength: 0.5,
    chromaticSpread: 4,
  },
  "Burn In": {
    historyDepth: 30,
    feedbackMix: 0.85,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.0, p1y: 1.0, p2x: 0.3, p2y: 0.9, p3x: 1, p3y: 1 },
    pixelWeightMode: "luminance",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.6, p1y: 0.0, p2x: 1.0, p2y: 0.8, p3x: 1, p3y: 1 },
    blendMode: "add",
    blendStrength: 0.4,
    chromaticSpread: 0,
  },
  "Memory Dissolve": {
    historyDepth: 40,
    feedbackMix: 0.0,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.8, p1y: 0.0, p2x: 1.0, p2y: 0.5, p3x: 1, p3y: 1 },
    pixelWeightMode: "uniform",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67, p3x: 1, p3y: 1 },
    blendMode: "average",
    blendStrength: 0.35,
    chromaticSpread: 2,
  },
  "Glitch Echo": {
    historyDepth: 4,
    feedbackMix: 0.9,
    historyCurve: { p0x: 0, p0y: 0, p1x: 0.5, p1y: 0.5, p2x: 0.5, p2y: 0.5, p3x: 1, p3y: 1 },
    pixelWeightMode: "motion",
    pixelWeightCurve: { p0x: 0, p0y: 0, p1x: 0.0, p1y: 0.0, p2x: 1.0, p2y: 1.0, p3x: 1, p3y: 1 },
    blendMode: "difference",
    blendStrength: 0.7,
    chromaticSpread: 3,
  },
};
