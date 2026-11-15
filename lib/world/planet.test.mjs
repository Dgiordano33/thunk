import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SATELLITES, SPEND_THRESHOLDS, layoutPlanet, moonCapacity, moonOrbitRadius, spendStep } from "./planet.ts";
import { TILT } from "./system.ts";

const at = (i) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString();
const ws = (n) => [{ id: "w-main", slug: "main", createdAt: at(50) }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `w${i}`, slug: `ws-${i}`, createdAt: at(i) }))];
const sessions = (workspaceId, n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${workspaceId}-s${from + i}`, workspaceId, createdAt: at(100 + from + i) }));

test("main is the first moon, then the oldest workspaces", () => {
  const layout = layoutPlanet(ws(4), []);
  assert.deepEqual(layout.moons.map((m) => m.workspaceId), ["w-main", "w0", "w1", "w2"]);
});

test("moons fill rings of 4, 8, 12 and sit on their orbit", () => {
  const layout = layoutPlanet(ws(14), []);
  assert.deepEqual(layout.moons.map((m) => m.ring), [...Array(4).fill(0), ...Array(8).fill(1), ...Array(2).fill(2)]);
  assert.equal(layout.orbits.length, 3);
  for (const m of layout.moons) {
    const r = Math.hypot(m.x - layout.core.x, (m.y - layout.core.y) / TILT);
    assert.ok(Math.abs(r - moonOrbitRadius(m.ring)) < 0.05);
  }
  assert.equal(moonCapacity(2), 12);
});

test("existing moons keep their place when a workspace is added", () => {
  const before = layoutPlanet(ws(3), []);
  const after = layoutPlanet(ws(4), []);
  for (const m of before.moons) {
    const same = after.moons.find((x) => x.workspaceId === m.workspaceId);
    assert.equal(same.angle, m.angle);
    assert.equal(same.ring, m.ring);
  }
});

test("each moon shows its newest sessions and counts the rest", () => {
  const list = [...sessions("w-main", MAX_SATELLITES + 5), ...sessions("w0", 3)];
  const layout = layoutPlanet(ws(2), list);
  assert.equal(layout.overflow["w-main"], 5);
  assert.equal(layout.overflow.w0, undefined);
  assert.equal(Object.keys(layout.satellites).filter((id) => id.startsWith("w-main")).length, MAX_SATELLITES);
  assert.ok(!layout.satellites["w-main-s0"], "oldest session is the one dropped");
  assert.ok(layout.satellites[`w-main-s${MAX_SATELLITES + 4}`]);
});

test("the map always holds every moon and its satellites", () => {
  const layout = layoutPlanet(ws(20), ws(20).flatMap((w) => sessions(w.id, 12)));
  for (const p of [...layout.moons, ...Object.values(layout.satellites)]) {
    assert.ok(p.x > 0 && p.x < layout.w && p.y > 0 && p.y < layout.h);
  }
});

test("spend steps grow at each threshold", () => {
  assert.equal(spendStep(0), 0);
  for (const [i, t] of SPEND_THRESHOLDS.entries()) {
    assert.equal(spendStep(t - 0.001), i);
    assert.equal(spendStep(t), i + 1);
  }
});
