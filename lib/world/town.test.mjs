import assert from "node:assert/strict";
import test from "node:test";
import { chebyshev } from "./terrain.ts";
import { TOWN_SPACING, cropStage, layoutTown } from "./town.ts";

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
const ws = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, slug: i === 0 ? "main" : `ws-${i}`, createdAt: day(i) }));
const sessions = (workspaceId, n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${workspaceId}-s${start + i}`, workspaceId, createdAt: day(start + i) }));

test("main is the capital in the middle, other town centers keep their distance", () => {
  const workspaces = [...ws(5)].reverse();
  const town = layoutTown("p", workspaces, []);
  assert.equal(town.centers[0].workspaceId, "w0");
  assert.ok(town.centers[0].capital);
  const mid = (town.grid.cols - 1) / 2;
  assert.deepEqual(town.centers[0].cell, { col: mid, row: mid });
  for (const [i, a] of town.centers.entries())
    for (const b of town.centers.slice(i + 1)) assert.ok(chebyshev(a.cell, b.cell) >= TOWN_SPACING);
  assert.deepEqual(layoutTown("p", workspaces, []), town, "deterministic");
});

test("the town grows to fit more workspaces", () => {
  assert.ok(layoutTown("p", ws(12), []).grid.cols > layoutTown("p", ws(3), []).grid.cols);
  for (const c of layoutTown("p", ws(12), []).centers) assert.ok(c.cell.col > 2 && c.cell.col < layoutTown("p", ws(12), []).grid.cols - 3);
});

test("farms ring their own town center, never overlap, and the oldest sits nearest", () => {
  const all = [...sessions("w0", 6), ...sessions("w1", 4)];
  const town = layoutTown("p", ws(2), all);
  const keys = Object.values(town.farms).map((c) => `${c.col},${c.row}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 10);
  for (const s of all) {
    const center = town.centers.find((c) => c.workspaceId === s.workspaceId).cell;
    const d = chebyshev(center, town.farms[s.id]);
    assert.ok(d >= 2 && d <= 3);
    assert.notEqual(town.tiles[town.farms[s.id].row][town.farms[s.id].col].kind, "road");
  }
  for (const b of [town.library, town.workshop]) assert.ok(!keys.includes(`${b.col},${b.row}`));
  const near = (id) => chebyshev(town.centers[0].cell, town.farms[id]);
  assert.ok(near("w0-s0") <= near("w0-s5"));
});

test("adding a session never moves existing farms", () => {
  const before = layoutTown("p", ws(1), sessions("w0", 5));
  const after = layoutTown("p", ws(1), sessions("w0", 6));
  for (const [id, cell] of Object.entries(before.farms)) assert.deepEqual(after.farms[id], cell);
});

test("a full town keeps its newest sessions and counts the rest", () => {
  const town = layoutTown("p", ws(1), sessions("w0", 60));
  const placed = Object.keys(town.farms);
  assert.ok(placed.includes("w0-s59"));
  assert.ok(!placed.includes("w0-s0"));
  assert.equal(placed.length + town.overflow.w0, 60);
});

test("crops ripen with spend", () => {
  assert.equal(cropStage(0), 0);
  assert.equal(cropStage(0.2), 1);
  assert.equal(cropStage(1), 2);
  assert.equal(cropStage(3), 3);
  assert.equal(cropStage(50), 4);
});
