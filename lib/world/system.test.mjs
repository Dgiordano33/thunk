import assert from "node:assert/strict";
import test from "node:test";
import { LABEL_BOX, STAR_BOX, PLANET_PALETTES, TILT, orbitRadius, placePlanets, planetPalette, planetRadius, ringCapacity, systemSize } from "./system.ts";

const day = 86_400_000;
const projects = (n, start = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${start + i}`, createdAt: new Date(Date.UTC(2026, 0, 1) + (start + i) * day).toISOString() }));

test("every project gets a spot on an orbit, inner rings first", () => {
  const list = projects(30);
  const { spots, rings } = placePlanets(list);
  assert.equal(spots.size, 30);
  for (const s of spots.values()) {
    const r = orbitRadius(s.ring);
    assert.ok(Math.abs(Math.hypot(s.x, s.y / TILT) - r) < 0.05, "spot lies on its orbit");
  }
  // Rings fill from the inside: a ring can keep a gap for label clearance, but no ring is skipped entirely.
  const counts = Array.from({ length: rings }, (_, r) => [...spots.values()].filter((s) => s.ring === r).length);
  for (let r = 0; r < rings; r++) assert.ok(counts[r] > 0 && counts[r] <= ringCapacity(r), `ring ${r} holds 1..capacity planets`);
  assert.ok(counts[0] >= ringCapacity(0) - 1, "the inner ring is (nearly) full");
});

test("labels on different rings don't collide", () => {
  const { spots } = placePlanets(projects(30));
  const list = [...spots.values()];
  for (const a of list) for (const b of list) {
    if (a === b || a.ring === b.ring) continue;
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    assert.ok(Math.abs(a.x - b.x) >= 2 * LABEL_BOX.halfW || bottom.y - top.y >= LABEL_BOX.above + LABEL_BOX.below);
  }
});

test("planets on one ring keep their distance", () => {
  const { spots } = placePlanets(projects(40));
  const byRing = Map.groupBy([...spots.values()], (s) => s.ring);
  for (const [ring, list] of byRing) {
    const min = (2 * Math.PI) / ringCapacity(ring) / 2;
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      const d = Math.abs(a.angle - b.angle) % (2 * Math.PI);
      assert.ok(Math.min(d, 2 * Math.PI - d) > min);
    }
  }
});

test("older planets never move when newer projects are added", () => {
  const before = placePlanets(projects(12)).spots;
  const after = placePlanets([...projects(12), ...projects(9, 12)]).spots;
  for (const [id, spot] of before) assert.deepEqual(after.get(id), spot);
});

test("placement does not depend on input order", () => {
  const list = projects(15);
  assert.deepEqual(placePlanets(list).spots, placePlanets([...list].reverse()).spots);
});

test("the map grows with the number of rings and holds the outer orbit", () => {
  const one = systemSize(1);
  const three = systemSize(3);
  assert.ok(three.w > one.w && three.h > one.h);
  assert.ok(three.w / 2 > orbitRadius(2) && three.h / 2 > orbitRadius(2) * TILT);
});

test("sizes and palettes are bounded and stable", () => {
  assert.equal(planetRadius(0), planetRadius(1));
  assert.equal(planetRadius(9), planetRadius(5));
  assert.ok(planetRadius(1) < planetRadius(5));
  assert.equal(planetPalette("abc"), planetPalette("abc"));
  assert.ok(PLANET_PALETTES.includes(planetPalette("xyz")));
});

test("no planet or label covers the star", () => {
  const projects = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, createdAt: `2024-01-${String(i + 1).padStart(2, "0")}` }));
  for (const { x, y } of placePlanets(projects).spots.values()) {
    const apart = Math.abs(x) >= LABEL_BOX.halfW + STAR_BOX || y + LABEL_BOX.below <= -STAR_BOX || y - LABEL_BOX.above >= STAR_BOX;
    assert.ok(apart, `planet at ${x},${y} covers the star`);
  }
});
