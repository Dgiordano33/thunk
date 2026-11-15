// What each planet looks like up close: its type, surface seed, tilt and spin. Pure; runnable under `node --test`.
//
// Type follows the size level, so size and character agree. Everything else comes from a hash of the id,
// so a project always looks the same, on every machine and after every reload.
import { hash32 } from "./terrain.ts";
import type { PlanetPalette } from "./system.ts";

export const BODY_KINDS = ["rock", "ice", "cloud", "gas", "giant"] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

/** Size level 1..5 → body type: rock, ice/terrestrial, cloud world, gas giant, great giant. */
export const bodyKind = (level: number): BodyKind => BODY_KINDS[Math.min(5, Math.max(1, Math.round(level))) - 1];

/** Moons are small worlds: rock or ice, picked by id. */
export const moonKind = (id: string): BodyKind => (hash32(`moon:${id}`) % 2 ? "ice" : "rock");

export type BodySpec = {
  kind: BodyKind;
  /** 0..1, offsets the surface noise. */
  seed: number;
  /** Axial tilt in radians, ±25°. */
  tilt: number;
  /** Seconds per turn, 60..180. */
  period: number;
  /** Latitude bands on gas worlds, 5..11. */
  bands: number;
  /** Secondary hue offset in degrees, ±20. */
  hueShift: number;
  /** Ring roll in radians (±12°) and its gap position (0..1); only gas and giant worlds have rings. */
  ring: { roll: number; gap: number } | null;
};

const DEG = Math.PI / 180;
/** A deterministic 0..1 value for one property of one id. */
const unit = (id: string, key: string) => (hash32(`${key}:${id}`) % 100_000) / 100_000;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function bodySpec(id: string, kind: BodyKind): BodySpec {
  const ringed = kind === "gas" || kind === "giant";
  return {
    kind,
    seed: r4(unit(id, "seed")),
    tilt: r4((unit(id, "tilt") * 2 - 1) * 25 * DEG),
    period: r4(60 + unit(id, "period") * 120),
    bands: 5 + Math.floor(unit(id, "bands") * 7),
    hueShift: r4((unit(id, "hue") * 2 - 1) * 20),
    ring: ringed ? { roll: r4((unit(id, "roll") * 2 - 1) * 12 * DEG), gap: r4(unit(id, "gap")) } : null,
  };
}

// ── Colour ──────────────────────────────────────────────────────────────
// The canvas needs RGB; the palettes are OKLCH. Standard conversion (Björn Ottosson), clamped to sRGB.

const toSrgb = (x: number) => {
  const v = Math.max(0, Math.min(1, x));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

/** OKLCH → gamma-encoded sRGB, each channel 0..1. */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos(h * DEG);
  const b = c * Math.sin(h * DEG);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    toSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    toSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

export type RGB = [number, number, number];
/** The surface colours a body is painted with: base, secondary, pale accent, atmosphere, ring, storm. */
export type BodyColors = { base: RGB; second: RGB; accent: RGB; atmosphere: RGB; ring: RGB; storm: RGB };

export function bodyColors(palette: PlanetPalette, spec: BodySpec): BodyColors {
  const { h, c } = palette;
  const h2 = h + spec.hueShift;
  switch (spec.kind) {
    case "rock":
      return {
        base: oklchToRgb(0.64, c * 0.45, h),
        second: oklchToRgb(0.48, c * 0.35, h2),
        accent: oklchToRgb(0.74, c * 0.3, h),
        atmosphere: oklchToRgb(0.8, c * 0.4, h),
        ring: oklchToRgb(0.8, 0.02, h),
        storm: oklchToRgb(0.7, 0.1, 40),
      };
    case "ice":
      return {
        base: oklchToRgb(0.5, c * 1.05, h),
        second: oklchToRgb(0.7, c * 0.75, h2 + 25),
        accent: oklchToRgb(0.95, c * 0.12, h),
        atmosphere: oklchToRgb(0.8, c * 0.9 + 0.03, h),
        ring: oklchToRgb(0.8, 0.02, h),
        storm: oklchToRgb(0.7, 0.1, 40),
      };
    case "cloud":
      return {
        base: oklchToRgb(0.52, c * 0.9, h),
        second: oklchToRgb(0.66, c * 0.7, h2),
        accent: oklchToRgb(0.96, c * 0.08, h),
        atmosphere: oklchToRgb(0.82, c * 1.1 + 0.04, h),
        ring: oklchToRgb(0.8, 0.02, h),
        storm: oklchToRgb(0.7, 0.1, 40),
      };
    default:
      // Gas and great giants: two band tones plus a pale one, a ring of dusty ice and a warm storm.
      return {
        base: oklchToRgb(0.66, c * 0.95, h),
        second: oklchToRgb(0.5, c * 0.85, h2),
        accent: oklchToRgb(0.86, c * 0.35, h - spec.hueShift * 0.5),
        atmosphere: oklchToRgb(0.82, c * 0.8 + 0.03, h),
        ring: oklchToRgb(0.82, c * 0.25 + 0.015, h + 10),
        storm: oklchToRgb(0.62, 0.13, 35),
      };
  }
}
