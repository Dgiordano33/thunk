"use client";

import { memo, useMemo } from "react";
import type { WorldCity } from "@/lib/world/cities";
import { MAP_H, MAP_W, TILE_H, TILE_W, generateTerrain, isWater, isoPolygon, toIso, type Tile } from "@/lib/world/terrain";

const HW = TILE_W / 2;
const HH = TILE_H / 2;
/** Height of the cliff drawn where land meets water. */
const CLIFF = 6;

const pts = (list: [number, number][]) => list.map(([x, y]) => `${x},${y}`).join(" ");

/** Terrain detail drawn on top of a tile, around its centre. Variant picks between looks so the map isn't uniform. */
function Glyph({ tile }: { tile: Tile }) {
  const { x, y } = toIso(tile.col, tile.row);
  const v = tile.variant;
  switch (tile.kind) {
    case "forest": {
      const trees: [number, number][] = v < 0.33 ? [[-12, 0], [8, -3], [-1, 7]] : v < 0.66 ? [[-6, -3], [10, 2], [-14, 5], [2, 8]] : [[-9, 1], [5, -2], [12, 6]];
      return (
        <g>
          {trees.map(([dx, dy]) => (
            <g key={`${dx},${dy}`}>
              <rect x={x + dx - 1} y={y + dy} width={2} height={3} fill="var(--w-cliff)" />
              <polygon points={pts([[x + dx, y + dy - 13], [x + dx + 6, y + dy + 1], [x + dx - 6, y + dy + 1]])} fill="var(--w-tree)" />
              <polygon points={pts([[x + dx, y + dy - 13], [x + dx + 2, y + dy - 6], [x + dx - 3, y + dy - 4]])} fill="oklch(1 0 0 / 0.12)" />
            </g>
          ))}
        </g>
      );
    }
    case "hills":
      return (
        <g>
          <polygon points={pts([[x - 18, y + 4], [x - 12, y - 4], [x - 4, y - 8], [x + 4, y - 8], [x + 12, y - 4], [x + 18, y + 4]])} fill="var(--w-hump)" />
          <polygon points={pts([[x - 12, y - 4], [x - 4, y - 8], [x + 2, y - 8], [x - 6, y - 3]])} fill="oklch(1 0 0 / 0.14)" />
          {v > 0.5 && <polygon points={pts([[x + 4, y + 6], [x + 10, y + 1], [x + 16, y + 1], [x + 21, y + 6]])} fill="var(--w-hump)" />}
        </g>
      );
    case "mountain": {
      const peak = (dx: number, dy: number, s: number) => (
        <g key={`${dx}`}>
          <polygon points={pts([[x + dx, y + dy - 24 * s], [x + dx + 18 * s, y + dy + 4], [x + dx - 18 * s, y + dy + 4]])} fill="var(--w-rock)" />
          <polygon points={pts([[x + dx, y + dy - 24 * s], [x + dx + 18 * s, y + dy + 4], [x + dx + 3 * s, y + dy + 4]])} fill="var(--w-mountain)" />
          <polygon
            points={pts([[x + dx, y + dy - 24 * s], [x + dx + 6 * s, y + dy - 15 * s], [x + dx + 1, y + dy - 17 * s], [x + dx - 3 * s, y + dy - 13 * s], [x + dx - 6 * s, y + dy - 15 * s]])}
            fill="var(--w-snow)"
          />
        </g>
      );
      return <g>{v > 0.45 ? [peak(-8, 2, 0.7), peak(6, 0, 1)] : [peak(0, 0, 1)]}</g>;
    }
    case "plains":
      return (
        <g fill="var(--w-hump)" opacity={0.55}>
          <rect x={x - 12 + v * 6} y={y - 3} width={3} height={1} />
          <rect x={x + 4} y={y + 2 - v * 4} width={3} height={1} />
          <rect x={x - 4} y={y + 6} width={2} height={1} />
        </g>
      );
    case "grass":
      return v > 0.55 ? (
        <g fill="var(--w-tree)" opacity={0.45}>
          <rect x={x - 6 + v * 8} y={y - 2} width={1} height={3} />
          <rect x={x - 4 + v * 8} y={y - 3} width={1} height={4} />
          <rect x={x - 2 + v * 8} y={y - 2} width={1} height={3} />
        </g>
      ) : null;
    case "ocean":
    case "shallows":
      return v > 0.62 ? (
        <g className="wave" style={{ animationDelay: `${(v * 3).toFixed(2)}s` }}>
          <rect x={x - 8} y={y} width={4} height={1} />
          <rect x={x - 4} y={y - 1} width={4} height={1} />
          <rect x={x} y={y} width={4} height={1} />
        </g>
      ) : null;
  }
}

function Cliffs({ tile, tiles }: { tile: Tile; tiles: Tile[][] }) {
  const { x, y } = toIso(tile.col, tile.row);
  const below = tiles[tile.row + 1]?.[tile.col];
  const right = tiles[tile.row]?.[tile.col + 1];
  return (
    <>
      {(!below || isWater(below.kind)) && (
        <polygon points={pts([[x - HW, y], [x, y + HH], [x, y + HH + CLIFF], [x - HW, y + CLIFF]])} fill="var(--w-cliff)" />
      )}
      {(!right || isWater(right.kind)) && (
        <polygon points={pts([[x, y + HH], [x + HW, y], [x + HW, y + CLIFF], [x, y + HH + CLIFF]])} fill="var(--w-cliff)" opacity={0.8} />
      )}
    </>
  );
}

/** Civ-style culture border: a tinted wash over the territory and a dashed line around its outer edge. */
function Border({ city }: { city: WorldCity }) {
  const inside = new Set(city.territory.map((c) => `${c.col},${c.row}`));
  const has = (col: number, row: number) => inside.has(`${col},${row}`);
  const edges: string[] = [];
  for (const { col, row } of city.territory) {
    const { x, y } = toIso(col, row);
    const top = `${x},${y - HH}`, right = `${x + HW},${y}`, bottom = `${x},${y + HH}`, left = `${x - HW},${y}`;
    if (!has(col, row - 1)) edges.push(`M${top}L${right}`);
    if (!has(col + 1, row)) edges.push(`M${right}L${bottom}`);
    if (!has(col, row + 1)) edges.push(`M${bottom}L${left}`);
    if (!has(col - 1, row)) edges.push(`M${left}L${top}`);
  }
  const color = `oklch(0.72 0.17 ${city.hue})`;
  return (
    <g>
      {city.territory.map(({ col, row }) => (
        <polygon key={`${col},${row}`} points={isoPolygon(col, row)} fill={color} opacity={0.2} />
      ))}
      <path d={edges.join("")} stroke={color} strokeWidth={2} strokeDasharray="5 3" fill="none" />
    </g>
  );
}

export const TerrainLayer = memo(function TerrainLayer({ cities }: { cities: WorldCity[] }) {
  const tiles = useMemo(() => generateTerrain(), []);
  // Painter's order: water first so land cliffs overlap it, then back-to-front by diagonal.
  const ordered = useMemo(() => {
    const flat = tiles.flat();
    const byDepth = (a: Tile, b: Tile) => a.col + a.row - (b.col + b.row) || a.col - b.col;
    return [...flat.filter((t) => isWater(t.kind)).sort(byDepth), ...flat.filter((t) => !isWater(t.kind)).sort(byDepth)];
  }, [tiles]);

  return (
    <svg
      width={MAP_W}
      height={MAP_H + CLIFF}
      viewBox={`0 0 ${MAP_W} ${MAP_H + CLIFF}`}
      shapeRendering="crispEdges"
      className="pixel absolute top-0 left-0 overflow-visible"
      aria-hidden="true"
    >
      {ordered.map((tile) => (
        <g key={`${tile.col},${tile.row}`}>
          {!isWater(tile.kind) && <Cliffs tile={tile} tiles={tiles} />}
          <polygon
            points={isoPolygon(tile.col, tile.row)}
            className={`t-${tile.kind}${tile.variant > 0.5 ? "-alt" : ""}${isWater(tile.kind) ? "" : " t-tile"}`}
          />
          <Glyph tile={tile} />
        </g>
      ))}
      {cities.map((city) => (
        <Border key={city.project.id} city={city} />
      ))}
    </svg>
  );
});
