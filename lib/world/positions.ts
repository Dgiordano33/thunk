// Where planets float on the home map. Pure; runnable under `node --test`.
//
// Every project starts at its spot from `placePlanets` (stable as projects are added, labels kept clear); no orbit lines
// are drawn, so they just float around the star. Once someone drags a planet, its offset from the star is saved in a cookie, so the server
// renders the same layout the browser will and hydration matches.
import { placePlanets, systemSize } from "./system.ts";

export const POSITIONS_COOKIE = "thunk.planets";
/** A year: a layout is a preference, not a session. */
export const POSITIONS_MAX_AGE = 60 * 60 * 24 * 365;

/** Offset from the star, in map pixels. */
export type Offset = { x: number; y: number };

/** Free space around the planets: the map is never smaller than this, so there is room to rearrange. */
const MIN_W = 1200;
const MIN_H = 760;
/** How close (px) a planet may come to the map's edge (labels hang below, so more room at the bottom). */
export const EDGE = { x: 110, top: 70, bottom: 110 } as const;
/** Planets keep this far (px) from the star. */
export const STAR_CLEARANCE = 70;

/** Cookie keys: ids are UUIDs, the first 10 characters are plenty to tell a few hundred projects apart. */
export const positionKey = (id: string) => id.slice(0, 10);

/** `key:x,y;key:x,y` — compact, cookie-safe (keys are [A-Za-z0-9_-]). */
export function encodePositions(saved: Record<string, Offset>) {
  return Object.entries(saved)
    .filter(([k]) => /^[\w-]+$/.test(k))
    .map(([k, p]) => `${k}:${Math.round(p.x)},${Math.round(p.y)}`)
    .join(";");
}

export function decodePositions(raw: string | null | undefined): Record<string, Offset> {
  const out: Record<string, Offset> = {};
  if (!raw) return out;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch { /* already plain */ }
  for (const part of text.split(";")) {
    const m = /^([\w-]+):(-?\d+),(-?\d+)$/.exec(part.trim());
    if (m) out[m[1]] = { x: Number(m[2]), y: Number(m[3]) };
  }
  return out;
}

/** Keeps an offset inside the map (`w`×`h`, star in the middle) and out of the star. */
export function clampOffset(p: Offset, w: number, h: number): Offset {
  let x = Math.max(-w / 2 + EDGE.x, Math.min(w / 2 - EDGE.x, p.x));
  let y = Math.max(-h / 2 + EDGE.top, Math.min(h / 2 - EDGE.bottom, p.y));
  const d = Math.hypot(x, y);
  if (d < STAR_CLEARANCE) {
    const a = d ? Math.atan2(y, x) : Math.PI / 2;
    x = Math.cos(a) * STAR_CLEARANCE;
    y = Math.sin(a) * STAR_CLEARANCE;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Every project's offset from the star, and the map size. Saved offsets win; the rest use their default spot.
 * The size only grows to fit saved offsets, and drags are clamped inside it, so dropping a planet never resizes the map.
 */
export function floatLayout(projects: { id: string; createdAt: string }[], saved: Record<string, Offset>) {
  const { spots, rings } = placePlanets(projects);
  const base = systemSize(rings);
  const offsets = new Map<string, Offset>();
  let w = Math.max(MIN_W, base.w);
  let h = Math.max(MIN_H, base.h);
  for (const p of projects) {
    const own = saved[positionKey(p.id)];
    if (own) {
      w = Math.max(w, 2 * (Math.abs(own.x) + EDGE.x));
      h = Math.max(h, 2 * (Math.max(own.y > 0 ? own.y + EDGE.bottom : -own.y + EDGE.top, 0)));
    }
  }
  for (const p of projects) {
    const own = saved[positionKey(p.id)];
    const s = spots.get(p.id);
    if (own) offsets.set(p.id, clampOffset(own, w, h));
    else if (s) offsets.set(p.id, clampOffset({ x: s.x, y: s.y }, w, h));
  }
  return { offsets, w: Math.round(w), h: Math.round(h) };
}
