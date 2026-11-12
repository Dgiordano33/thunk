// A project seen up close: an Age of Empires-style town. Pure; shared by server and client, runnable under `node --test`.
//
// Project = the town. One Town center = the project; each active workspace = a farmhouse.
// Each session = a field around its farmhouse. Civic buildings cluster around the project center.
import { chebyshev, hash32, mulberry32, valueNoise, type Cell, type Grid, type TerrainKind, type Tile } from "./terrain.ts";

/** Tiles between neighbouring town farmhouses. Farms fill rings 2–3 around each, leaving a lane between towns. */
export const TOWN_SPACING = 6;
export const FARM_RINGS = [2, 3] as const;
/** Spend (USD) a session needs to reach crop stages 1..4. Stage 0 is freshly tilled soil. */
export const CROP_THRESHOLDS = [0.01, 0.5, 2, 5] as const;
export const CROP_NAMES = ["Tilled", "Sprouting", "Growing", "Ripening", "Harvest"] as const;

export type CropStage = 0 | 1 | 2 | 3 | 4;

export function cropStage(costUsd: number): CropStage {
  return CROP_THRESHOLDS.filter((t) => costUsd >= t).length as CropStage;
}

type WorkspaceInput = { id: string; slug: string; createdAt: string };
type SessionInput = { id: string; workspaceId: string; createdAt: string };

export type TownLayout = {
  grid: Grid;
  tiles: Tile[][];
  /** The project, independent of any workspace. */
  center: Cell;
  townHall: Cell;
  /** Main first, then oldest workspace first. */
  farmhouses: { workspaceId: string; cell: Cell }[];
  library: Cell;
  workshop: Cell;
  vault: Cell;
  studio: Cell;
  /** Farm per session id. Sessions that don't fit (oldest first) are counted in `overflow`. */
  fields: Record<string, Cell>;
  overflow: Record<string, number>;
};

const angle = (c: Cell) => Math.atan2(c.row, c.col);
const ring = (r: number): Cell[] => {
  const out: Cell[] = [];
  for (let row = -r; row <= r; row++) for (let col = -r; col <= r; col++) if (Math.max(Math.abs(col), Math.abs(row)) === r) out.push({ col, row });
  return out.sort((a, b) => angle(a) - angle(b));
};

/** Straight line of cells between two points (Bresenham). */
function line(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let { col: x, row: y } = a;
  const dx = Math.abs(b.col - x), dy = -Math.abs(b.row - y);
  const sx = x < b.col ? 1 : -1, sy = y < b.row ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push({ col: x, row: y });
    if (x === b.col && y === b.row) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

export function layoutTown(seed: string, workspaces: WorkspaceInput[], sessions: SessionInput[]): TownLayout {
  // Main first, then the oldest workspaces closest to the project center.
  const ordered = [...workspaces].sort(
    (a, b) => Number(b.slug === "main") - Number(a.slug === "main") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  let k = 1;
  while ((2 * k + 1) ** 2 - 1 < ordered.length) k++;
  const size = 2 * k * TOWN_SPACING + 17;
  const grid: Grid = { cols: size, rows: size };
  const mid = (size - 1) / 2;

  const lattice: Cell[] = [];
  for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) if (i || j) lattice.push({ col: i, row: j });
  lattice.sort((a, b) => chebyshev(a, { col: 0, row: 0 }) - chebyshev(b, { col: 0, row: 0 }) || angle(a) - angle(b));
  const farmhouses = ordered.map((w, i) => ({
    workspaceId: w.id,
    cell: { col: mid + lattice[i].col * TOWN_SPACING, row: mid + lattice[i].row * TOWN_SPACING },
  }));
  const center = { col: mid, row: mid };
  // Either side of the center, clear of its sprite.
  const library = { col: center.col - 2, row: center.row + 1 };
  const workshop = { col: center.col + 1, row: center.row - 2 };
  // Behind the center, far enough back that its nameplate clears the center's banner.
  const studio = { col: center.col + 3, row: center.row - 3 };
  const vault = { col: center.col - 4, row: center.row - 3 };
  // Off to the front-right, so it doesn't cover the center's nameplate.
  const townHall = { col: center.col + 4, row: center.row + 1 };

  const key = (c: Cell) => `${c.col},${c.row}`;
  const reserved = new Set([key(studio), key(library), key(workshop), key(vault), key(townHall)]);
  for (const d of [{ col: 0, row: 0 }, ...ring(1), ...ring(2)]) reserved.add(key({ col: mid + d.col, row: mid + d.row }));
  for (const { cell } of farmhouses) for (const d of [{ col: 0, row: 0 }, ...ring(1)]) reserved.add(key({ col: cell.col + d.col, row: cell.row + d.row }));
  const roads = new Set<string>();
  for (const { cell } of farmhouses) for (const c of line(cell, center)) if (!reserved.has(key(c))) roads.add(key(c));

  // Terrain: open fields near the towns, forest and the odd pond further out, forest along the map edge.
  const base = hash32(`town:${seed}`);
  const wet = valueNoise(base, 4, grid);
  const lumpy = valueNoise(base ^ 0x9e3779b9, 3, grid);
  const variants = mulberry32(base ^ 0xc2b2ae35);
  const tiles: Tile[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => {
      const here = { col, row };
      const near = Math.min(...farmhouses.map((c) => chebyshev(c.cell, here)), chebyshev(center, here));
      const moisture = wet(col, row);
      const height = lumpy(col, row);
      const edge = col === 0 || row === 0 || col === size - 1 || row === size - 1;
      let kind: TerrainKind;
      if (roads.has(key(here))) kind = "road";
      else if (edge) kind = "forest";
      else if (near <= 4) kind = moisture > 0.35 ? "grass" : "plains";
      else if (height < 0.2 && near > 5) kind = "shallows";
      else if (moisture > 0.58 || near > 7) kind = "forest";
      else if (height > 0.8) kind = "hills";
      else kind = moisture > 0.38 ? "grass" : "plains";
      return { col, row, kind, height, moisture, variant: variants() };
    }),
  );

  // Farms: each workspace's sessions, oldest nearest its town center. If a town is full, its newest sessions win.
  const fields: Record<string, Cell> = {};
  const overflow: Record<string, number> = {};
  for (const { workspaceId, cell } of farmhouses) {
    // Front of the town (toward the viewer) first, so the first fields aren't hidden behind the town center.
    const slots = FARM_RINGS.flatMap((r) => ring(r).sort((a, b) => b.col + b.row - (a.col + a.row) || angle(a) - angle(b)))
      .map((d) => ({ col: cell.col + d.col, row: cell.row + d.row }))
      .filter((c) => !reserved.has(key(c)) && !roads.has(key(c)) && tiles[c.row]?.[c.col]);
    // Reserve every slot, so new sessions cannot displace a neighbouring farm’s fields.
    for (const slot of slots) reserved.add(key(slot));
    const own = sessions
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const kept = own.slice(0, slots.length).reverse();
    if (own.length > kept.length) overflow[workspaceId] = own.length - kept.length;
    kept.forEach((s, i) => {
      fields[s.id] = slots[i];
      const tile = tiles[slots[i].row][slots[i].col];
      tile.kind = "plains";
    });
  }
  for (const c of [...farmhouses.map((x) => x.cell), center, library, workshop, vault, townHall, studio]) {
    const tile = tiles[c.row]?.[c.col];
    if (tile) tile.kind = "grass";
  }

  return { grid, tiles, center, townHall, farmhouses, library, workshop, vault, studio, fields, overflow };
}
