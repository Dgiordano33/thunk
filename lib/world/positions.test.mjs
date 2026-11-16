import assert from "node:assert/strict";
import test from "node:test";
import { LABEL_BOX } from "./system.ts";
import { EDGE, STAR_CLEARANCE, clampOffset, decodePositions, encodePositions, floatLayout, positionKey } from "./positions.ts";

const day = 86_400_000;
const projects = (n) => Array.from({ length: n }, (_, i) => ({ id: `project-${i}-0000-0000`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * day).toISOString() }));

test("positions round-trip through the cookie format", () => {
  const saved = { abc: { x: 12.4, y: -80.6 }, "d-e_f": { x: -300, y: 0 } };
  assert.deepEqual(decodePositions(encodePositions(saved)), { abc: { x: 12, y: -81 }, "d-e_f": { x: -300, y: 0 } });
  assert.deepEqual(decodePositions(encodeURIComponent(encodePositions(saved))), decodePositions(encodePositions(saved)));
  assert.deepEqual(decodePositions("garbage;;x:1;y:1,2,3"), {});
  assert.deepEqual(decodePositions(undefined), {});
});

test("every project gets an offset, and the default layout is stable", () => {
  const list = projects(12);
  const a = floatLayout(list, {});
  const b = floatLayout(list, {});
  assert.equal(a.offsets.size, 12);
  assert.deepEqual([...a.offsets], [...b.offsets]);
  const first = floatLayout(list.slice(0, 6), {});
  for (const [id, p] of first.offsets) assert.deepEqual(a.offsets.get(id), p, "adding projects doesn't move earlier ones");
});

test("the default layout keeps labels clear", () => {
  const { offsets } = floatLayout(projects(24), {});
  const list = [...offsets.values()];
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    const sameRing = Math.abs(Math.hypot(a.x, a.y / 0.58) - Math.hypot(b.x, b.y / 0.58)) < 60;
    if (!sameRing) assert.ok(Math.abs(a.x - b.x) >= 2 * LABEL_BOX.halfW || bottom.y - top.y >= LABEL_BOX.above + LABEL_BOX.below);
  }
});

test("saved offsets win and stay inside the map", () => {
  const list = projects(4);
  const key = positionKey(list[0].id);
  const { offsets, w, h } = floatLayout(list, { [key]: { x: 400, y: -200 } });
  assert.deepEqual(offsets.get(list[0].id), { x: 400, y: -200 });
  for (const p of offsets.values()) {
    assert.ok(Math.abs(p.x) <= w / 2 - EDGE.x);
    assert.ok(p.y >= -h / 2 + EDGE.top && p.y <= h / 2 - EDGE.bottom);
  }
});

test("dropping inside the map never changes its size", () => {
  const list = projects(5);
  const before = floatLayout(list, {});
  const drop = clampOffset({ x: 99_999, y: 99_999 }, before.w, before.h);
  const after = floatLayout(list, { [positionKey(list[2].id)]: drop });
  assert.equal(after.w, before.w);
  assert.equal(after.h, before.h);
});

test("planets keep clear of the star", () => {
  const p = clampOffset({ x: 3, y: 4 }, 1200, 800);
  assert.ok(Math.hypot(p.x, p.y) >= STAR_CLEARANCE - 1);
  const zero = clampOffset({ x: 0, y: 0 }, 1200, 800);
  assert.ok(Math.hypot(zero.x, zero.y) >= STAR_CLEARANCE - 1);
});
