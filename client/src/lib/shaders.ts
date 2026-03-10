// TEMPORAL FX — WebGL Shader Source
// All rendering is done in WebGL2 for performance.
// The pipeline:
//   1. compositeShader: blends history frames onto current frame (temporal FX)
//   2. maskExtractShader: extracts subject from base video using mask video + color keys
//   3. overlayShader: composites extracted subject on top of the FX output

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ─── Temporal Composite Shader ───────────────────────────────────────────────
// Blends up to 60 history frames onto the current frame.
// Uniforms:
//   u_current      — current base video frame (texture)
//   u_history[i]   — history frame textures (up to MAX_HISTORY)
//   u_histWeights  — float array, weight for each history frame
//   u_numHistory   — int, actual number of history frames to use
//   u_blendMode    — int (0=screen,1=add,2=multiply,3=overlay,4=difference,5=average)
//   u_blendStrength — float 0..1
//   u_weightMode   — int (0=uniform,1=luminance,2=darkness,3=motion)
//   u_prevFrame    — previous frame for motion detection
//   u_chromR       — int, R channel history offset (frames)
//   u_chromB       — int, B channel history offset (frames)
//   u_chromG       — int, G channel history offset (0, no offset)

export const MAX_HISTORY = 60;

export const COMPOSITE_SHADER = `#version 300 es
precision highp float;

#define MAX_HISTORY ${MAX_HISTORY}

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_current;
uniform sampler2D u_history[MAX_HISTORY];
uniform float u_histWeights[MAX_HISTORY];
uniform int u_numHistory;
uniform int u_blendMode;
uniform float u_blendStrength;
uniform int u_weightMode;
uniform sampler2D u_prevFrame;
uniform int u_chromR;
uniform int u_chromB;
uniform float u_weightCurve[64]; // LUT for pixel weight curve
uniform int u_weightCurveLen;

vec3 blendScreen(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}
vec3 blendAdd(vec3 base, vec3 blend) {
  return clamp(base + blend, 0.0, 1.0);
}
vec3 blendMultiply(vec3 base, vec3 blend) {
  return base * blend;
}
vec3 blendOverlay(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend,
    1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
    step(0.5, base)
  );
}
vec3 blendDifference(vec3 base, vec3 blend) {
  return abs(base - blend);
}
vec3 blendAverage(vec3 base, vec3 blend) {
  return (base + blend) * 0.5;
}

float getLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float sampleWeightCurve(float t) {
  if (u_weightCurveLen <= 1) return t;
  float idx = t * float(u_weightCurveLen - 1);
  int i0 = int(idx);
  int i1 = min(i0 + 1, u_weightCurveLen - 1);
  float frac = idx - float(i0);
  return mix(u_weightCurve[i0], u_weightCurve[i1], frac);
}

float getPixelWeight(vec3 histPixel, float baseWeight) {
  if (u_weightMode == 0) return baseWeight; // uniform
  float luma = getLuma(histPixel);
  float rawVal = 0.0;
  if (u_weightMode == 1) rawVal = luma; // luminance
  else if (u_weightMode == 2) rawVal = 1.0 - luma; // darkness
  else rawVal = 1.0; // motion handled outside
  float curveVal = sampleWeightCurve(rawVal);
  return baseWeight * curveVal;
}

void main() {
  vec2 uv = v_texCoord;
  vec4 current = texture(u_current, uv);
  
  if (u_numHistory == 0 || u_blendStrength < 0.001) {
    fragColor = current;
    return;
  }

  // Motion weight: difference between current and prev frame
  float motionWeight = 1.0;
  if (u_weightMode == 3) {
    vec4 prev = texture(u_prevFrame, uv);
    vec3 diff = abs(current.rgb - prev.rgb);
    motionWeight = clamp(getLuma(diff) * 4.0, 0.0, 1.0);
    motionWeight = smoothstep(0.05, 0.5, motionWeight);
  }

  // Accumulate history
  vec3 accum = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < MAX_HISTORY; i++) {
    if (i >= u_numHistory) break;
    float hw = u_histWeights[i];
    if (hw < 0.001) continue;

    vec3 histColor = texture(u_history[i], uv).rgb;
    float pw = getPixelWeight(histColor, hw);
    if (u_weightMode == 3) pw *= motionWeight;

    accum += histColor * pw;
    totalWeight += pw;
  }

  if (totalWeight < 0.001) {
    fragColor = current;
    return;
  }

  // Normalize for average-style modes
  vec3 blended;
  if (u_blendMode == 5) { // average
    blended = accum / totalWeight;
  } else {
    accum = clamp(accum / max(totalWeight, 1.0), 0.0, 1.0);
    if (u_blendMode == 0) blended = blendScreen(current.rgb, accum);
    else if (u_blendMode == 1) blended = blendAdd(current.rgb, accum);
    else if (u_blendMode == 2) blended = blendMultiply(current.rgb, accum);
    else if (u_blendMode == 3) blended = blendOverlay(current.rgb, accum);
    else if (u_blendMode == 4) blended = blendDifference(current.rgb, accum);
    else blended = blendAverage(current.rgb, accum);
  }

  vec3 result = mix(current.rgb, blended, u_blendStrength);

  // Chromatic aberration: R and B channels sample from offset history frames
  float r = result.r;
  float g = result.g;
  float b = result.b;

  if (u_chromR > 0 && u_chromR < u_numHistory) {
    r = texture(u_history[u_chromR], uv).r;
    r = mix(result.r, r, u_blendStrength * 0.7);
  }
  if (u_chromB > 0 && u_chromB < u_numHistory) {
    b = texture(u_history[u_chromB], uv).b;
    b = mix(result.b, b, u_blendStrength * 0.7);
  }

  fragColor = vec4(r, g, b, current.a);
}
`;

// ─── Mask Extract + Subject Overlay Shader ───────────────────────────────────
// Extracts subject from base video using mask video color matching.
// Then composites subject over the FX-processed background.
export const OVERLAY_SHADER = `#version 300 es
precision highp float;

#define MAX_COLORS 5

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_fxOutput;    // temporal FX processed background
uniform sampler2D u_baseVideo;   // original base video
uniform sampler2D u_maskVideo;   // mask video
uniform bool u_hasMask;
uniform vec3 u_maskColors[MAX_COLORS];
uniform int u_numMaskColors;

vec4 unpremult(vec4 color) {
  if (color.a < 0.0001) return vec4(0.0);
  return vec4(clamp(color.rgb / color.a, vec3(0.0), vec3(1.0)), color.a);
}

void main() {
  vec2 uv = v_texCoord;
  vec4 fxBg = texture(u_fxOutput, uv);

  if (!u_hasMask) {
    fragColor = fxBg;
    return;
  }

  vec4 base = texture(u_baseVideo, uv);
  vec4 mask = texture(u_maskVideo, uv);

  float alpha = 0.0;
  for (int i = 0; i < MAX_COLORS; i++) {
    if (i >= u_numMaskColors) break;
    float luma = dot(mask.rgb, vec3(0.3333));
    float maskDiff = dot(abs(mask.rgb - u_maskColors[i]), vec3(1.0));
    float maskAlpha = (1.0 - smoothstep(0.0, 1.0, maskDiff)) * smoothstep(0.15, 0.25, luma);
    alpha = max(alpha, maskAlpha);
  }

  alpha = min(base.a, alpha);
  vec4 subject = vec4(unpremult(base).rgb * alpha, alpha);

  // Composite subject over FX background (porter-duff over)
  vec3 outRgb = subject.rgb + fxBg.rgb * (1.0 - subject.a);
  float outA = subject.a + fxBg.a * (1.0 - subject.a);
  fragColor = vec4(outRgb, outA);
}
`;

// ─── Passthrough (copy texture to canvas) ────────────────────────────────────
export const PASSTHROUGH_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;
