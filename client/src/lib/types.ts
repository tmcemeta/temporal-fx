// SIMPLE SUBJECT — Core Types
// Focused exclusively on subject extraction via mask-keyed compositing.

// RGB color as 0..1 floats
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

// View modes
// 0 = Normal composite (subject over background)
// 1 = Subject only (over transparency / black)
// 2 = Background only (no subject)
// 3 = Raw Input (show only one half of the hstack at a time; toggled separately)
export type ViewMode = 0 | 1 | 2 | 3;

// Normalized bounding box: all values in [0..1] UV space.
// x1 > x2 (or y1 > y2) means no subject was found for that color slot.
export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SubjectState {
  // How many mask color slots are active (1..5)
  maskCount: number;

  // Up to 5 mask key colors
  maskColors: RGBColor[];

  // Edge softness: controls the color-distance falloff in the keying shader.
  // Maps to the upper bound of smoothstep(0, edgeSoftness, maskDiff).
  // Lower = harder edge, higher = softer/more tolerant edge.
  // Range: 0.1..2.0
  edgeSoftness: number;

  // Minimum luma threshold: mask pixels below this brightness are ignored.
  // Prevents dark/black areas from being treated as mask.
  // Range: 0..0.5
  minLuma: number;

  // Spill suppression: desaturates pixels near the mask color boundary
  // to reduce color spill on subject edges.
  spillSuppression: boolean;

  // Spill suppression strength (0..1), only used when spillSuppression is true
  spillStrength: number;

  // Current view mode
  viewMode: ViewMode;

  // Whether the input is hstack-encoded (base | mask side-by-side)
  isHstack: boolean;

  // For Raw Input view: which half to show (true = base/left, false = mask/right)
  rawInputShowBase: boolean;

  // Bounding box overlay toggle
  showBbox: boolean;

  // Number of grid samples per axis for bbox computation (10..100)
  // Total samples = (bboxSamples+1)^2; recompiles the bbox shader on change.
  bboxSamples: number;
}

export const DEFAULT_STATE: SubjectState = {
  maskCount: 1,
  maskColors: [
    { r: 0.0, g: 1.0, b: 0.0 },  // green screen default
    { r: 0.0, g: 0.0, b: 1.0 },
    { r: 1.0, g: 0.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 0.0 },
    { r: 1.0, g: 1.0, b: 1.0 },
  ],
  edgeSoftness: 0.5,
  minLuma: 0.15,
  spillSuppression: false,
  spillStrength: 0.5,
  viewMode: 0,
  isHstack: true,
  rawInputShowBase: true,
  showBbox: false,
  bboxSamples: 50,
};
