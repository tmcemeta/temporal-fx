// TEMPORAL FX — Bezier Curve Utilities
// Cubic bezier evaluation for history weight curves and pixel weight curves.
// Uses the standard CSS cubic-bezier convention: P0=(0,0), P3=(1,1) fixed.

import type { BezierCurve } from "./types";

/**
 * Evaluate a cubic bezier at parameter t (0..1).
 * Returns the Y value for a given X input using Newton-Raphson iteration.
 */
export function evaluateBezier(curve: BezierCurve, x: number): number {
  const { p1x, p1y, p2x, p2y } = curve;

  // Clamp input
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Find t for given x using Newton-Raphson
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xAtT = cubicBezier1D(t, 0, p1x, p2x, 1);
    const dx = xAtT - x;
    if (Math.abs(dx) < 1e-6) break;
    const dxdt = cubicBezierDerivative1D(t, 0, p1x, p2x, 1);
    if (Math.abs(dxdt) < 1e-10) break;
    t -= dx / dxdt;
    t = Math.max(0, Math.min(1, t));
  }

  return cubicBezier1D(t, 0, p1y, p2y, 1);
}

function cubicBezier1D(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicBezierDerivative1D(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/**
 * Build a lookup table of N samples from the bezier curve.
 * Returns an array of weights (0..1) for indices 0..N-1.
 */
export function buildWeightLUT(curve: BezierCurve, n: number): Float32Array {
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = n <= 1 ? 0.5 : i / (n - 1);
    lut[i] = evaluateBezier(curve, x);
  }
  return lut;
}
