// SIMPLE SUBJECT — WebGL Shader Source
// Only the subject extraction overlay shader is used here.
// The temporal compositing pipeline has been removed entirely.

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// ─── Passthrough ─────────────────────────────────────────────────────────────
// Used to display a single texture directly (e.g. Raw Input view).
export const PASSTHROUGH_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;

// ─── Subject Extraction Shader ───────────────────────────────────────────────
// Inputs:
//   u_baseVideo  — the original base video frame (subject + background)
//   u_maskVideo  — the mask video frame (colored regions define subject area)
//
// The mask is keyed by color: pixels in u_maskVideo that match any of the
// u_maskColors[i] entries (within the tolerance defined by u_edgeSoftness)
// are treated as "subject present". The resulting alpha is applied to u_baseVideo.
//
// View modes:
//   0 = Normal:     subject composited over base background
//   1 = Subject:    extracted subject over black (alpha preserved)
//   2 = Background: base frame with subject region zeroed out
//
// Spill suppression: when u_spillSuppression is true, pixels near the mask
// color boundary have their saturation reduced proportionally to how close
// they are to the key color, removing color fringing on subject edges.
export const SUBJECT_SHADER = `#version 300 es
precision highp float;

#define MAX_COLORS 5

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_baseVideo;
uniform sampler2D u_maskVideo;

// Mask key colors (up to MAX_COLORS active)
uniform vec3 u_maskColors[MAX_COLORS];
uniform int u_numMaskColors;

// Keying quality controls
uniform float u_edgeSoftness;   // color-distance falloff upper bound (0.1..2.0)
uniform float u_minLuma;        // minimum mask luma to count as mask (0..0.5)

// Spill suppression
uniform bool u_spillSuppression;
uniform float u_spillStrength;

// View mode: 0=normal, 1=subject only, 2=background only
uniform int u_viewMode;

// ─── Helpers ─────────────────────────────────────────────────────────────────

vec4 unpremult(vec4 color) {
  if (color.a < 0.0001) return vec4(0.0);
  return vec4(clamp(color.rgb / color.a, vec3(0.0), vec3(1.0)), color.a);
}

float getLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Convert RGB to HSL saturation (0..1)
float getSaturation(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float delta = maxC - minC;
  if (maxC < 0.0001) return 0.0;
  return delta / maxC;
}

// Desaturate a color toward its luma value by amount t (0=no change, 1=full grey)
vec3 desaturate(vec3 c, float t) {
  float luma = getLuma(c);
  return mix(c, vec3(luma), t);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = v_texCoord;
  vec4 base = texture(u_baseVideo, uv);
  vec4 mask = texture(u_maskVideo, uv);

  // Compute mask alpha: maximum match across all active key colors
  float alpha = 0.0;
  float closestDist = 999.0;

  for (int i = 0; i < MAX_COLORS; i++) {
    if (i >= u_numMaskColors) break;

    float luma = getLuma(mask.rgb);
    float maskDiff = length(mask.rgb - u_maskColors[i]);

    // Luma gate: ignore very dark mask pixels (shadows, black borders)
    float lumaGate = smoothstep(u_minLuma, u_minLuma + 0.1, luma);

    // Color match: 1.0 = perfect match, 0.0 = no match
    // u_edgeSoftness controls how wide the tolerance is
    float colorMatch = (1.0 - smoothstep(0.0, u_edgeSoftness, maskDiff)) * lumaGate;

    if (maskDiff < closestDist) closestDist = maskDiff;
    alpha = max(alpha, colorMatch);
  }

  // Clamp alpha to base pixel's own alpha (handles pre-multiplied sources)
  alpha = min(base.a, alpha);

  // Spill suppression: desaturate base pixels near the key color boundary
  vec3 baseRgb = unpremult(base).rgb;
  if (u_spillSuppression) {
    // Spill proximity: how close the base pixel is to any key color
    float spillProximity = 1.0 - clamp(closestDist / u_edgeSoftness, 0.0, 1.0);
    // Only suppress on the fringe (alpha between 0.05 and 0.7)
    float fringeMask = smoothstep(0.05, 0.2, alpha) * (1.0 - smoothstep(0.5, 0.7, alpha));
    float suppressAmount = spillProximity * fringeMask * u_spillStrength;
    baseRgb = desaturate(baseRgb, suppressAmount);
  }

  vec4 subject = vec4(baseRgb * alpha, alpha);

  // ─── View modes ───────────────────────────────────────────────────────────

  if (u_viewMode == 1) {
    // Subject only: extracted subject over black
    fragColor = vec4(subject.rgb, subject.a);
    return;
  }

  if (u_viewMode == 2) {
    // Background only: base frame with subject region removed
    vec3 bgRgb = unpremult(base).rgb;
    float bgAlpha = base.a * (1.0 - alpha);
    fragColor = vec4(bgRgb * bgAlpha, bgAlpha);
    return;
  }

  // Normal: subject composited over base background
  vec3 bgRgb = unpremult(base).rgb;
  vec3 outRgb = subject.rgb + bgRgb * base.a * (1.0 - alpha);
  float outA = alpha + base.a * (1.0 - alpha);
  fragColor = vec4(outRgb, outA);
}
`;
