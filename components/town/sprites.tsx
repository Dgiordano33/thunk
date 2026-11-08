// Pixel-art buildings and fields for the town view. Drawn on small grids and scaled up 2× so they stay crisp.
import type { CropStage } from "@/lib/world/town";
import { TILE_H, TILE_W } from "@/lib/world/terrain";
import { DOOR, GOLD, STONE, STONE_DARK, WALL, WOOD, flag, r } from "@/components/world/pixel-parts";

export const SPRITE_SCALE = 2;

const TIMBER = "oklch(0.4 0.06 50)";
const BRICK = "oklch(0.55 0.13 35)";
const BRICK_DARK = "oklch(0.45 0.12 32)";
const SLATE = "oklch(0.48 0.1 250)";
const SLATE_LIGHT = "oklch(0.58 0.1 248)";
const WINDOW = "oklch(0.85 0.12 85)";

function Pixels({ w, h, children, className }: { w: number; h: number; children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * SPRITE_SCALE}
      height={h * SPRITE_SCALE}
      shapeRendering="crispEdges"
      className={`pixel overflow-visible ${className ?? ""}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Stepped roof: a run of rows narrowing by 2px each, from `y` up. */
const roof = (cx: number, y: number, width: number, rows: number, color: string, shade: string) =>
  Array.from({ length: rows }, (_, i) => {
    const w = Math.max(2, width - i * 2);
    return [r(cx - w / 2, y - i, w / 2, 1, color, `rl${cx},${y}-${i}`), r(cx, y - i, w / 2, 1, shade, `rr${cx},${y}-${i}`)];
  }).flat();

/** Wooden scaffolding over a building that isn't finished. */
const scaffold = (x: number, y: number, w: number, h: number) => [
  ...Array.from({ length: Math.floor(w / 5) + 1 }, (_, i) => r(x + i * 5, y, 1, h, WOOD, `sp${i}`)),
  ...Array.from({ length: Math.floor(h / 5) }, (_, i) => r(x, y + 3 + i * 5, w + 1, 1, WOOD, `sb${i}`)),
  ...Array.from({ length: Math.min(w, h) - 2 }, (_, i) => r(x + 1 + i, y + h - 2 - i, 1, 1, "oklch(0.58 0.08 60)", `sd${i}`)),
];

export const TOWN_CENTER_SIZE = { w: 48, h: 44 } as const;

/** Age of Empires-style town center: stone footing, timber hall, tall roof, banner. The capital gets corner towers. */
export function TownCenterSprite({ running = false }: { running?: boolean }) {
  const hue = 250;
  const { w, h } = TOWN_CENTER_SIZE;
  const roofColor = `oklch(0.52 0.15 ${hue})`;
  const roofShade = `oklch(0.42 0.13 ${hue})`;
  const banner = `oklch(0.68 0.2 ${hue})`;
  return (
    <Pixels w={w} h={h}>
      <ellipse cx={24} cy={41} rx={22} ry={3} fill="oklch(0 0 0 / 0.2)" />
      {[...tower(2, 40, roofColor), ...tower(39, 40, roofColor)]}
      {/* Stone footing */}
      {r(6, 32, 36, 9, STONE)}
      {r(6, 39, 36, 2, STONE_DARK)}
      {Array.from({ length: 6 }, (_, i) => r(8 + i * 6, 35, 3, 1, STONE_DARK, `st${i}`))}
      {/* Timber hall */}
      {r(9, 22, 30, 10, WALL)}
      {[9, 16, 23, 31, 38].map((x) => r(x, 22, 1, 10, TIMBER, `tb${x}`))}
      {r(9, 26, 30, 1, TIMBER)}
      {[12, 19, 27, 34].map((x) => r(x, 28, 2, 2, running ? WINDOW : DOOR, `wn${x}`))}
      {/* Roof and lookout */}
      {roof(24, 21, 36, 12, roofColor, roofShade)}
      {r(21, 4, 6, 6, WALL)}
      {r(23, 6, 2, 2, DOOR)}
      {roof(24, 3, 8, 3, roofColor, roofShade)}
      {flag(24, 1, banner)}
      {/* Gate */}
      {r(20, 33, 8, 8, DOOR)}
      {r(21, 32, 6, 1, DOOR)}
      {r(23, 33, 2, 8, "oklch(0.36 0.05 50)")}
    </Pixels>
  );
}

const tower = (x: number, ground: number, color: string) => [
  r(x, ground - 20, 7, 20, STONE, `tw${x}`),
  r(x + 6, ground - 20, 1, 20, STONE_DARK, `tws${x}`),
  r(x + 2, ground - 14, 3, 3, DOOR, `twd${x}`),
  ...roof(x + 3.5, ground - 21, 9, 4, color, color),
];

export const LIBRARY_SIZE = { w: 34, h: 32 } as const;

/** Columned stone library with a slate pediment. */
export function LibrarySprite({ building }: { building: boolean }) {
  const { w, h } = LIBRARY_SIZE;
  return (
    <Pixels w={w} h={h}>
      <ellipse cx={17} cy={29.5} rx={15} ry={2.5} fill="oklch(0 0 0 / 0.2)" />
      {r(2, 27, 30, 3, STONE_DARK)}
      {r(3, 25, 28, 2, STONE)}
      {r(5, 13, 24, 12, WALL)}
      {[6, 11, 21, 26].map((x) => [r(x, 14, 2, 11, "oklch(0.95 0.01 80)", `c${x}`), r(x + 1, 14, 1, 11, STONE, `cs${x}`)])}
      {r(14, 18, 6, 7, DOOR)}
      {r(15, 17, 4, 1, DOOR)}
      {r(4, 11, 26, 2, STONE)}
      {Array.from({ length: 7 }, (_, i) => r(3 + i * 2, 10 - i, 28 - i * 4, 1, i % 2 ? SLATE : SLATE_LIGHT, `pd${i}`))}
      {/* Open book over the door */}
      {r(14, 12, 3, 2, WINDOW)}
      {r(17, 12, 3, 2, "oklch(0.95 0.03 85)")}
      {building && scaffold(19, 6, 12, 20)}
    </Pixels>
  );
}

export const WORKSHOP_SIZE = { w: 34, h: 34 } as const;

/** Brick workshop with a saw-tooth roof, gear sign and tall chimney. */
export function WorkshopSprite({ building }: { building: boolean }) {
  const { w, h } = WORKSHOP_SIZE;
  return (
    <Pixels w={w} h={h}>
      <ellipse cx={17} cy={31.5} rx={15} ry={2.5} fill="oklch(0 0 0 / 0.2)" />
      {r(25, 4, 5, 26, BRICK_DARK)}
      {r(24, 3, 7, 2, STONE_DARK)}
      {r(3, 16, 24, 15, BRICK)}
      {Array.from({ length: 5 }, (_, i) => r(3, 18 + i * 3, 24, 1, BRICK_DARK, `br${i}`))}
      {/* Saw-tooth roof */}
      {[3, 11, 19].map((x) =>
        Array.from({ length: 5 }, (_, i) => r(x, 15 - i, 8 - i, 1, i === 0 ? STONE_DARK : SLATE, `sr${x}-${i}`)),
      )}
      {[4, 12, 20].map((x) => r(x + 4, 12, 2, 2, WINDOW, `sw${x}`))}
      {/* Gear */}
      {r(7, 20, 4, 4, GOLD)}
      {r(8, 19, 2, 6, GOLD)}
      {r(6, 21, 6, 2, GOLD)}
      {r(8, 21, 2, 2, BRICK_DARK)}
      {/* Big doors */}
      {r(15, 22, 9, 9, DOOR)}
      {r(19, 22, 1, 9, WOOD)}
      {building && scaffold(2, 10, 14, 21)}
    </Pixels>
  );
}

const IRON = "oklch(0.36 0.02 250)";
const IRON_LIGHT = "oklch(0.5 0.02 250)";

export const VAULT_SIZE = { w: 32, h: 32 } as const;

/** Squat stone strongroom: heavy blocks, stepped slate roof, an iron-banded door with a gold lock, and a pennant. Lamps glow while it's reading. */
export function VaultSprite({ busy = false }: { busy?: boolean }) {
  const { w, h } = VAULT_SIZE;
  return (
    <Pixels w={w} h={h}>
      <ellipse cx={16} cy={29.5} rx={14} ry={2.5} fill="oklch(0 0 0 / 0.2)" />
      {/* Plinth and block walls */}
      {r(2, 27, 28, 3, STONE_DARK)}
      {r(4, 14, 24, 13, STONE)}
      {[17, 21, 25].map((y) => r(4, y, 24, 1, STONE_DARK, `vr${y}`))}
      {[[8, 14], [16, 14], [24, 14], [6, 18], [12, 18], [20, 18], [26, 18], [9, 22], [23, 22]].map(([x, y]) => r(x, y, 1, 3, STONE_DARK, `vj${x},${y}`))}
      {r(27, 14, 1, 13, STONE_DARK)}
      {/* Cornice and stepped slate roof */}
      {r(3, 12, 26, 2, STONE_DARK)}
      {roof(16, 11, 26, 6, SLATE_LIGHT, SLATE)}
      {r(14, 4, 4, 2, STONE)}
      {flag(16, 4, GOLD)}
      {/* Iron-banded door with a gold lock */}
      {r(12, 18, 8, 9, IRON)}
      {r(13, 17, 6, 1, IRON)}
      {r(12, 20, 8, 1, IRON_LIGHT)}
      {r(12, 24, 8, 1, IRON_LIGHT)}
      {r(15, 21, 2, 2, GOLD)}
      {/* Barred lamps either side of the door */}
      {[6, 23].map((x) => [r(x, 19, 3, 3, busy ? WINDOW : DOOR, `vl${x}`), r(x + 1, 19, 1, 3, IRON, `vb${x}`)])}
    </Pixels>
  );
}

const CROP_COLORS: Record<CropStage, string[]> = {
  0: [],
  1: ["oklch(0.7 0.17 140)"],
  2: ["oklch(0.62 0.17 140)", "oklch(0.72 0.17 135)"],
  3: ["oklch(0.58 0.15 135)", "oklch(0.7 0.16 125)"],
  4: ["oklch(0.8 0.15 85)", "oklch(0.7 0.14 75)"],
};
const CROP_HEIGHT: Record<CropStage, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 };

/** A tilled field the size of one tile: soil, furrows, crops by stage, and a fence in the workspace's colour. */
export function FarmField({ stage, hue, selected, fallow }: { stage: CropStage; hue: number; selected: boolean; fallow: boolean }) {
  const W = TILE_W, H = TILE_H;
  const diamond = `${W / 2},1 ${W - 1},${H / 2} ${W / 2},${H - 1} 1,${H / 2}`;
  const rows = [0.18, 0.34, 0.5, 0.66, 0.82];
  const colors = CROP_COLORS[fallow ? 0 : stage];
  const height = CROP_HEIGHT[stage];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} shapeRendering="crispEdges" className="pixel overflow-visible" aria-hidden="true">
      <polygon points={diamond} fill="var(--w-soil)" />
      {rows.map((t) => {
        // Furrows run from the top-left edge to the bottom-right edge.
        const x1 = (W / 2) * t, y1 = H / 2 - (H / 2) * t;
        const x2 = W / 2 + (W / 2) * t, y2 = H - (H / 2) * t;
        const plants = colors.length
          ? Array.from({ length: 6 }, (_, i) => {
              const f = (i + 0.7) / 6.4;
              const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f;
              return (
                <rect key={i} x={Math.round(x)} y={Math.round(y) - height} width={stage >= 3 ? 2 : 1} height={Math.max(1, height)} fill={colors[i % colors.length]} />
              );
            })
          : null;
        return (
          <g key={t}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--w-soil-dark)" strokeWidth={1.5} />
            {plants}
          </g>
        );
      })}
      <polygon
        points={diamond}
        fill="none"
        stroke={selected ? "white" : `oklch(0.62 0.12 ${hue})`}
        strokeWidth={selected ? 2 : 1.5}
        strokeDasharray={selected ? "4 2" : "2 2"}
      />
    </svg>
  );
}


export const TOWN_HALL_SIZE = { w: 40, h: 36 } as const;

/** Stone civic hall with columns, a clock tower and a notice board. */
export function TownHallSprite() {
  return <Pixels w={TOWN_HALL_SIZE.w} h={TOWN_HALL_SIZE.h}>
    <ellipse cx={20} cy={33} rx={19} ry={3} fill="oklch(0 0 0 / 0.2)" />
    {r(3, 29, 34, 4, STONE_DARK)}
    {r(5, 17, 30, 12, WALL)}
    {r(17, 21, 6, 10, DOOR)}
    {[7, 13, 25, 31].map((x) => r(x, 19, 2, 10, STONE, `column${x}`))}
    {roof(20, 17, 36, 8, SLATE_LIGHT, SLATE)}
    {r(16, 4, 8, 10, WALL)}
    {r(18, 6, 4, 4, GOLD)}
    {r(20, 6, 1, 3, DOOR)}
    {r(19, 8, 2, 1, DOOR)}
    {roof(20, 3, 12, 4, SLATE_LIGHT, SLATE)}
    {r(28, 24, 7, 6, WOOD)}
    {r(29, 25, 5, 4, WALL)}
    {r(30, 26, 3, 1, DOOR)}
    {r(30, 28, 2, 1, DOOR)}
    {r(11, 31, 18, 1, STONE)}
  </Pixels>;
}

export const FARMHOUSE_SIZE = { w: 28, h: 28 } as const;

export function FarmhouseSprite({ hue, running = false }: { hue: number; running?: boolean }) {
  return <Pixels w={28} h={28}>
    <ellipse cx={14} cy={26} rx={13} ry={2} fill="oklch(0 0 0 / 0.2)" />
    {r(4, 14, 20, 12, WALL)}
    {r(4, 24, 20, 2, STONE_DARK)}
    {r(20, 5, 3, 10, BRICK)}
    {roof(14, 14, 26, 10, `oklch(0.52 0.15 ${hue})`, `oklch(0.42 0.13 ${hue})`)}
    {r(12, 19, 5, 7, DOOR)}
    {r(6, 17, 3, 4, running ? WINDOW : DOOR)}
    {running && <g className="motion-safe:animate-pulse">{r(20, 1, 3, 2, STONE)}{r(22, -2, 4, 2, STONE)}</g>}
  </Pixels>;
}
