// WebGL2 renderer for the solar-system look: sky, star field, orbits, the star and every body, on one canvas.
// Line art on a twilight gradient. Raw WebGL2: a handful of quads and five small programs don't need a scene graph.
import { ease } from "@/lib/ease";
import { SKY } from "@/lib/world/bodies";
import { BODY_FS, ORBIT_FS, QUAD_VS, SKY_FS, STARS_FS, STARS_VS, SUN_FS } from "./shaders";
import type { SceneBody, SceneStore } from "./scene-store";

type Program = { p: WebGLProgram; u: (name: string) => WebGLUniformLocation | null };
type Theme = 0 | 1;

const KIND_INDEX = { rock: 0, ice: 1, cloud: 2, gas: 3, giant: 4 } as const;
const STAR_COUNT = 650;
const SUN_RADIUS = 13;
/** Sparkles among the stars: the first few are large. */
const SPARKLE_COUNT = 40;
/** Map pixels between the dots of an orbit line. */
const ORBIT_DOT_GAP = 6.5;
/** Viewing elevation of planet poles: how far rings and bands open toward the viewer. */
const POLE_ELEVATION = 0.33;
/** How far (map px) floating planets bob, up and down. */
const FLOAT_AMP = 3;
const AMBIENT_FRAME_MS = 1000 / 30;

/** Entrance timeline (ms). */
const T = { sun: 600, orbitStart: 150, orbitStep: 80, orbitDur: 700, bodyStart: 300, bodyStep: 40, bodyDur: 500 };

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a_pos");
  gl.bindAttribLocation(p, 1, "a_s");
  gl.bindAttribLocation(p, 2, "a_t");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  const cache = new Map<string, WebGLUniformLocation | null>();
  return { p, u: (n) => (cache.has(n) ? cache.get(n)! : (cache.set(n, gl.getUniformLocation(p, n)), cache.get(n)!)) };
}

/** A seeded PRNG, so the star field is the same on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starData() {
  const rnd = mulberry32(0x5eed);
  const a = new Float32Array(STAR_COUNT * 8);
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = rnd();
    const layer = u < 0.55 ? 0 : u < 0.85 ? 1 : 2;
    // Power law: many faint specks, a few bright stars. Nearer layers skew brighter.
    const v = rnd();
    // Sizes of 2.5 and up are drawn as four-point sparkles (the size is the arm length); the rest are specks.
    const sparkle = i < SPARKLE_COUNT;
    const size = sparkle ? (i < 4 ? 9 + rnd() * 4 : 2.6 + 5.5 * rnd() ** 2) : 0.55 + 1.2 * Math.pow(v, 7) + layer * 0.25;
    const bright = sparkle ? 0.6 + 0.4 * rnd() : 0.22 + 0.78 * Math.pow(rnd(), 2.6) + layer * 0.08;
    a.set([rnd(), rnd(), size, Math.min(1, bright), (rnd() * 2 - 1) * (rnd() < 0.6 ? 0.4 : 1), rnd() * 6.283, 3 + rnd() * 4, layer], i * 8);
  }
  return a;
}

export type RendererHooks = { onReady: () => void; onLost: () => void; entranceStart: () => number | null };

export class SpaceRenderer {
  private gl: WebGL2RenderingContext;
  private quad!: WebGLVertexArrayObject;
  private stars!: WebGLVertexArrayObject;
  private prog!: Record<"sky" | "stars" | "orbit" | "sun" | "body", Program>;
  private size = { w: 0, h: 0, dpr: 1 };
  private theme: Theme = 1;
  private reduced: boolean;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private ambientAt = 0;
  private activeUntil = 0;
  private hover = new Map<string, number>();
  private bobbed = new Map<string, number>();
  private bodyData: SceneBody[] | null = null;
  private bodies: SceneBody[] = [];
  private t0: number | null = null;
  private ready = false;
  private disposed = false;
  private unsub: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private store: SceneStore,
    private hooks: RendererHooks,
  ) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.setup();

    const root = document.documentElement;
    const readTheme = () => {
      const t: Theme = root.classList.contains("dark") ? 0 : 1;
      if (t !== this.theme) {
        this.theme = t;
        this.invalidate();
      }
    };
    this.theme = root.classList.contains("dark") ? 0 : 1;
    const mo = new MutationObserver(readTheme);
    mo.observe(root, { attributes: true, attributeFilter: ["class"] });
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      this.reduced = mq.matches;
      this.invalidate();
    };
    mq.addEventListener("change", onMotion);
    const onVis = () => (document.hidden ? this.stop() : this.invalidate());
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      this.stop();
      this.ready = false;
      this.hooks.onLost();
    };
    const onRestored = () => {
      this.setup();
      this.invalidate();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this.unsub.push(
      () => mo.disconnect(),
      () => ro.disconnect(),
      () => mq.removeEventListener("change", onMotion),
      () => document.removeEventListener("visibilitychange", onVis),
      () => canvas.removeEventListener("webglcontextlost", onLost),
      () => canvas.removeEventListener("webglcontextrestored", onRestored),
      store.subscribe(() => {
        this.activeUntil = performance.now() + 700;
        this.invalidate();
      }),
    );
    this.resize();
  }

  private setup() {
    const gl = this.gl;
    this.prog = {
      sky: compile(gl, QUAD_VS, SKY_FS),
      stars: compile(gl, STARS_VS, STARS_FS),
      orbit: compile(gl, QUAD_VS, ORBIT_FS),
      sun: compile(gl, QUAD_VS, SUN_FS),
      body: compile(gl, QUAD_VS, BODY_FS),
    };
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.stars = gl.createVertexArray()!;
    gl.bindVertexArray(this.stars);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, starData(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) return;
    this.size = { w, h, dpr };
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.invalidate();
  }

  /** Schedule a frame. With reduced motion this draws once; otherwise it (re)starts the loop. */
  invalidate() {
    if (this.disposed || this.raf || document.hidden) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.raf = 0;
  }

  private ambient() {
    // Sleep through unused frames instead of polling every display refresh.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.invalidate();
    }, Math.max(0, Math.ceil(this.ambientAt - performance.now())));
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed || document.hidden || this.gl.isContextLost()) return;
    if (this.bodyData !== this.store.data.bodies) {
      this.bodyData = this.store.data.bodies;
      this.bodies = [...this.bodyData].sort((a, b) => a.y - b.y);
      const ids = new Set(this.bodies.map((b) => b.id));
      // A removed hovered body must not leave the renderer permanently "busy".
      for (const id of this.hover.keys()) if (!ids.has(id)) this.hover.delete(id);
      for (const id of this.bobbed.keys()) if (!ids.has(id)) this.bobbed.delete(id);
    }
    const busy = (!this.reduced && now < this.activeUntil) || this.entranceRunning(now) || this.hoverMoving();
    // RAF's timestamp can predate a timer wakeup by a display frame. Use the
    // same wall clock for pacing and the timer, and RAF time for animation only.
    const clock = performance.now();
    // Idle ambient motion runs at 30fps; panning, hovering and the entrance run at full rate.
    if (!busy && !this.reduced && clock < this.ambientAt) {
      this.ambient();
      return;
    }
    const dt = this.last ? Math.min(100, clock - this.last) : 16;
    this.last = clock;
    this.draw(now, dt);
    // Keep a cadence instead of adding timer/vsync lateness to every interval.
    // After a long pause, start fresh rather than trying to catch up old frames.
    this.ambientAt = busy || clock - this.ambientAt > AMBIENT_FRAME_MS
      ? clock + AMBIENT_FRAME_MS : this.ambientAt + AMBIENT_FRAME_MS;
    if (!this.ready) {
      this.ready = true;
      this.hooks.onReady();
    }
    if (busy || this.hoverMoving()) this.raf = requestAnimationFrame(this.tick);
    else if (!this.reduced) this.ambient();
  };

  private entranceRunning(now: number) {
    if (this.t0 === null) return true;
    if (this.reduced) return now - this.t0 < 150;
    const n = this.store.data.bodies.length;
    return now - this.t0 < T.bodyStart + n * T.bodyStep + T.bodyDur + 50;
  }

  private hoverMoving() {
    const target = this.store.hover;
    for (const [id, v] of this.hover) if (Math.abs((id === target ? 1 : 0) - v) > 0.01) return true;
    return target !== null && !this.hover.has(target) && this.bodies.some((b) => b.id === target);
  }

  private quadAt(p: Program, cx: number, cy: number, hx: number, hy: number) {
    const gl = this.gl;
    gl.uniform2f(p.u("u_res"), this.size.w, this.size.h);
    gl.uniform2f(p.u("u_center"), cx, cy);
    gl.uniform2f(p.u("u_half"), hx, hy);
  }

  /** The uniforms every pass that paints over the sky needs. */
  private skyUniforms(p: Program) {
    const gl = this.gl;
    const sky = this.theme ? SKY.light : SKY.dark;
    gl.uniform1f(p.u("u_dpr"), this.size.dpr);
    gl.uniform3fv(p.u("u_skyTop"), sky.top);
    gl.uniform3fv(p.u("u_skyBot"), sky.bottom);
  }

  private draw(now: number, dt: number) {
    const gl = this.gl;
    const { w, h, dpr } = this.size;
    if (!w) return;
    const { data, view, hover } = this.store;
    const theme = this.theme;
    const time = this.reduced ? 40 : now / 1000;

    if (this.t0 === null) this.t0 = this.hooks.entranceStart() ?? now;
    const e = now - this.t0;
    const fade = this.reduced ? ease(e / 150) : 1;
    const step = (start: number, dur: number) => (this.reduced ? fade : ease((e - start) / dur));

    // Hover tween per body.
    const k = this.reduced ? 1 : 1 - Math.exp(-dt / 70);
    for (const b of data.bodies) {
      const cur = this.hover.get(b.id) ?? 0;
      const target = b.id === hover ? 1 : 0;
      const next = cur + (target - cur) * k;
      if (next < 0.001 && target === 0) this.hover.delete(b.id);
      else this.hover.set(b.id, next);
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);
    const sky = theme ? SKY.light : SKY.dark;

    // Sky gradient.
    let p = this.prog.sky;
    gl.useProgram(p.p);
    this.quadAt(p, w / 2, h / 2, w / 2, h / 2);
    this.skyUniforms(p);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Star field.
    p = this.prog.stars;
    gl.useProgram(p.p);
    gl.uniform2f(p.u("u_res"), w, h);
    gl.uniform2f(p.u("u_pan"), view.x, view.y);
    gl.uniform1f(p.u("u_time"), time);
    gl.uniform1f(p.u("u_dpr"), dpr);
    gl.uniform1f(p.u("u_theme"), theme);
    gl.uniform1f(p.u("u_fade"), step(0, 400));
    gl.bindVertexArray(this.stars);
    gl.drawArrays(gl.POINTS, 0, STAR_COUNT);
    gl.bindVertexArray(this.quad);

    // Orbits.
    p = this.prog.orbit;
    gl.useProgram(p.p);
    gl.uniform1f(p.u("u_dpr"), dpr);
    gl.uniform3fv(p.u("u_col"), sky.orbit);
    data.orbits.forEach((o, i) => {
      const rx = o.r * view.z;
      const ry = rx * o.tilt;
      const lift = Math.max(0, ...o.bodies.map((id) => this.hover.get(id) ?? 0));
      const [near, far] = theme ? [0.5, 0.28] : [0.55, 0.3];
      this.quadAt(p, view.x + o.cx * view.z, view.y + o.cy * view.z, rx + 14, ry + 14);
      gl.uniform2f(p.u("u_R"), rx, ry);
      gl.uniform1f(p.u("u_near"), Math.min(1, near * (1 + 0.7 * lift)));
      gl.uniform1f(p.u("u_far"), Math.min(1, far * (1 + 0.7 * lift)));
      gl.uniform1f(p.u("u_prog"), step(T.orbitStart + i * T.orbitStep, T.orbitDur) * 1.04);
      gl.uniform1f(p.u("u_dots"), (Math.PI * o.r * (1 + o.tilt)) / ORBIT_DOT_GAP);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    // The star.
    if (data.star) {
      p = this.prog.sun;
      gl.useProgram(p.p);
      const rs = SUN_RADIUS * view.z;
      const reach = rs * 7.2;
      this.quadAt(p, view.x + data.star.x * view.z, view.y + data.star.y * view.z, reach, reach);
      this.skyUniforms(p);
      gl.uniform1f(p.u("u_rs"), rs);
      gl.uniform1f(p.u("u_time"), time);
      gl.uniform3fv(p.u("u_line"), sky.star);
      gl.uniform1f(p.u("u_bloom"), step(0, T.sun));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Bodies, back to front.
    p = this.prog.body;
    gl.useProgram(p.p);
    this.skyUniforms(p);
    gl.uniform1f(p.u("u_theme"), theme);
    for (const b of this.bodies) {
      const lift = this.float(b, time);
      this.drawBody(p, b, view, time, step(T.bodyStart + b.order * T.bodyStep, T.bodyDur), lift);
    }
  }

  /** Vertical bob (map px) for a floating body, mirrored onto its HTML twin so labels and hit areas move with it. */
  private float(b: SceneBody, time: number) {
    if (!b.float) return 0;
    const off = this.reduced || this.store.dragging === b.id ? 0 : FLOAT_AMP * Math.sin((time / (5 + b.spec.seed * 4)) * 2 * Math.PI + b.spec.seed * 40);
    const el = this.store.floaters.get(b.id);
    if (el) {
      const prev = this.bobbed.get(b.id);
      if (prev === undefined || Math.abs(prev - off) > 0.05) {
        el.style.translate = off ? `0 ${off.toFixed(2)}px` : "";
        this.bobbed.set(b.id, off);
      }
    }
    return off;
  }

  private drawBody(p: Program, b: SceneBody, view: { x: number; y: number; z: number }, time: number, enter: number, lift = 0) {
    const gl = this.gl;
    const { data } = this.store;
    const hv = Math.max(this.hover.get(b.id) ?? 0, this.store.dragging === b.id ? 1 : 0);
    const scale = (this.reduced ? 1 : 0.6 + 0.4 * enter) * (this.reduced ? 1 : 1 + 0.08 * hv);
    const r = b.r * view.z * scale;
    const cx = view.x + b.x * view.z;
    const cy = view.y + (b.y + lift) * view.z;
    const ring = b.spec.ring;
    const ringR: [number, number] = b.spec.kind === "giant" ? [1.35, 2.35] : [1.4, 2.05];
    const reach = Math.max(ring ? ringR[1] : 0, 1) * r + 3;
    if (cx + reach < 0 || cy + reach < 0 || cx - reach > this.size.w || cy - reach > this.size.h) return;

    // Light direction: toward the star, tipped toward the viewer so the night side is a crescent; or the fixed key light.
    let lx: number, ly: number;
    if (data.star) {
      const dx = data.star.x - b.x;
      const dy = data.star.y - b.y;
      const len = Math.hypot(dx, dy) || 1;
      lx = dx / len;
      ly = dy / len;
    } else {
      const a = data.keyLight ?? -2.3;
      lx = Math.cos(a);
      ly = Math.sin(a);
    }
    const lz = 0.6;
    const ln = Math.hypot(lx * 0.85, ly * 0.85, lz);

    // Body frame: pole tipped toward the viewer, rolled by the axial tilt.
    const roll = b.spec.tilt;
    const elev = POLE_ELEVATION + (ring ? ring.roll * 0.9 : 0);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const ce = Math.cos(elev), se = Math.sin(elev);
    // A = Rz(roll) · (0, -cos e, sin e); E1 = Rz(roll) · (1, 0, 0); E2 = A × E1.
    const A = [sr * ce, -cr * ce, se];
    const E1 = [cr, sr, 0];
    const E2 = [A[1] * E1[2] - A[2] * E1[1], A[2] * E1[0] - A[0] * E1[2], A[0] * E1[1] - A[1] * E1[0]];

    const spin = ((time / b.spec.period) * 2 * Math.PI + b.spec.seed * 2 * Math.PI) % (2 * Math.PI);
    const c = b.colors;
    // Hatching runs across the light, a little off square.
    const hatch = Math.atan2(ly, lx) + (55 * Math.PI) / 180;
    this.quadAt(p, cx, cy, reach, reach);
    gl.uniform1f(p.u("u_r"), r);
    gl.uniform1i(p.u("u_kind"), KIND_INDEX[b.spec.kind]);
    gl.uniform3fv(p.u("u_line"), this.theme ? c.lineLight : c.lineDark);
    gl.uniform3fv(p.u("u_fill"), this.theme ? c.fillLight : c.fillDark);
    gl.uniform3fv(p.u("u_shade"), this.theme ? c.shadeLight : c.shadeDark);
    gl.uniform2f(p.u("u_hatch"), Math.cos(hatch), Math.sin(hatch));
    gl.uniform3f(p.u("u_L"), (lx * 0.85) / ln, (ly * 0.85) / ln, lz / ln);
    gl.uniform3fv(p.u("u_A"), A);
    gl.uniform3fv(p.u("u_E1"), E1);
    gl.uniform3fv(p.u("u_E2"), E2);
    gl.uniform1f(p.u("u_rot"), spin);
    gl.uniform1f(p.u("u_seed"), b.spec.seed);
    gl.uniform1f(p.u("u_bands"), b.spec.bands);
    gl.uniform1f(p.u("u_ringOn"), ring ? 1 : 0);
    gl.uniform2f(p.u("u_ringR"), ringR[0], ringR[1]);
    gl.uniform1f(p.u("u_ringGap"), b.spec.kind === "giant" && ring ? 0.5 + ring.gap * 0.2 : -1);
    gl.uniform1f(p.u("u_alpha"), enter);
    gl.uniform1f(p.u("u_hover"), hv);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    this.disposed = true;
    this.stop();
    for (const el of this.store.floaters.values()) el.style.translate = "";
    for (const fn of this.unsub) fn();
  }
}
