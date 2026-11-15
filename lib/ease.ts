// The one UI easing curve, cubic-bezier(0.22, 1, 0.36, 1), for motion driven from script (camera tweens, canvas uniforms).
// CSS uses the same curve as `--ease-space`.

const X1 = 0.22, Y1 = 1, X2 = 0.36, Y2 = 1;
const bez = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
const dbez = (t: number, a: number, b: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;

/** Progress 0..1 in, eased 0..1 out. */
export function ease(x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Newton's method on x(t), then y(t). Five steps is plenty for UI.
  let t = x;
  for (let i = 0; i < 5; i++) {
    const d = dbez(t, X1, X2);
    if (Math.abs(d) < 1e-6) break;
    t -= (bez(t, X1, X2) - x) / d;
    t = Math.min(1, Math.max(0, t));
  }
  return bez(t, Y1, Y2);
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
