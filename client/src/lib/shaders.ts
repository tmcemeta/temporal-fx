// TEMPORAL FX — WebGL Shader Source
// All rendering is done in WebGL2.
//
// KEY ARCHITECTURE DECISION:
// GLSL/WebGL2 does not allow dynamic indexing of sampler arrays
// (e.g. texture(u_history[i], uv) where i is non-constant is illegal).
//
// Solution: pack all history frames into a single TEXTURE ATLAS.
// The atlas is a tall 2D texture: each row of ATLAS_COLS tiles holds
// one frame. We address a specific frame by computing its UV tile offset.
//
// Atlas layout: width = videoWidth * ATLAS_COLS, height = videoHeight * numRows
// Frame index f → tile col = f % ATLAS_COLS, tile row = floor(f / ATLAS_COLS)
// UV for frame f at pixel uv: ((uv.x + col) / ATLAS_COLS, (uv.y + row) / numRows)

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const MAX_HISTORY = 60;
// Atlas is 6 columns × 10 rows = 60 frames max
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 10; // ceil(MAX_HISTORY / ATLAS_COLS)

export const COMPOSITE_SHADER = `#version 300 es
precision highp float;

#define MAX_HISTORY ${MAX_HISTORY}
#define ATLAS_COLS ${ATLAS_COLS}
#define ATLAS_ROWS ${ATLAS_ROWS}

in vec2 v_texCoord;
out vec4 fragColor;

// Current frame
uniform sampler2D u_current;
// History atlas: all history frames packed into one texture
// Layout: ATLAS_COLS columns x ATLAS_ROWS rows of frame tiles
uniform sampler2D u_historyAtlas;
// Previous frame for motion detection (separate texture, no atlas needed)
uniform sampler2D u_prevFrame;

uniform float u_histWeights[MAX_HISTORY];
uniform int u_numHistory;
uniform int u_blendMode;
uniform float u_blendStrength;
uniform int u_weightMode;
uniform int u_chromR;
uniform int u_chromB;
uniform float u_weightCurve[64];
uniform int u_weightCurveLen;

// Mask exclusion
uniform bool u_excludeMask;
uniform sampler2D u_maskTex;
uniform vec3 u_maskExcludeColors[5];
uniform int u_numMaskExcludeColors;

// Sample a specific frame from the atlas by index (0 = most recent)
vec4 sampleHistory(int frameIdx, vec2 uv) {
  int col = frameIdx - (frameIdx / ATLAS_COLS) * ATLAS_COLS; // frameIdx % ATLAS_COLS
  int row = frameIdx / ATLAS_COLS;
  float u = (uv.x + float(col)) / float(ATLAS_COLS);
  float v = (uv.y + float(row)) / float(ATLAS_ROWS);
  return texture(u_historyAtlas, vec2(u, v));
}

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
  float idx = clamp(t, 0.0, 1.0) * float(u_weightCurveLen - 1);
  int i0 = int(idx);
  int i1 = min(i0 + 1, u_weightCurveLen - 1);
  float frac = idx - float(i0);
  return mix(u_weightCurve[i0], u_weightCurve[i1], frac);
}

float getPixelWeight(vec3 histPixel, float baseWeight) {
  if (u_weightMode == 0) return baseWeight; // uniform
  float luma = getLuma(histPixel);
  float rawVal = 0.0;
  if (u_weightMode == 1) rawVal = luma;           // luminance
  else if (u_weightMode == 2) rawVal = 1.0 - luma; // darkness
  else rawVal = 1.0; // motion: handled outside
  float curveVal = sampleWeightCurve(rawVal);
  return baseWeight * curveVal;
}

// Compute how much a pixel at uv is inside the mask (0=outside, 1=inside)
float getMaskAlpha(vec2 uv) {
  if (!u_excludeMask) return 0.0;
  vec4 mask = texture(u_maskTex, uv);
  float alpha = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= u_numMaskExcludeColors) break;
    float luma = dot(mask.rgb, vec3(0.3333));
    float maskDiff = dot(abs(mask.rgb - u_maskExcludeColors[i]), vec3(1.0));
    float maskAlpha = (1.0 - smoothstep(0.0, 1.0, maskDiff)) * smoothstep(0.15, 0.25, luma);
    alpha = max(alpha, maskAlpha);
  }
  return alpha;
}

void main() {
  vec2 uv = v_texCoord;
  vec4 current = texture(u_current, uv);

  if (u_numHistory == 0 || u_blendStrength < 0.001) {
    fragColor = current;
    return;
  }

  // Motion weight: per-pixel frame difference
  float motionWeight = 1.0;
  if (u_weightMode == 3) {
    vec4 prev = texture(u_prevFrame, uv);
    vec3 diff = abs(current.rgb - prev.rgb);
    motionWeight = clamp(getLuma(diff) * 4.0, 0.0, 1.0);
    motionWeight = smoothstep(0.05, 0.5, motionWeight);
  }

  // Accumulate history from atlas
  // u_histWeights is indexed by atlas SLOT (not recency), pre-sorted by CPU
  vec3 accum = vec3(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < MAX_HISTORY; i++) {
    float hw = u_histWeights[i];
    if (hw < 0.001) continue;

    vec3 histColor = sampleHistory(i, uv).rgb;
    float pw = getPixelWeight(histColor, hw);
    if (u_weightMode == 3) pw *= motionWeight;

    accum += histColor * pw;
    totalWeight += pw;
  }

  if (totalWeight < 0.001) {
    fragColor = current;
    return;
  }

  // Blend
  vec3 blended;
  if (u_blendMode == 5) { // average
    blended = accum / totalWeight;
  } else {
    accum = clamp(accum / max(totalWeight, 1.0), 0.0, 1.0);
    if      (u_blendMode == 0) blended = blendScreen(current.rgb, accum);
    else if (u_blendMode == 1) blended = blendAdd(current.rgb, accum);
    else if (u_blendMode == 2) blended = blendMultiply(current.rgb, accum);
    else if (u_blendMode == 3) blended = blendOverlay(current.rgb, accum);
    else if (u_blendMode == 4) blended = blendDifference(current.rgb, accum);
    else                        blended = blendAverage(current.rgb, accum);
  }

  // If mask exclusion is on, blend back to current in the masked region
  float maskExclusion = getMaskAlpha(uv);
  vec3 result = mix(mix(current.rgb, blended, u_blendStrength), current.rgb, maskExclusion);

  // Chromatic aberration: R samples from chromR-offset frame, B from chromB-offset frame
  float r = result.r;
  float b = result.b;

  // u_chromR and u_chromB are atlas slot indices (pre-computed by CPU)
  if (u_chromR >= 0) {
    float rSample = sampleHistory(u_chromR, uv).r;
    r = mix(mix(result.r, rSample, u_blendStrength * 0.7), current.r, maskExclusion);
  }
  if (u_chromB >= 0) {
    float bSample = sampleHistory(u_chromB, uv).b;
    b = mix(mix(result.b, bSample, u_blendStrength * 0.7), current.b, maskExclusion);
  }

  fragColor = vec4(r, result.g, b, current.a);
}
`;

// ─── Mask Extract + Subject Overlay Shader ───────────────────────────────────
export const OVERLAY_SHADER = `#version 300 es
precision highp float;

#define MAX_COLORS 5

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_fxOutput;
uniform sampler2D u_baseVideo;
uniform sampler2D u_maskVideo;
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

  vec3 outRgb = subject.rgb + fxBg.rgb * (1.0 - subject.a);
  float outA = subject.a + fxBg.a * (1.0 - subject.a);
  fragColor = vec4(outRgb, outA);
}
`;

// ─── Passthrough ─────────────────────────────────────────────────────────────
export const PASSTHROUGH_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;
