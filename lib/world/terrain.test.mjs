import assert from "node:assert/strict";
import test from "node:test";
import { COLS, ROWS, generateTerrain, isWater, placeCities, territory } from "./terrain.ts";

const projects = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `project-${start + i}`, createdAt: new Date(Date.UTC(2026, 0, 1 + start + i)).toISOString() }));
const distance = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

test("the same seed always grows the same island, ringed by water", () => {
  const a = generateTerrain("seed");
  assert.deepEqual(a, generateTerrain("seed"));
  assert.notDeepEqual(a, generateTerrain("other"));
  assert.equal(a.length, ROWS);
  assert.ok(a.every((row) => row.length === COLS));
  const world = generateTerrain();
  for (const tile of world.flat()) {
    if (tile.col === 0 || tile.row === 0 || tile.col === COLS - 1 || tile.row === ROWS - 1) assert.ok(isWater(tile.kind));
  }
  assert.ok(world.flat().filter((t) => !isWater(t.kind)).length > 60, "the continent has room for cities");
});

test("cities are deterministic, on settleable land, and spaced apart", () => {
  const tiles = generateTerrain();
  const list = projects(8);
  const placed = placeCities(list, tiles);
  assert.deepEqual([...placed], [...placeCities([...list].reverse(), tiles)]);
  assert.equal(placed.size, list.length);
  const cells = [...placed.values()];
  for (const cell of cells) assert.ok(["grass", "plains", "forest", "hills"].includes(tiles[cell.row][cell.col].kind));
  for (const [i, a] of cells.entries()) for (const b of cells.slice(i + 1)) assert.ok(distance(a, b) >= 3);
});

test("founding a new city never moves the old ones", () => {
  const tiles = generateTerrain();
  const before = placeCities(projects(5), tiles);
  const after = placeCities([...projects(5), ...projects(3, 5)], tiles);
  for (const [id, cell] of before) assert.deepEqual(after.get(id), cell);
});

test("a crowded map still settles everyone on distinct land tiles", () => {
  const tiles = generateTerrain();
  const placed = placeCities(projects(40), tiles);
  assert.equal(placed.size, 40);
  const keys = new Set([...placed.values()].map((c) => `${c.col},${c.row}`));
  assert.equal(keys.size, 40);
  for (const c of placed.values()) assert.ok(!isWater(tiles[c.row][c.col].kind));
});

test("borders widen with level and skip deep ocean", () => {
  const tiles = generateTerrain();
  const center = [...placeCities(projects(1), tiles).values()][0];
  assert.ok(territory(center, 1, tiles).length <= 9);
  assert.ok(territory(center, 5, tiles).length > territory(center, 3, tiles).length);
  for (const c of territory(center, 5, tiles)) assert.notEqual(tiles[c.row][c.col].kind, "ocean");
});
