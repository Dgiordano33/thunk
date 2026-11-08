// Pixel-art building blocks shared by city and town sprites. Coordinates are sprite pixels.

export const WALL = "oklch(0.88 0.04 80)";
export const DOOR = "oklch(0.3 0.04 50)";
export const WOOD = "oklch(0.48 0.08 55)";
export const STRAW = "oklch(0.76 0.12 85)";
export const STONE = "oklch(0.7 0.02 70)";
export const STONE_DARK = "oklch(0.52 0.02 70)";
export const GOLD = "oklch(0.83 0.15 85)";

export const r = (x: number, y: number, w: number, h: number, fill: string, key?: string) => (
  <rect key={key ?? `${x},${y},${w},${h}`} x={x} y={y} width={w} height={h} fill={fill} />
);

/** A gabled house whose bottom-left corner sits at (x, y). */
export const house = (x: number, y: number, roof: string) => [
  r(x, y - 4, 7, 4, WALL),
  r(x + 3, y - 2, 1, 2, DOOR),
  r(x + 1, y - 3, 1, 1, DOOR),
  r(x + 5, y - 9, 1, 3, STONE_DARK),
  r(x - 1, y - 5, 9, 1, roof),
  r(x, y - 6, 7, 1, roof),
  r(x + 1, y - 7, 5, 1, roof),
  r(x + 2, y - 8, 3, 1, roof),
];

export const hut = (x: number, y: number) => [
  r(x + 1, y - 3, 6, 3, "oklch(0.62 0.08 60)"),
  r(x + 3, y - 2, 2, 2, DOOR),
  r(x, y - 4, 8, 1, STRAW),
  r(x + 1, y - 5, 6, 1, STRAW),
  r(x + 2, y - 6, 4, 1, STRAW),
  r(x + 3, y - 7, 2, 1, STRAW),
];

export const flag = (x: number, y: number, color: string) => [r(x, y - 9, 1, 9, DOOR), r(x + 1, y - 9, 4, 3, color)];

