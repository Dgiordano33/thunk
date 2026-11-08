import assert from "node:assert/strict";
import test from "node:test";
import { chebyshev } from "./terrain.ts";
import { TOWN_SPACING, cropStage, layoutTown } from "./town.ts";

const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
const ws = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, slug: i === 0 ? "main" : `ws-${i}`, createdAt: day(i) }));
const sessions = (workspaceId, n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${workspaceId}-s${start + i}`, workspaceId, createdAt: day(start + i) }));

test("project is central, main is the first farmhouse, and farms keep their distance", () => {
  const workspaces = [...ws(5)].reverse();
  const town = layoutTown("p", workspaces, []);
  assert.equal(town.farmhouses[0].workspaceId, "w0");
  const mid = (town.grid.cols - 1) / 2;
  assert.deepEqual(town.center, { col: mid, row: mid });
  for (const [i, a] of town.farmhouses.entries())
    for (const b of town.farmhouses.slice(i + 1)) assert.ok(chebyshev(a.cell, b.cell) >= TOWN_SPACING);
  assert.deepEqual(layoutTown("p", workspaces, []), town, "deterministic");
});

test("the town grows to fit more workspaces", () => {
  assert.ok(layoutTown("p", ws(12), []).grid.cols > layoutTown("p", ws(3), []).grid.cols);
  for (const c of layoutTown("p", ws(12), []).farmhouses) assert.ok(c.cell.col > 2 && c.cell.col < layoutTown("p", ws(12), []).grid.cols - 3);
});

test("farms ring their own town center, never overlap, and the oldest sits nearest", () => {
  const all = [...sessions("w0", 6), ...sessions("w1", 4)];
  const town = layoutTown("p", ws(2), all);
  const keys = Object.values(town.fields).map((c) => `${c.col},${c.row}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 10);
  for (const s of all) {
    const center = town.farmhouses.find((c) => c.workspaceId === s.workspaceId).cell;
    const d = chebyshev(center, town.fields[s.id]);
    assert.ok(d >= 2 && d <= 3);
    assert.notEqual(town.tiles[town.fields[s.id].row][town.fields[s.id].col].kind, "road");
  }
  for (const b of [town.library, town.workshop]) assert.ok(!keys.includes(`${b.col},${b.row}`));
  const near = (id) => chebyshev(town.farmhouses[0].cell, town.fields[id]);
  assert.ok(near("w0-s0") <= near("w0-s5"));
});

test("adding a session never moves existing farms", () => {
  const before = layoutTown("p", ws(1), sessions("w0", 5));
  const after = layoutTown("p", ws(1), sessions("w0", 6));
  for (const [id, cell] of Object.entries(before.fields)) assert.deepEqual(after.fields[id], cell);
});

test("a full town keeps its newest sessions and counts the rest", () => {
  const town = layoutTown("p", ws(1), sessions("w0", 60));
  const placed = Object.keys(town.fields);
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

 test("dense farms never overlap reserved civic cells, roads, or each other", () => {
  const town = layoutTown("dense", ws(20), ws(20).flatMap(w => sessions(w.id, 60)));
  const fields = Object.values(town.fields);
  assert.equal(new Set(fields.map(c => `${c.col},${c.row}`)).size, fields.length);
  const buildings = [town.library, town.workshop, town.vault, town.townHall];
  assert.equal(new Set(buildings.map(c => `${c.col},${c.row}`)).size, 4);
  for (const c of buildings) {
    assert.ok(chebyshev(c, town.center) <= 2);
    assert.notEqual(town.tiles[c.row][c.col].kind, "road");
  }
  for (const c of fields) {
    assert.ok(chebyshev(c, town.center) > 2);
    for (const f of town.farmhouses) assert.ok(chebyshev(c, f.cell) > 1);
  }
  for (const f of town.farmhouses) assert.ok(chebyshev(f.cell, town.center) >= TOWN_SPACING);
  assert.equal(fields.length + Object.values(town.overflow).reduce((a,b) => a+b, 0), 1200);
});

test("new sessions do not displace neighbouring fields at spacing six", () => {
  const others = ws(8).flatMap(w => sessions(w.id, 20));
  const before = layoutTown("stable", ws(8), others);
  const after = layoutTown("stable", ws(8), [...others, ...sessions("w0", 10, 20)]);
  for (const s of others.filter(s => s.workspaceId !== "w0")) assert.deepEqual(after.fields[s.id], before.fields[s.id]);
});
