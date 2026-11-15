// GLSL for the solar-system canvas. Every pass outputs premultiplied alpha and is blended with ONE, ONE_MINUS_SRC_ALPHA,
// so a pass can either cover (alpha > 0) or add light (alpha 0). Coordinates are CSS pixels, y down, like the DOM.

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

const NOISE = /* glsl */ `
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
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return s / 0.875;
}
/** Distance to the nearest cell point; rad gets that cell's random 0..1. */
float cells(vec3 p, out float rad) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 9.0;
  rad = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = hash33(i + o);
    float d = length(o + h * 0.8 + 0.1 - f);
    if (d < best) { best = d; rad = h.z; }
  }
  return best;
}
`;

/** Nebula wash and vignette, rendered once into a half-resolution texture. */
export const NEBULA_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform vec2 u_res;
uniform float u_theme;   // 0 dark, 1 light
uniform float u_key;     // 1 in the project view: a light wash from the upper-left key light
${NOISE}
void main() {
  vec2 uv = v_p / u_res + 0.5;
  vec2 pa = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float n1 = fbm(vec3(pa * 1.4, 1.3));
  float n2 = fbm(vec3(pa * 2.0 + n1 * 1.3, 4.1));
  float n3 = fbm(vec3(pa * 1.7 + 7.0 - n1, 2.0));
  float vig = smoothstep(0.35, 1.05, length((uv - 0.5) * vec2(1.0, 1.15)) * 1.45);
  vec2 corner = (uv - vec2(0.0, 0.0)) * vec2(u_res.x / u_res.y, 1.0);
  float key = u_key * exp(-dot(corner, corner) * 2.2);
  if (u_theme < 0.5) {
    vec3 indigo = vec3(0.30, 0.26, 0.70);
    vec3 teal = vec3(0.10, 0.48, 0.55);
    vec3 add = indigo * smoothstep(0.42, 0.82, n2) * 0.06 + teal * smoothstep(0.5, 0.86, n3) * 0.05;
    add += vec3(0.95, 0.92, 0.85) * key * 0.07;
    float v = vig * 0.55;
    o = vec4(add * (1.0 - v), v);
  } else {
    vec3 ink = vec3(0.20, 0.25, 0.42);
    float a = smoothstep(0.45, 0.85, n2) * 0.035 + vig * 0.05;
    vec3 col = ink * a;
    float w = key * 0.10;
    col = vec3(1.0, 0.94, 0.82) * w + col * (1.0 - w);
    o = vec4(col, a + w * (1.0 - a));
  }
}`;

/** Copies the nebula texture to the screen, dithered so the faint gradients don't band. */
export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform vec2 u_res;
uniform sampler2D u_tex;
void main() {
  vec2 uv = v_p / u_res + 0.5;
  vec4 c = texture(u_tex, vec2(uv.x, 1.0 - uv.y));
  float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  o = max(c + d / 255.0, 0.0);
}`;

/** Star field: point sprites in three parallax layers. */
export const STARS_VS = /* glsl */ `#version 300 es
in vec4 a_s;  // x, y (0..1), size (css px), brightness
in vec4 a_t;  // tint (-1..1), phase, period (s), layer
uniform vec2 u_res;
uniform vec2 u_pan;
uniform float u_time;
uniform float u_dpr;
uniform float u_fade;
out float v_b;
out float v_tint;
out float v_size;
void main() {
  float f = a_t.w < 0.5 ? 0.04 : a_t.w < 1.5 ? 0.08 : 0.14;
  vec2 field = u_res + 160.0;
  vec2 pos = mod(a_s.xy * field + u_pan * f, field) - 80.0;
  gl_Position = vec4(pos.x / u_res.x * 2.0 - 1.0, 1.0 - pos.y / u_res.y * 2.0, 0.0, 1.0);
  v_b = a_s.w * (1.0 + 0.05 * sin(u_time * 6.2831853 / a_t.z + a_t.y)) * u_fade;
  v_size = a_s.z * u_dpr;
  v_tint = a_t.x;
  gl_PointSize = max(v_size, 1.0) * 3.0 + 2.0;
}`;

export const STARS_FS = /* glsl */ `#version 300 es
precision highp float;
in float v_b;
in float v_tint;
in float v_size;
out vec4 o;
uniform float u_theme;
void main() {
  float s = max(v_size, 1.0);
  float r = length(gl_PointCoord - 0.5) * (s * 3.0 + 2.0);
  float disc = clamp(s * 0.5 + 0.5 - r, 0.0, 1.0);
  // Sub-pixel stars dim instead of shrinking; bright ones get a small soft glow.
  float glow = exp(-r * r / (s * s * 1.6)) * 0.35 * smoothstep(1.2, 2.6, v_size);
  float a = clamp((disc + glow) * v_b * min(v_size, 1.0), 0.0, 1.0);
  if (u_theme < 0.5) {
    vec3 tint = v_tint < 0.0 ? vec3(1.0, 0.82, 0.66) : vec3(0.72, 0.84, 1.0);
    vec3 c = mix(vec3(1.0), tint, abs(v_tint) * 0.55);
    o = vec4(c * a, a);
  } else {
    vec3 ink = vec3(0.22, 0.25, 0.34);
    float b = a * 0.3;
    o = vec4(ink * b, b);
  }
}`;

/** One orbit ellipse as an anti-aliased hairline: brighter on the near half, drawn on from the front. */
export const ORBIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform vec2 u_R;
uniform float u_dpr;
uniform float u_near;
uniform float u_far;
uniform float u_prog;
uniform float u_ticks;
uniform vec3 u_col;
void main() {
  vec2 q = v_p / u_R;
  float lq = max(length(q), 1e-4);
  vec2 g = v_p / (u_R * u_R);
  float d = (lq - 1.0) * lq / max(length(g), 1e-6);
  float line = clamp((0.5 - abs(d)) * u_dpr + 0.5, 0.0, 1.0);
  float ang = atan(q.y, q.x);
  float fromFront = abs(mod(ang - 1.5707963 + 3.1415926, 6.2831853) - 3.1415926) / 3.1415926;
  float reveal = 1.0 - smoothstep(u_prog - 0.03, u_prog, fromFront);
  float k = smoothstep(-0.55, 0.55, q.y);
  float a = line * mix(u_far, u_near, k);
  if (u_ticks > 0.5 && d > 3.0) {
    float deg = degrees(ang);
    float major = abs(fract(deg / 30.0 + 0.5) - 0.5) * 30.0;
    float len = major < 2.5 ? 7.0 : 3.5;
    float minor = abs(fract(deg / 5.0 + 0.5) - 0.5) * 5.0;
    float px = radians(minor) * length(v_p);
    float tick = clamp((0.5 - px) * u_dpr + 0.5, 0.0, 1.0) * (1.0 - smoothstep(3.0 + len - 0.5, 3.0 + len + 0.5, d));
    a = max(a, tick * mix(u_far, u_near, k) * 1.4);
  }
  a *= reveal;
  o = vec4(u_col * a, a);
}`;

/** The star: white-hot core with two corona layers and faint spikes in dark; a gold disc with an amber halo in light. */
export const SUN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform float u_rs;
uniform float u_time;
uniform float u_theme;
uniform float u_dpr;
uniform float u_bloom;
void main() {
  float rs = u_rs * mix(0.3, 1.0, u_bloom);
  float len = length(v_p);
  float d = len / rs;
  float breathe = 1.0 + 0.04 * sin(u_time * 6.2831853 / 6.0);
  float core = clamp((rs - len) * u_dpr + 0.5, 0.0, 1.0);
  float out1 = max(d - 1.0, 0.0);
  if (u_theme < 0.5) {
    vec3 coreC = mix(vec3(1.0, 0.9, 0.74), vec3(1.0, 0.995, 0.98), smoothstep(0.95, 0.2, d));
    float c1 = exp(-out1 * 1.7 / breathe) * 0.6;
    float c2 = exp(-out1 * 0.3 / breathe) * 0.17;
    vec2 a = abs(v_p) / rs;
    vec2 b = abs(mat2(0.7071, 0.7071, -0.7071, 0.7071) * v_p) / rs;
    float spikes = (exp(-a.y * 10.0) * exp(-a.x * 0.6) + exp(-a.x * 10.0) * exp(-a.y * 0.6)) * 0.1
                 + (exp(-b.y * 12.0) * exp(-b.x * 0.55) + exp(-b.x * 12.0) * exp(-b.y * 0.55)) * 0.04;
    vec3 glow = vec3(1.0, 0.84, 0.6) * c1 + vec3(1.0, 0.72, 0.42) * c2 + vec3(1.0, 0.92, 0.8) * spikes * smoothstep(0.9, 1.6, d);
    o = vec4(coreC * core + glow * (1.0 - core) * u_bloom, core * u_bloom);
  } else {
    vec3 gold = vec3(0.96, 0.72, 0.28);
    float wash = exp(-pow(len / (u_rs * 26.0), 2.0)) * 0.12 * u_bloom;
    float corona = exp(-out1 * 0.85 / breathe) * 0.32 * step(1.0, d) * u_bloom;
    float ring = clamp((0.5 - abs(len - rs * 2.3)) * u_dpr + 0.5, 0.0, 1.0) * 0.4 * u_bloom;
    vec4 c = vec4(vec3(1.0, 0.86, 0.62) * wash, wash);
    c = vec4(vec3(0.98, 0.68, 0.28) * corona, corona) + c * (1.0 - corona);
    c = vec4(vec3(0.62, 0.4, 0.1) * ring, ring) + c * (1.0 - ring);
    vec3 coreC = mix(gold, vec3(1.0, 0.9, 0.62), smoothstep(0.9, 0.1, d));
    float ca = core * u_bloom;
    c = vec4(coreC * ca, ca) + c * (1.0 - ca);
    float dith = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    o = max(c + dith / 255.0, 0.0);
  }
}`;

/**
 * A planet or moon as a sphere impostor: the quad reconstructs the sphere normal per pixel, so it stays crisp at any
 * zoom. Back to front: cast shadow (light), atmosphere halo (dark), ring behind, sphere, ring in front.
 * Body frame: `u_A` is the pole, `u_E1`/`u_E2` span the equator, all in view space (y down, z toward the viewer).
 */
export const BODY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
out vec4 o;
uniform float u_r;
uniform float u_dpr;
uniform int u_kind;        // 0 rock, 1 ice, 2 cloud, 3 gas, 4 giant
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_atm;
uniform vec3 u_ringC;
uniform vec3 u_storm;
uniform vec3 u_L;
uniform vec3 u_A;
uniform vec3 u_E1;
uniform vec3 u_E2;
uniform float u_rot;
uniform float u_cloudRot;
uniform float u_seed;
uniform float u_bands;
uniform float u_ringOn;
uniform vec2 u_ringR;
uniform float u_ringGap;
uniform float u_theme;
uniform float u_dormant;
uniform float u_alpha;
uniform float u_hover;
uniform vec3 u_ink;
${NOISE}

vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }

float ringDensity(float rr) {
  float t = (rr - u_ringR.x) / (u_ringR.y - u_ringR.x);
  if (t < 0.0 || t > 1.0) return 0.0;
  float edge = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.9, t);
  float lanes = 0.55 + 0.2 * sin(t * 14.0 + u_seed * 20.0) + 0.1 * sin(t * 31.0 + u_seed * 7.0) + 0.25 * (1.0 - t);
  float gap = u_ringGap < 0.0 ? 1.0 : mix(0.06, 1.0, smoothstep(0.018, 0.04, abs(t - u_ringGap)));
  return clamp(edge * lanes * gap, 0.0, 1.0) * 0.9;
}

vec3 rotY(vec3 q, float a) { float c = cos(a), s = sin(a); return vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z); }

vec3 surface(vec3 q, vec3 qc) {
  float s = u_seed * 37.0;
  if (u_kind == 0) {
    float n = fbm(q * 2.4 + s);
    vec3 col = mix(u_c1, u_c0, smoothstep(0.3, 0.72, n));
    col = mix(col, u_c2, smoothstep(0.6, 0.8, fbm3(q * 5.0 + 3.0 + s)) * 0.4);
    float rad;
    float f = cells(q * 3.0 + s, rad);
    float cr = 0.2 + 0.22 * rad;
    float inside = 1.0 - smoothstep(cr * 0.7, cr, f);
    float rim = smoothstep(cr * 0.75, cr, f) * (1.0 - smoothstep(cr, cr * 1.4, f));
    col *= 1.0 - 0.24 * inside;
    col += 0.09 * rim;
    f = cells(q * 7.0 + s * 0.5, rad);
    cr = 0.16 + 0.2 * rad;
    col *= 1.0 - 0.14 * (1.0 - smoothstep(cr * 0.7, cr, f));
    return col;
  }
  if (u_kind == 1) {
    float n = fbm(q * 1.7 + s) + 0.12 * fbm3(q * 6.0 + 7.0);
    float land = smoothstep(0.58, 0.62, n);
    vec3 sea = u_c0 * (0.88 + 0.22 * fbm3(q * 4.0 + 1.0 + s));
    vec3 ground = u_c1 * (0.82 + 0.3 * fbm3(q * 5.0 + 9.0 + s));
    vec3 col = mix(sea, ground, land);
    float cap = smoothstep(0.74, 0.8, abs(q.y) + (n - 0.5) * 0.3);
    return mix(col, u_c2, cap);
  }
  if (u_kind == 2) {
    float n = fbm(q * 1.9 + s);
    vec3 col = mix(u_c0, u_c1, smoothstep(0.42, 0.62, n));
    float c = fbm(qc * vec3(2.0, 4.2, 2.0) + s * 1.3 + fbm3(qc * 3.0 + s) * 0.9);
    float cloud = smoothstep(0.46, 0.7, c);
    return mix(col, u_c2, cloud * 0.88);
  }
  // Gas and great giants: domain-warped latitude bands.
  float warp = fbm(q * vec3(1.5, 3.4, 1.5) + s);
  float lat = q.y + (warp - 0.5) * 0.11;
  float b = sin(lat * u_bands * 3.1415926);
  float b2 = sin(lat * u_bands * 5.3 + 1.3 + warp * 2.0);
  vec3 col = mix(u_c0, u_c1, smoothstep(-0.6, 0.6, b));
  col = mix(col, u_c2, smoothstep(0.55, 0.95, b2) * 0.35);
  col *= 0.95 + 0.08 * fbm3(q * vec3(3.0, 12.0, 3.0) + 5.0 + s);
  if (u_kind == 4) {
    vec3 S = normalize(vec3(0.62, -0.34, 0.7));
    vec3 t1 = normalize(vec3(-S.z, 0.0, S.x));
    vec3 dq = q - S;
    float ds = length(vec2(dot(dq, t1), dq.y * 1.9));
    float storm = 1.0 - smoothstep(0.15, 0.22, ds);
    col = mix(col, u_storm * (0.8 + 0.35 * (1.0 - ds / 0.22)), storm * 0.85);
    col = mix(col, u_c2, smoothstep(0.19, 0.22, ds) * (1.0 - smoothstep(0.22, 0.27, ds)) * 0.5);
  }
  return col;
}

void main() {
  vec2 p = v_p / u_r;
  float d = length(p);
  float px = 1.0 / (u_r * u_dpr);
  vec3 L = u_L;
  bool light = u_theme > 0.5;
  float atmS = u_kind == 0 ? 0.0 : u_kind == 1 ? 0.5 : u_kind == 2 ? 0.95 : 0.6;
  atmS *= (1.0 - u_dormant) * (1.0 + 0.7 * u_hover);
  float amb = light ? 0.42 : 0.04;

  vec4 col = vec4(0.0);

  // Light theme: a soft cast shadow away from the star.
  if (light) {
    float sh = (1.0 - smoothstep(0.78, 1.3, length(p + L.xy * 0.24))) * 0.11;
    col = vec4(u_ink * sh, sh);
  }
  // Dark theme: atmosphere glow beyond the limb, stronger on the lit side.
  if (!light && d > 1.0 && atmS > 0.0) {
    float g = exp(-(d - 1.0) * 7.5) * atmS * 0.5 * smoothstep(-0.7, 0.8, dot(p / d, normalize(L.xy + 1e-5)));
    col += vec4(u_atm * g, 0.0);
  }

  // Ring: intersect the view ray with the equatorial plane.
  vec4 ringCol = vec4(0.0);
  float zr = -1e9;
  if (u_ringOn > 0.5) {
    zr = -(u_A.x * p.x + u_A.y * p.y) / u_A.z;
    vec3 P = vec3(p, zr);
    float dens = ringDensity(length(P));
    if (dens > 0.0) {
      float b = dot(P, L);
      float disc = b * b - (dot(P, P) - 1.0);
      float shadow = b < 0.0 ? smoothstep(0.0, 0.06, disc) : 0.0;
      float lit = (amb + (1.0 - amb) * (0.4 + 0.6 * abs(dot(u_A, L)))) * (1.0 - 0.85 * shadow);
      vec3 rc = u_ringC * lit;
      if (u_dormant > 0.5) rc = vec3(dot(rc, vec3(0.3, 0.59, 0.11))) * 0.75;
      float a = dens * (u_dormant > 0.5 ? 0.6 : 1.0);
      ringCol = vec4(rc * a, a);
    }
  }

  if (d < 1.0 + px) {
    float z = sqrt(max(0.0, 1.0 - d * d));
    vec3 N = vec3(p, z);
    vec3 q = vec3(dot(N, u_E1), dot(N, -u_A), dot(N, u_E2));
    vec3 qs = rotY(q, u_rot);
    vec3 qc = rotY(q, u_cloudRot);
    vec3 alb = surface(qs, qc);
    float ndl = dot(N, L);
    float k = u_kind == 0 ? 0.045 : 0.15;
    float lit = smoothstep(-k, k, ndl) * (0.55 + 0.45 * clamp(ndl, 0.0, 1.0));
    if (u_ringOn > 0.5) {
      float t = -dot(N, u_A) / dot(L, u_A);
      if (t > 0.0) lit *= 1.0 - 0.7 * ringDensity(length(N + t * L));
    }
    // Dormant: low ambient in dark; in light the night side stays a mid-tone so the body doesn't read as a hole.
    float a0 = u_dormant > 0.5 && !light ? amb * 0.7 : amb;
    vec3 c = alb * (a0 + (1.0 - a0) * lit * (u_dormant > 0.5 && !light ? 0.7 : 1.0));
    c *= mix(0.72, 1.0, pow(z, 0.35));
    float fr = pow(1.0 - z, 2.4);
    vec3 atm = u_atm * fr * smoothstep(-0.25, 0.55, ndl) * atmS;
    c += light ? atm * 0.3 : atm;
    c *= 1.0 + 0.08 * u_hover;
    if (u_dormant > 0.5) c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))), 0.82) * (light ? 1.25 : 0.85);
    float edge = (1.0 - d) / px;
    if (light) c = mix(c, u_ink, (1.0 - smoothstep(0.0, 0.75 * u_dpr + 0.6, edge)) * 0.6);
    float a = clamp(edge + 0.5, 0.0, 1.0);
    vec4 sphere = vec4(c * a, a);
    if (zr > z) col = over(ringCol, over(sphere, col));
    else col = over(sphere, over(ringCol, col));
  } else {
    col = over(ringCol, col);
  }
  o = col * u_alpha;
}`;
