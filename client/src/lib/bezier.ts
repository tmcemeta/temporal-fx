// TEMPORAL FX — Bezier Curve Utilities
// Cubic bezier evaluation for history weight curves and pixel weight curves.
// All four control points (P0, P1, P2, P3) are configurable.

import type { BezierCurve } from "./types";

/**
 * Evaluate a cubic bezier at parameter t (0..1).
 * Returns the Y value for a given X input using Newton-Raphson iteration.
 * Supports custom start (p0) and end (p3) points.
 */
export function evaluateBezier(curve: BezierCurve, x: number): number {
  const { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y } = curve;

  // Clamp input to the curve's x range
  if (x <= p0x) return p0y;
  if (x >= p3x) return p3y;

  // Normalize x to 0..1 range based on p0x and p3x
  const xRange = p3x - p0x;
  if (xRange < 1e-6) return (p0y + p3y) / 2; // Degenerate case

  const normalizedX = (x - p0x) / xRange;

  // Find t for given normalized x using Newton-Raphson
  // Control points need to be normalized too for x lookup
  const np1x = (p1x - p0x) / xRange;
  const np2x = (p2x - p0x) / xRange;

  let t = normalizedX;
  for (let i = 0; i < 8; i++) {
    const xAtT = cubicBezier1D(t, 0, np1x, np2x, 1);
    const dx = xAtT - normalizedX;
    if (Math.abs(dx) < 1e-6) break;
    const dxdt = cubicBezierDerivative1D(t, 0, np1x, np2x, 1);
    if (Math.abs(dxdt) < 1e-10) break;
    t -= dx / dxdt;
    t = Math.max(0, Math.min(1, t));
  }

  // Evaluate y at t using actual y values
  return cubicBezier1D(t, p0y, p1y, p2y, p3y);
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
 * Returns an array of weights for indices 0..N-1.
 * Samples are taken across the full x range (p0x to p3x).
 */
export function buildWeightLUT(curve: BezierCurve, n: number): Float32Array {
  const lut = new Float32Array(n);
  const { p0x, p3x } = curve;
  for (let i = 0; i < n; i++) {
    // Sample across the full 0..1 range, mapping to p0x..p3x
    const t = n <= 1 ? 0.5 : i / (n - 1);
    const x = p0x + t * (p3x - p0x);
    lut[i] = evaluateBezier(curve, x);
  }
  return lut;
}
