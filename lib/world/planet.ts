// One project seen up close: the planet in the middle, each workspace you made a moon, each session a satellite of its moon.
// The project's own workspaces (home and automatic ones, hidden from the sidebar) aren't moons: their sessions orbit the planet.
// Pure; shared by server and client, runnable under `node --test`.
import { TILT, round2 } from "./system.ts";

/** Moon orbits: radius of the first, gap between them, and how many moons each holds (4, 8, 12, …). */
export const FIRST_MOON_ORBIT = 230;
export const MOON_ORBIT_GAP = 150;
export const moonCapacity = (ring: number) => 4 * (ring + 1);
export const moonOrbitRadius = (ring: number) => FIRST_MOON_ORBIT + ring * MOON_ORBIT_GAP;

/** Satellite slots around a moon: an inner and an outer loop. Sessions beyond these are counted in `overflow`. */
export const SATELLITE_RINGS = [{ r: 30, slots: 5 }, { r: 46, slots: 7 }] as const;
export const MAX_SATELLITES = SATELLITE_RINGS.reduce((n, s) => n + s.slots, 0);

/** Spend (USD) a session needs to reach steps 1..4; the satellite grows with each. */
export const SPEND_THRESHOLDS = [0.01, 0.5, 2, 5] as const;
export type SpendStep = 0 | 1 | 2 | 3 | 4;
export const spendStep = (costUsd: number) => SPEND_THRESHOLDS.filter((t) => costUsd >= t).length as SpendStep;
export const SATELLITE_RADIUS = [2.5, 3, 3.75, 4.5, 5.5] as const;

/** Planet radius in the planet view. */
export const CORE_RADIUS = 58;

/** Satellite slots around the planet, clear of its disk (r × TILT > CORE_RADIUS). The front arc is left open for the label. */
export const CORE_SATELLITE_RINGS = [{ r: 118, slots: 9 }, { r: 146, slots: 11 }] as const;
export const CORE_LABEL_GAP = 0.8;
export const MAX_CORE_SATELLITES = CORE_SATELLITE_RINGS.reduce((n, s) => n + s.slots, 0);

type WorkspaceInput = { id: string; slug: string; createdAt: string; visibility?: "project" | "workspace" };
type SessionInput = { id: string; workspaceId: string; createdAt: string };
export type Point = { x: number; y: number };

export type PlanetLayout = {
  w: number;
  h: number;
  /** The planet, in map pixels. */
  core: Point;
  /** Orbit radius (before tilt) of every moon ring in use. */
  orbits: number[];
  /** Oldest first. */
  moons: { workspaceId: string; ring: number; angle: number; x: number; y: number }[];
  satellites: Record<string, Point>;
  /** Sessions per moon that didn't get a slot. */
  overflow: Record<string, number>;
  /** Sessions of the project's own workspaces that didn't get a slot around the planet. */
  coreOverflow: number;
};

/** Kept under the project rather than listed as a workspace: the home workspace and automatic ones. Matches the sidebar. */
export const isProjectWorkspace = (w: { slug: string; visibility?: string }) => w.visibility === "project" || w.slug === "main";

const MARGIN_X = 170;
const MARGIN_Y = 150;

export function layoutPlanet(workspaces: WorkspaceInput[], sessions: SessionInput[]): PlanetLayout {
  const ordered = workspaces.filter((w) => !isProjectWorkspace(w)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // Fixed slots per ring: moon n always lands in the same place while the moons before it remain.
  const slots: { ring: number; angle: number }[] = [];
  for (let ring = 0; slots.length < ordered.length; ring++) {
    const cap = moonCapacity(ring);
    // Start front-right (toward the viewer) and stagger alternate rings so moons don't line up radially.
    const start = Math.PI / 5 + (ring % 2) * (Math.PI / cap);
    for (let i = 0; i < cap; i++) slots.push({ ring, angle: start + (i * 2 * Math.PI) / cap });
  }
  const rings = ordered.length ? slots[ordered.length - 1].ring + 1 : 1;
  const outer = moonOrbitRadius(rings - 1) + SATELLITE_RINGS.at(-1)!.r;
  const w = Math.round(2 * (outer + MARGIN_X));
  const h = Math.round(2 * (outer * TILT + MARGIN_Y));
  const core = { x: w / 2, y: h / 2 };

  const moons = ordered.map((ws, i) => {
    const { ring, angle } = slots[i];
    const r = moonOrbitRadius(ring);
    return { workspaceId: ws.id, ring, angle, x: round2(core.x + Math.cos(angle) * r), y: round2(core.y + Math.sin(angle) * r * TILT) };
  });

  const loops = SATELLITE_RINGS.flatMap(({ r, slots: n }, k) =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (k * Math.PI) / n + (i * 2 * Math.PI) / n;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * TILT };
    }),
  );
  // Around the planet: from just past the label, clockwise over the back to just before it.
  const coreLoops = CORE_SATELLITE_RINGS.flatMap(({ r, slots: n }) =>
    Array.from({ length: n }, (_, i) => {
      const a = Math.PI / 2 + CORE_LABEL_GAP + ((i + 0.5) * (2 * Math.PI - 2 * CORE_LABEL_GAP)) / n;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * TILT };
    }),
  );
  const satellites: Record<string, Point> = {};
  const overflow: Record<string, number> = {};
  // The newest sessions are shown; oldest of those takes the first slot.
  const place = (own: SessionInput[], at: Point, slots: Point[]) => {
    const kept = [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).slice(0, slots.length).reverse();
    kept.forEach((s, i) => (satellites[s.id] = { x: round2(at.x + slots[i].x), y: round2(at.y + slots[i].y) }));
    return own.length - kept.length;
  };
  for (const moon of moons) {
    const extra = place(sessions.filter((s) => s.workspaceId === moon.workspaceId), moon, loops);
    if (extra > 0) overflow[moon.workspaceId] = extra;
  }
  const projectIds = new Set(workspaces.filter(isProjectWorkspace).map((w) => w.id));
  const coreOverflow = place(sessions.filter((s) => projectIds.has(s.workspaceId)), core, coreLoops);

  return { w, h, core, orbits: Array.from({ length: rings }, (_, i) => moonOrbitRadius(i)), moons, satellites, overflow, coreOverflow };
}
