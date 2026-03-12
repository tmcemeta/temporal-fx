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
// Atlas layout will be computed dynamically based on WebGL max texture size
// These are the maximum possible values; actual layout is computed in resize()
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 10; // ceil(MAX_HISTORY / ATLAS_COLS)

export const COMPOSITE_SHADER = `#version 300 es
precision highp float;

#define MAX_HISTORY ${MAX_HISTORY}

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

// Dynamic atlas layout
uniform int u_atlasCols;
uniform int u_atlasRows;

// Mask exclusion
uniform bool u_excludeMask;
uniform sampler2D u_maskTex;
uniform vec3 u_maskExcludeColors[5];
uniform int u_numMaskExcludeColors;

// Sample a specific frame from the atlas by index (0 = most recent)
vec4 sampleHistory(int frameIdx, vec2 uv) {
  int col = frameIdx - (frameIdx / u_atlasCols) * u_atlasCols; // frameIdx % u_atlasCols
  int row = frameIdx / u_atlasCols;
  float u = (uv.x + float(col)) / float(u_atlasCols);
  float v = (uv.y + float(row)) / float(u_atlasRows);
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
uniform int u_numMaskColors; // active count (1..5)
uniform int u_debugView;    // 0=normal, 1=subject only, 2=background only

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

  // Debug views
  if (u_debugView == 1) {
    // Subject only: show subject over black
    fragColor = vec4(subject.rgb, subject.a);
    return;
  }
  if (u_debugView == 2) {
    // Background only: show fx background, zero out subject region
    fragColor = vec4(fxBg.rgb * (1.0 - subject.a), fxBg.a * (1.0 - subject.a));
    return;
  }

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

// ─── Post-Processing Shaders ─────────────────────────────────────────────────

// Bright pass: extract pixels above luminance threshold
// Rendered at half resolution for efficiency (viewport controls this)
export const BRIGHT_PASS_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_threshold;

float getLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 color = texture(u_source, v_texCoord);
  float luma = getLuma(color.rgb);

  // Soft threshold with smooth falloff
  float brightness = max(0.0, luma - u_threshold);
  float contribution = brightness / (brightness + 1.0);

  fragColor = vec4(color.rgb * contribution, color.a);
}
`;

// Single-axis Gaussian blur (9-tap)
// Direction: (1,0) for horizontal, (0,1) for vertical
export const BLUR_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_source;
uniform vec2 u_direction;  // (1,0) or (0,1) normalized
uniform float u_radius;    // blur radius in pixels
uniform vec2 u_texelSize;  // 1.0 / textureSize

void main() {
  // 9-tap Gaussian weights (sigma ~= radius/3)
  const float weights[5] = float[5](
    0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216
  );

  vec2 offset = u_direction * u_texelSize * u_radius * 0.25;

  vec4 result = texture(u_source, v_texCoord) * weights[0];

  for (int i = 1; i < 5; i++) {
    vec2 off = offset * float(i);
    result += texture(u_source, v_texCoord + off) * weights[i];
    result += texture(u_source, v_texCoord - off) * weights[i];
  }

  fragColor = result;
}
`;

// Bloom composite: additive blend of blurred bloom onto original
export const BLOOM_COMPOSITE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_original;
uniform sampler2D u_bloom;
uniform float u_intensity;

void main() {
  vec4 original = texture(u_original, v_texCoord);
  vec4 bloom = texture(u_bloom, v_texCoord);

  // Additive blend with intensity control
  vec3 result = original.rgb + bloom.rgb * u_intensity;

  fragColor = vec4(result, original.a);
}
`;

// ─── Halation Shaders ────────────────────────────────────────────────────────

// Halation bright pass: extract bright pixels and tint toward warm color
// Simulates light scattering through film emulsion layer
export const HALATION_BRIGHT_PASS_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_threshold;
uniform vec3 u_tint;
uniform float u_tintStrength;

float getLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 color = texture(u_source, v_texCoord);
  float luma = getLuma(color.rgb);

  // Soft threshold with smooth falloff
  float brightness = max(0.0, luma - u_threshold);
  float contribution = brightness / (brightness + 1.0);

  // Tint the bright pixels toward the warm color
  // Mix between original color and tint based on tintStrength
  vec3 tinted = mix(color.rgb, u_tint * luma, u_tintStrength);

  fragColor = vec4(tinted * contribution, color.a);
}
`;

// Halation composite: screen blend for more natural film look
export const HALATION_COMPOSITE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_original;
uniform sampler2D u_halation;
uniform float u_intensity;

void main() {
  vec4 original = texture(u_original, v_texCoord);
  vec4 halation = texture(u_halation, v_texCoord);

  // Screen blend for more natural film look
  // result = 1 - (1 - original) * (1 - halation * intensity)
  vec3 halationScaled = halation.rgb * u_intensity;
  vec3 result = 1.0 - (1.0 - original.rgb) * (1.0 - halationScaled);

  fragColor = vec4(result, original.a);
}
`;

// ─── Soft Glow Shaders ───────────────────────────────────────────────────────

// Soft Glow exposure pass: boost brightness of full image (no threshold)
export const SOFT_GLOW_EXPOSURE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_source;
uniform float u_exposure;

void main() {
  vec4 color = texture(u_source, v_texCoord);

  // Apply exposure boost to all pixels (no luminance threshold)
  vec3 result = color.rgb * u_exposure;

  fragColor = vec4(result, color.a);
}
`;

// Soft Glow composite: screen blend of blurred+exposed glow onto original
export const SOFT_GLOW_COMPOSITE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_original;
uniform sampler2D u_softGlow;
uniform float u_intensity;

void main() {
  vec4 original = texture(u_original, v_texCoord);
  vec4 glow = texture(u_softGlow, v_texCoord);

  // Screen blend for dreamy glow effect
  vec3 glowScaled = glow.rgb * u_intensity;
  vec3 result = 1.0 - (1.0 - original.rgb) * (1.0 - glowScaled);

  fragColor = vec4(result, original.a);
}
`;

// ─── Orton Effect Shader ─────────────────────────────────────────────────────

// Orton Sandwich: blend post-FX result with sharp original frame
// This is the FINAL pass in the chain, combining soft FX with crisp detail
export const ORTON_SANDWICH_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_fxResult;    // Post-FX output (bloom, halation, soft glow, etc.)
uniform sampler2D u_baseFrame;   // Original sharp frame
uniform float u_blendOpacity;    // How much of the sharp original to blend (0-1)
uniform int u_blendMode;         // 0=screen, 1=softLight, 2=average

// Screen blend: 1 - (1 - a) * (1 - b)
vec3 blendScreen(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}

// Soft light blend: complex formula for subtle, natural blending
vec3 blendSoftLight(vec3 base, vec3 blend) {
  vec3 result;
  for (int i = 0; i < 3; i++) {
    float b = base[i];
    float s = blend[i];
    if (s <= 0.5) {
      result[i] = b - (1.0 - 2.0 * s) * b * (1.0 - b);
    } else {
      float d = (b <= 0.25) ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
      result[i] = b + (2.0 * s - 1.0) * (d - b);
    }
  }
  return result;
}

// Average blend: simple 50/50 mix
vec3 blendAverage(vec3 base, vec3 blend) {
  return (base + blend) * 0.5;
}

void main() {
  vec4 fxResult = texture(u_fxResult, v_texCoord);
  vec4 baseFrame = texture(u_baseFrame, v_texCoord);

  // Blend sharp original into the FX result
  vec3 blended;
  if (u_blendMode == 0) {
    // Screen: brightens, good for glowy effect
    blended = blendScreen(fxResult.rgb, baseFrame.rgb * u_blendOpacity);
  } else if (u_blendMode == 1) {
    // Soft Light: subtle, natural blend
    blended = blendSoftLight(fxResult.rgb, baseFrame.rgb);
    blended = mix(fxResult.rgb, blended, u_blendOpacity);
  } else {
    // Average: direct 50/50 mix, controlled by opacity
    blended = mix(fxResult.rgb, blendAverage(fxResult.rgb, baseFrame.rgb), u_blendOpacity);
  }

  fragColor = vec4(blended, fxResult.a);
}
`;
