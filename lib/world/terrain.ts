// The home-page world: a seeded isometric island. Pure, shared by server and client, and runnable under `node --test`.

export const COLS = 22;
export const ROWS = 16;
export const TILE_W = 64;
export const TILE_H = 32;
/** A map's tile dimensions. The world is one size; towns grow with their workspaces. */
export type Grid = { cols: number; rows: number };
export const WORLD: Grid = { cols: COLS, rows: ROWS };
/** Pixel size of a whole map in screen space (before zoom). */
export const mapSize = (g: Grid) => ({ w: ((g.cols + g.rows) * TILE_W) / 2, h: ((g.cols + g.rows) * TILE_H) / 2 });
export const MAP_W = mapSize(WORLD).w;
export const MAP_H = mapSize(WORLD).h;
/** Fixed so the world never reshapes itself under the user. */
export const WORLD_SEED = "thunk";

export type TerrainKind = "ocean" | "shallows" | "grass" | "plains" | "forest" | "hills" | "mountain" | "road";
export type Tile = { col: number; row: number; kind: TerrainKind; height: number; moisture: number; variant: number };
export type Cell = { col: number; row: number };

const WATER: ReadonlySet<TerrainKind> = new Set(["ocean", "shallows"]);
/** Tiles a city can be founded on. */
const SETTLEABLE: ReadonlySet<TerrainKind> = new Set(["grass", "plains", "forest", "hills"]);

export const isWater = (kind: TerrainKind) => WATER.has(kind);

/** FNV-1a: small, stable string hash. */
export function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise on a lattice of `cell`-sized squares, smoothstep-interpolated. */
export function valueNoise(seed: number, cell: number, g: Grid = WORLD) {
  const w = Math.ceil(g.cols / cell) + 2;
  const h = Math.ceil(g.rows / cell) + 2;
  const rand = mulberry32(seed);
  const lattice = Array.from({ length: w * h }, rand);
  const at = (x: number, y: number) => lattice[y * w + x];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (col: number, row: number) => {
    const x = col / cell;
    const y = row / cell;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
  };
}

function classify(height: number, moisture: number): TerrainKind {
  if (height < 0.3) return "ocean";
  if (height < 0.38) return "shallows";
  if (height > 0.84) return "mountain";
  if (height > 0.72) return "hills";
  if (moisture > 0.58) return "forest";
  if (moisture > 0.4) return "grass";
  return "plains";
}

export function generateTerrain(seed: string = WORLD_SEED): Tile[][] {
  const base = hash32(seed);
  const coarse = valueNoise(base, 5);
  const fine = valueNoise(base ^ 0x9e3779b9, 2);
  const wet = valueNoise(base ^ 0x85ebca6b, 4);
  const variants = mulberry32(base ^ 0xc2b2ae35);
  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => {
      // Distance from the centre in [0, 1] per axis, so the falloff makes one island continent.
      const dx = (col - (COLS - 1) / 2) / ((COLS - 1) / 2);
      const dy = (row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 0.78 + Math.max(Math.abs(dx), Math.abs(dy)) * 0.22);
      const edge = col === 0 || row === 0 || col === COLS - 1 || row === ROWS - 1;
      const noise = coarse(col, row) * 0.65 + fine(col, row) * 0.35;
      const height = edge ? 0 : Math.max(0, Math.min(1, noise * 0.95 + 0.38 - d * d * 0.85));
      const moisture = wet(col, row);
      return { col, row, kind: classify(height, moisture), height, moisture, variant: variants() };
    }),
  );
}

/** Centre of a tile in map pixel space. */
export function toIso(col: number, row: number, g: Grid = WORLD): { x: number; y: number } {
  return { x: ((col - row) * TILE_W) / 2 + (g.rows * TILE_W) / 2, y: ((col + row) * TILE_H) / 2 + TILE_H / 2 };
}

/** The tile's diamond as an SVG `points` string: top, right, bottom, left. */
export function isoPolygon(col: number, row: number, g: Grid = WORLD): string {
  const { x, y } = toIso(col, row, g);
  return `${x},${y - TILE_H / 2} ${x + TILE_W / 2},${y} ${x},${y + TILE_H / 2} ${x - TILE_W / 2},${y}`;
}

export const chebyshev = (a: Cell, b: Cell) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

/**
 * Found one city per project. Projects are settled oldest first, each from its own id-seeded walk, so positions are
 * deterministic and a newer project never displaces an older one.
 */
export function placeCities(projects: { id: string; createdAt: string }[], tiles: Tile[][]): Map<string, Cell> {
  const placed = new Map<string, Cell>();
  const land = tiles.flat().filter((t) => SETTLEABLE.has(t.kind));
  if (!land.length) return placed;
  const ordered = [...projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const project of ordered) {
    const rand = mulberry32(hash32(project.id));
    // Same candidate order at every spacing, so relaxing for a crowded map is still deterministic.
    const candidates = Array.from({ length: 300 }, () => land[Math.floor(rand() * land.length)]);
    let cell: Cell | undefined;
    for (const spacing of [3, 2, 1]) {
      cell = candidates.find((c) => [...placed.values()].every((p) => chebyshev(p, c) >= spacing));
      if (cell) break;
    }
    cell ??= land.find((c) => [...placed.values()].every((p) => chebyshev(p, c) >= 1)) ?? candidates[0];
    placed.set(project.id, { col: cell.col, row: cell.row });
  }
  return placed;
}

/** Culture-border radius by city level 1..5. */
export const TERRITORY_RADIUS = [1, 1, 2, 2, 3] as const;

/** Tiles inside a city's borders: everything within its radius that isn't deep ocean. */
export function territory(center: Cell, level: number, tiles: Tile[][]): Cell[] {
  const r = TERRITORY_RADIUS[Math.max(1, Math.min(5, level)) - 1];
  const cells: Cell[] = [];
  for (let row = center.row - r; row <= center.row + r; row++) {
    for (let col = center.col - r; col <= center.col + r; col++) {
      const tile = tiles[row]?.[col];
      if (tile && tile.kind !== "ocean") cells.push({ col, row });
    }
  }
  return cells;
}
