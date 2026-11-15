import assert from "node:assert/strict";
import test from "node:test";
import { PLANET_PALETTES, TILT, orbitRadius, placePlanets, planetPalette, planetRadius, ringCapacity, systemSize } from "./system.ts";

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
  const counts = Array.from({ length: rings }, (_, r) => [...spots.values()].filter((s) => s.ring === r).length);
  for (let r = 0; r < rings - 1; r++) assert.equal(counts[r], ringCapacity(r), `ring ${r} is full before ring ${r + 1} is used`);
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
