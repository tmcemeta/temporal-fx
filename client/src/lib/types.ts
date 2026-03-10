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

// A bezier curve defined by two control points (P1 and P2).
// P0 = (0,0) and P3 = (1,1) are fixed endpoints.
// x/y values are normalized 0..1.
export interface BezierCurve {
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
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
}

export const DEFAULT_STATE: FXState = {
  historyDepth: 8,
  feedbackMix: 0.0,
  historyCurve: { p1x: 0.25, p1y: 0.75, p2x: 0.75, p2y: 0.25 },
  pixelWeightMode: "uniform",
  pixelWeightCurve: { p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67 },
  blendMode: "screen",
  blendStrength: 0.6,
  chromaticSpread: 0,
  excludeMaskFromEffect: false,
  maskCount: 1,
  debugView: 0,
  maskColors: [
    { r: 0.0, g: 1.0, b: 0.0 },  // green screen default
    { r: 0.0, g: 0.0, b: 1.0 },
    { r: 1.0, g: 0.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 1.0 },
  ],
};

export const PRESETS: Record<string, Partial<FXState>> = {
  "Light Leak": {
    historyDepth: 12,
    feedbackMix: 0.1,
    historyCurve: { p1x: 0.1, p1y: 0.9, p2x: 0.4, p2y: 0.6 },
    pixelWeightMode: "luminance",
    pixelWeightCurve: { p1x: 0.5, p1y: 0.0, p2x: 1.0, p2y: 0.5 },
    blendMode: "screen",
    blendStrength: 0.55,
    chromaticSpread: 1,
  },
  "Slow Shutter": {
    historyDepth: 20,
    feedbackMix: 0.0,
    historyCurve: { p1x: 0.25, p1y: 0.75, p2x: 0.75, p2y: 0.75 },
    pixelWeightMode: "uniform",
    pixelWeightCurve: { p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67 },
    blendMode: "average",
    blendStrength: 0.8,
    chromaticSpread: 0,
  },
  "Chromatic Ghost": {
    historyDepth: 6,
    feedbackMix: 0.2,
    historyCurve: { p1x: 0.0, p1y: 1.0, p2x: 0.5, p2y: 0.5 },
    pixelWeightMode: "motion",
    pixelWeightCurve: { p1x: 0.2, p1y: 0.0, p2x: 0.8, p2y: 1.0 },
    blendMode: "screen",
    blendStrength: 0.5,
    chromaticSpread: 4,
  },
  "Burn In": {
    historyDepth: 30,
    feedbackMix: 0.85,
    historyCurve: { p1x: 0.0, p1y: 1.0, p2x: 0.3, p2y: 0.9 },
    pixelWeightMode: "luminance",
    pixelWeightCurve: { p1x: 0.6, p1y: 0.0, p2x: 1.0, p2y: 0.8 },
    blendMode: "add",
    blendStrength: 0.4,
    chromaticSpread: 0,
  },
  "Memory Dissolve": {
    historyDepth: 40,
    feedbackMix: 0.0,
    historyCurve: { p1x: 0.8, p1y: 0.0, p2x: 1.0, p2y: 0.5 },
    pixelWeightMode: "uniform",
    pixelWeightCurve: { p1x: 0.33, p1y: 0.33, p2x: 0.67, p2y: 0.67 },
    blendMode: "average",
    blendStrength: 0.35,
    chromaticSpread: 2,
  },
  "Glitch Echo": {
    historyDepth: 4,
    feedbackMix: 0.9,
    historyCurve: { p1x: 0.5, p1y: 0.5, p2x: 0.5, p2y: 0.5 },
    pixelWeightMode: "motion",
    pixelWeightCurve: { p1x: 0.0, p1y: 0.0, p2x: 1.0, p2y: 1.0 },
    blendMode: "difference",
    blendStrength: 0.7,
    chromaticSpread: 3,
  },
};
