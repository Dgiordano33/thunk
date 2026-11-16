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
/**
 * The inks a body is drawn with, per theme: its outline and surface lines, the tint that fills the disc,
 * and the lighter tint of its hatched night side. Line art, so three colours are the whole palette.
 */
export type BodyColors = { lineDark: RGB; fillDark: RGB; shadeDark: RGB; lineLight: RGB; fillLight: RGB; shadeLight: RGB };

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `dormant` bodies keep their shape but lose their colour. */
export function bodyColors(palette: PlanetPalette, spec: BodySpec, dormant = false): BodyColors {
  const { h } = palette;
  const c = dormant ? 0.008 : palette.c;
  const h2 = h + spec.hueShift;
  const fillDark = oklchToRgb(0.25, c * 0.85, h2);
  const fillLight = oklchToRgb(0.95, c * 0.55, h2);
  return {
    lineDark: oklchToRgb(dormant ? 0.58 : 0.86, c * 1.25, h),
    fillDark,
    shadeDark: mix(fillDark, oklchToRgb(0.8, c * 1.4, h), 0.26),
    lineLight: oklchToRgb(dormant ? 0.6 : 0.42, c * 1.5, h),
    fillLight,
    shadeLight: mix(fillLight, oklchToRgb(0.5, c * 1.4, h), 0.2),
  };
}

/** The sky behind the map, top and bottom of a vertical gradient, and the star's ink. Mirrored in app/globals.css. */
export const SKY = {
  dark: { top: oklchToRgb(0.14, 0.055, 265), bottom: oklchToRgb(0.215, 0.1, 302), star: oklchToRgb(0.93, 0.11, 95), orbit: oklchToRgb(0.82, 0.06, 250) },
  light: { top: oklchToRgb(0.962, 0.022, 250), bottom: oklchToRgb(0.972, 0.032, 330), star: oklchToRgb(0.62, 0.15, 70), orbit: oklchToRgb(0.3, 0.08, 265) },
} as const;
