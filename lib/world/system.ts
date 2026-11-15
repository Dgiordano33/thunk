// The home map as a solar system: every project is a planet on a ring around one star. Pure; runnable under `node --test`.
//
// Rings fill from the inside out in creation order, so an older planet never moves when a newer one arrives.
// Orbits are drawn as tilted ellipses (`TILT`) to give the chart some depth.
import { hash32 } from "./terrain.ts";

/** Vertical squash of every orbit: 1 is a flat circle seen from above. */
export const TILT = 0.58;
/** Radius of the innermost orbit, and the gap between orbits, in map pixels. */
export const FIRST_ORBIT = 170;
export const ORBIT_GAP = 120;
/** Arc length (px) each planet reserves on its ring, so labels don't collide. */
export const PLANET_SPACING = 190;
/** Room around the outermost orbit for labels and the largest planet. */
const MARGIN_X = 200;
const MARGIN_Y = 140;

/** Sphere radius (px) for project sizes 1..5. */
export const PLANET_RADIUS = [9, 13, 18, 24, 31] as const;
export const planetRadius = (level: number) => PLANET_RADIUS[Math.min(5, Math.max(1, level)) - 1];

export type PlanetSpot = { ring: number; angle: number; x: number; y: number };

export const ringCapacity = (ring: number) => Math.max(3, Math.floor((2 * Math.PI * orbitRadius(ring)) / PLANET_SPACING));
export const orbitRadius = (ring: number) => FIRST_ORBIT + ring * ORBIT_GAP;

/** Rounded to 0.01px, so server and browser maths agree and hydration matches. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Smallest difference between two angles, in radians. */
const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

/**
 * Places projects oldest first. Each takes its own preferred angle (from its id) on the innermost ring with room,
 * nudged to the nearest free slot. Earlier planets are never revisited, so positions are stable as projects are added.
 */
export function placePlanets(projects: { id: string; createdAt: string }[]): { spots: Map<string, PlanetSpot>; rings: number } {
  const ordered = [...projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const taken: number[][] = [];
  const spots = new Map<string, PlanetSpot>();
  for (const p of ordered) {
    const preferred = ((hash32(`planet:${p.id}`) % 3600) / 3600) * 2 * Math.PI;
    for (let ring = 0; ; ring++) {
      taken[ring] ??= [];
      const cap = ringCapacity(ring);
      if (taken[ring].length >= cap) continue;
      const step = (2 * Math.PI) / cap;
      // Slots on this ring, nearest the preferred angle first.
      const slots = Array.from({ length: cap }, (_, i) => i * step + (ring % 2) * (step / 2)).sort((a, b) => gap(a, preferred) - gap(b, preferred));
      const free = slots.find((s) => taken[ring].every((t) => gap(s, t) > step / 2));
      if (free === undefined) continue;
      taken[ring].push(free);
      const r = orbitRadius(ring);
      spots.set(p.id, { ring, angle: free, x: round2(Math.cos(free) * r), y: round2(Math.sin(free) * r * TILT) });
      break;
    }
  }
  return { spots, rings: Math.max(1, taken.length) };
}

/** Map size (px) for `rings` orbits; the star sits in the middle. */
export function systemSize(rings: number) {
  const r = orbitRadius(rings - 1);
  return { w: Math.round(2 * (r + MARGIN_X)), h: Math.round(2 * (r * TILT + MARGIN_Y)) };
}

/** A planet's colours. `h` is an OKLCH hue; `c` its chroma. Mostly cool, with two warm accents. */
export type PlanetPalette = { name: string; h: number; c: number };
export const PLANET_PALETTES: readonly PlanetPalette[] = [
  { name: "ice", h: 230, c: 0.09 },
  { name: "teal", h: 195, c: 0.08 },
  { name: "indigo", h: 270, c: 0.11 },
  { name: "slate", h: 250, c: 0.035 },
  { name: "sea", h: 165, c: 0.08 },
  { name: "lavender", h: 300, c: 0.08 },
  { name: "sand", h: 75, c: 0.07 },
  { name: "rust", h: 35, c: 0.1 },
];

export const planetPalette = (id: string): PlanetPalette => PLANET_PALETTES[hash32(`palette:${id}`) % PLANET_PALETTES.length];
