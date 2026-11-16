// GLSL for the solar-system canvas: line art on a twilight sky. Every pass outputs premultiplied alpha and is blended
// with ONE, ONE_MINUS_SRC_ALPHA. Coordinates are CSS pixels, y down, like the DOM.

/** A quad around `u_center` with half-size `u_half`; `v_p` is the pixel offset from the centre. */
export const QUAD_VS = /* glsl */ `#version 300 es
in vec2 a_pos;
uniform vec2 u_res;
uniform vec2 u_center;
uniform vec2 u_half;
out vec2 v_p;
void main() {
  v_p = a_pos * u_half;
  vec2 s = u_center + v_p;
  gl_Position = vec4(s.x / u_res.x * 2.0 - 1.0, 1.0 - s.y / u_res.y * 2.0, 0.0, 1.0);
}`;

/** Shared by every pass that paints over the sky: the sky colour under this pixel, strokes and fills in CSS pixels. */
const COMMON = /* glsl */ `
uniform vec2 u_res;
uniform float u_dpr;
uniform vec3 u_skyTop;
uniform vec3 u_skyBot;
vec3 sky() { return mix(u_skyTop, u_skyBot, 1.0 - gl_FragCoord.y / (u_res.y * u_dpr)); }
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
/** Coverage of a stroke \`w\` px wide, \`d\` px from its centre line. */
float stroke(float d, float w) { return clamp((w * 0.5 - abs(d)) * u_dpr + 0.5, 0.0, 1.0); }
/** Coverage of the inside of a shape whose edge is \`d\` px away (negative inside). */
float inside(float d) { return clamp(0.5 - d * u_dpr, 0.0, 1.0); }
/** A stroke \`w\` px wide along the zero line of \`f\`, whatever units \`f\` is in. */
float contour(float f, float w) { return clamp(w * 0.5 * u_dpr - abs(f) / max(fwidth(f), 1e-6) + 0.5, 0.0, 1.0); }
/** Signed distance (px, approximate) to a concave four-point sparkle with arms \`s\` px long. */
float sparkle(vec2 p, float s) {
  vec2 q = max(abs(p), vec2(0.35));
  return (sqrt(q.x) + sqrt(q.y) - sqrt(s)) / (0.5 * length(inversesqrt(q)));
}
`;

/** The sky: a vertical gradient, dithered so it doesn't band. */
export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
${COMMON}
void main() {
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o = vec4(sky() + d / 255.0, 1.0);
}`;

/** Star field: specks and four-point sparkles as point sprites, in three parallax layers. */
export const STARS_VS = /* glsl */ `#version 300 es
in vec4 a_s;  // x, y (0..1), size (css px; 2.5 and up is a sparkle's arm length), brightness
in vec4 a_t;  // tint (-1..1), phase, period (s), layer
uniform vec2 u_res;
uniform vec2 u_pan;
uniform float u_time;
uniform float u_dpr;
uniform float u_fade;
out float v_b;
out float v_tint;
out float v_size;
out float v_kind;
void main() {
  float f = a_t.w < 0.5 ? 0.04 : a_t.w < 1.5 ? 0.08 : 0.14;
  vec2 field = u_res + 160.0;
  vec2 pos = mod(a_s.xy * field + u_pan * f, field) - 80.0;
  gl_Position = vec4(pos.x / u_res.x * 2.0 - 1.0, 1.0 - pos.y / u_res.y * 2.0, 0.0, 1.0);
  float tw = sin(u_time * 6.2831853 / a_t.z + a_t.y);
  v_kind = a_s.z >= 2.5 ? 1.0 : 0.0;
  v_b = a_s.w * (1.0 + (v_kind > 0.5 ? 0.2 : 0.08) * tw) * u_fade;
  v_size = a_s.z * (v_kind > 0.5 ? 1.0 + 0.14 * tw : 1.0) * u_dpr;
  v_tint = a_t.x;
  gl_PointSize = v_kind > 0.5 ? v_size * 2.0 + 2.0 : max(v_size, 1.0) * 3.0 + 2.0;
}`;

export const STARS_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_b;
in float v_tint;
in float v_size;
in float v_kind;
out vec4 o;
uniform float u_theme;   // 0 dark, 1 light
void main() {
  float a;
  if (v_kind > 0.5) {
    vec2 q = max(abs(gl_PointCoord - 0.5) * (v_size * 2.0 + 2.0), vec2(0.35));
    float d = (sqrt(q.x) + sqrt(q.y) - sqrt(v_size)) / (0.5 * length(inversesqrt(q)));
    a = clamp(0.5 - d, 0.0, 1.0) * v_b;
  } else {
    float s = max(v_size, 1.0);
    float r = length(gl_PointCoord - 0.5) * (s * 3.0 + 2.0);
    // Sub-pixel specks dim instead of shrinking.
    a = clamp(s * 0.5 + 0.5 - r, 0.0, 1.0) * v_b * min(v_size, 1.0);
  }
  // Three inks: pale, gold, rose.
  float gold = step(v_tint, -0.33);
  float rose = step(0.33, v_tint);
  if (u_theme < 0.5) {
    vec3 c = mix(mix(vec3(0.86, 0.9, 1.0), vec3(1.0, 0.86, 0.5), gold), vec3(0.94, 0.7, 0.87), rose);
    o = vec4(c * a, a);
  } else {
    vec3 c = mix(mix(vec3(0.24, 0.27, 0.45), vec3(0.78, 0.56, 0.12), gold), vec3(0.72, 0.42, 0.62), rose);
    a *= v_kind > 0.5 ? mix(mix(0.42, 0.85, gold), 0.55, rose) : 0.3;
    o = vec4(c * a, a);
  }
}`;

/** One orbit ellipse as a row of evenly spaced dots: brighter on the near half, drawn on from the front. */
export const ORBIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform vec2 u_R;
uniform float u_dpr;
uniform float u_near;
uniform float u_far;
uniform float u_prog;
uniform float u_dots;
uniform vec3 u_col;
void main() {
  vec2 q = v_p / u_R;
  float lq = max(length(q), 1e-4);
  vec2 g = v_p / (u_R * u_R);
  float d = (lq - 1.0) * lq / max(length(g), 1e-6);
  float ang = atan(q.y, q.x);
  // Arc length along the ellipse, so the dots keep their spacing where it curves tightly.
  float m = 0.5 * (u_R.x + u_R.y);
  float k = 0.5 * (u_R.x - u_R.y);
  float cell = 6.2831853 * m / max(8.0, floor(u_dots + 0.5));
  float along = (fract((m * ang - 0.5 * k * sin(2.0 * ang)) / cell) - 0.5) * cell;
  float dotA = clamp((0.85 - length(vec2(along, d))) * u_dpr + 0.5, 0.0, 1.0);
  float fromFront = abs(mod(ang - 1.5707963 + 3.1415926, 6.2831853) - 3.1415926) / 3.1415926;
  float reveal = 1.0 - smoothstep(u_prog - 0.03, u_prog, fromFront);
  float a = dotA * mix(u_far, u_near, smoothstep(-0.55, 0.55, q.y)) * reveal;
  o = vec4(u_col * a, a);
}`;

/** The star: a solid core in a ring, on two nested four-point sparkles. Outlines only; the shapes are filled with sky. */
export const SUN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform float u_rs;
uniform float u_time;
uniform float u_bloom;
uniform vec3 u_line;
${COMMON}
void main() {
  float rs = u_rs * mix(0.3, 1.0, u_bloom);
  float breathe = sin(u_time * 6.2831853 / 6.0);
  float w = max(1.25, rs * 0.1);
  vec4 bg = vec4(sky(), 1.0);
  vec4 ink = vec4(u_line, 1.0);
  float d = sparkle(v_p, rs * 6.4 * (1.0 + 0.03 * breathe));
  vec4 c = over(ink * stroke(d, w), bg * inside(d));
  d = sparkle(mat2(0.7071, 0.7071, -0.7071, 0.7071) * v_p, rs * 4.0 * (1.0 - 0.04 * breathe));
  c = over(ink * stroke(d, w * 0.85) * 0.8, over(bg * inside(d), c));
  float len = length(v_p);
  d = len - rs * 1.67;
  c = over(ink * stroke(d, w * 1.15), over(bg * inside(d), c));
  c = over(ink * inside(len - rs), c);
  o = c * u_bloom;
}`;

/**
 * A planet or moon as line art on a sphere impostor: the quad rebuilds the sphere normal per pixel, so surface lines
 * turn with the body and stay crisp at any zoom. A tinted disc, an outline, a hatched night side, and a few lines for
 * what kind of world it is; rings are two or four edge lines with sky between them.
 * Body frame: \`u_A\` is the pole, \`u_E1\`/\`u_E2\` span the equator, all in view space (y down, z toward the viewer).
 */
export const BODY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform float u_r;
uniform int u_kind;        // 0 rock, 1 ice, 2 cloud, 3 gas, 4 giant
uniform vec3 u_line;
uniform vec3 u_fill;
uniform vec3 u_shade;
uniform vec3 u_L;
uniform vec2 u_hatch;      // unit normal of the hatch lines, screen space
uniform vec3 u_A;
uniform vec3 u_E1;
uniform vec3 u_E2;
uniform float u_rot;
uniform float u_seed;
uniform float u_bands;
uniform float u_ringOn;
uniform vec2 u_ringR;
uniform float u_ringGap;
uniform float u_theme;
uniform float u_alpha;
uniform float u_hover;
${COMMON}

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
/** Two octaves: smooth enough that its contours read as coastlines, not static. */
float soft(vec3 p) { return (vnoise(p) + 0.5 * vnoise(p * 2.07 + 11.3)) / 1.5; }
vec3 rotY(vec3 q, float a) { float c = cos(a), s = sin(a); return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z); }

/** Surface lines for a point \`q\` on the unit sphere, in the body's turning frame. */
float surfaceLines(vec3 q, float w) {
  float s = u_seed * 37.0;
  if (u_kind == 0) {
    // Rock: crater rims.
    float a = 0.0;
    for (int i = 0; i < 7; i++) {
      vec3 h = hash33(vec3(float(i) * 7.13 + 1.0, u_seed * 91.7 + 2.0, 3.7));
      float cz = h.x * 1.5 - 0.75;
      float sr = sqrt(1.0 - cz * cz);
      float ph = h.y * 6.2831853;
      vec3 c = vec3(sr * cos(ph), cz, sr * sin(ph));
      a = max(a, contour(length(q - c) - (0.14 + 0.15 * h.z), w));
    }
    return a;
  }
  if (u_kind == 1) {
    // Ice world: coastlines and two polar caps.
    float n = soft(q * 1.6 + s);
    return max(contour(n - 0.56, w), contour(abs(q.y) + (n - 0.5) * 0.14 - 0.8, w));
  }
  if (u_kind == 2) {
    // Cloud world: a few wandering streaks.
    float lat = q.y + (soft(q * vec3(1.3, 2.6, 1.3) + s) - 0.5) * 0.32;
    return contour(sin((lat + 0.1 * u_seed) * 3.1415926 * 2.6), w);
  }
  // Gas and great giants: latitude bands of uneven width.
  float lat = q.y + (soft(q * vec3(1.5, 3.4, 1.5) + s) - 0.5) * 0.05;
  lat += 0.07 * sin(lat * 5.0 + u_seed * 20.0);
  float bands = contour(sin(lat * (2.5 + u_bands * 0.35) * 3.1415926), w);
  if (u_kind == 4) {
    // A storm oval; the bands stop at its edge.
    vec3 S = normalize(vec3(0.62, -0.34, 0.7));
    vec3 t1 = normalize(vec3(-S.z, 0.0, S.x));
    vec3 dq = q - S;
    float ds = length(vec2(dot(dq, t1), dq.y * 1.9)) - 0.2;
    return max(bands * smoothstep(0.0, 0.02, ds), contour(ds, w));
  }
  return bands;
}

void main() {
  vec2 p = v_p / u_r;
  float d = length(p);
  float ow = max(1.5, u_r * 0.05);
  float lw = max(1.0, u_r * 0.03);
  vec3 lineC = u_theme < 0.5 ? mix(u_line, vec3(1.0), 0.3 * u_hover) : u_line * (1.0 - 0.22 * u_hover);
  vec4 ink = vec4(lineC, 1.0);
  vec4 col = vec4(0.0);

  // Ring: where the view ray meets the equatorial plane.
  float zr = -(u_A.x * p.x + u_A.y * p.y) / u_A.z;
  float rr = length(vec3(p, zr));
  float fr = max(fwidth(rr), 1e-6);
  vec4 ringCol = vec4(0.0);
  if (u_ringOn > 0.5) {
    float band = clamp((rr - u_ringR.x) / fr + 0.5, 0.0, 1.0) * clamp((u_ringR.y - rr) / fr + 0.5, 0.0, 1.0);
    float edges = max(contour(rr - u_ringR.x, lw), contour(rr - u_ringR.y, lw));
    if (u_ringGap >= 0.0) {
      float span = u_ringR.y - u_ringR.x;
      float g0 = u_ringR.x + span * (u_ringGap - 0.06);
      float g1 = u_ringR.x + span * (u_ringGap + 0.06);
      band *= 1.0 - clamp((rr - g0) / fr + 0.5, 0.0, 1.0) * clamp((g1 - rr) / fr + 0.5, 0.0, 1.0);
      edges = max(edges, max(contour(rr - g0, lw), contour(rr - g1, lw)));
    }
    ringCol = over(ink * edges, vec4(sky(), 1.0) * band);
  }

  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 N = vec3(p, z);
  vec3 q = rotY(vec3(dot(N, u_E1), dot(N, -u_A), dot(N, u_E2)), u_rot);
  float ndl = dot(N, u_L);
  float lines = surfaceLines(q, lw);
  float night = clamp(0.5 - ndl / max(fwidth(ndl), 1e-6), 0.0, 1.0);
  float terminator = contour(ndl, lw);

  if (d < 1.0 + 1.0 / u_r) {
    // Night side: a lighter tint, hatched.
    float sp = max(3.5, u_r * 0.13);
    float hd = abs(fract(dot(v_p, u_hatch) / sp + 0.5) - 0.5) * sp;
    float hatch = stroke(hd, max(0.9, u_r * 0.028)) * night;
    vec3 c = mix(u_fill, u_shade, night);
    c = mix(c, lineC, max(max(hatch, lines) * 0.9, terminator));
    c = mix(c, lineC, stroke((d - 1.0) * u_r + ow * 0.5, ow));
    float a = inside((d - 1.0) * u_r);
    vec4 sphere = vec4(c * a, a);
    if (zr > z) col = over(ringCol, sphere);
    else col = over(sphere, ringCol);
  } else {
    col = ringCol;
  }
  o = col * u_alpha;
}`;
