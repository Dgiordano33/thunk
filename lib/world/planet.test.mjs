import assert from "node:assert/strict";
import test from "node:test";
import { CORE_RADIUS, MAX_CORE_SATELLITES, MAX_SATELLITES, SPEND_THRESHOLDS, layoutPlanet, moonCapacity, moonOrbitRadius, spendStep } from "./planet.ts";
import { TILT } from "./system.ts";

const at = (i) => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString();
const home = { id: "w-main", slug: "main", createdAt: at(50), visibility: "project" };
const ws = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, slug: `ws-${i}`, createdAt: at(i), visibility: "workspace" }));
const sessions = (workspaceId, n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${workspaceId}-s${from + i}`, workspaceId, createdAt: at(100 + from + i) }));

test("workspaces you made are moons, oldest first; the project's own workspaces are not", () => {
  const auto = { id: "w-auto", slug: "effort-1", createdAt: at(60), visibility: "project" };
  const layout = layoutPlanet([...ws(3).reverse(), home, auto], []);
  assert.deepEqual(layout.moons.map((m) => m.workspaceId), ["w0", "w1", "w2"]);
});

test("a main workspace saved before visibility existed still orbits as the project", () => {
  const layout = layoutPlanet([{ id: "old-main", slug: "main", createdAt: at(0) }], sessions("old-main", 2));
  assert.equal(layout.moons.length, 0);
  assert.ok(layout.satellites["old-main-s0"]);
});

test("the project's own sessions orbit the planet, clear of its disk and label", () => {
  const auto = { id: "w-auto", slug: "effort-1", createdAt: at(60), visibility: "project" };
  const list = [...sessions("w-main", MAX_CORE_SATELLITES + 3), ...sessions("w-auto", 2, 500)];
  const layout = layoutPlanet([home, auto, ...ws(1)], list);
  const around = Object.entries(layout.satellites).filter(([id]) => !id.startsWith("w0"));
  assert.equal(around.length, MAX_CORE_SATELLITES);
  assert.equal(layout.coreOverflow, 5);
  assert.ok(layout.satellites["w-auto-s501"], "newest sessions across the project's workspaces are kept");
  for (const [, p] of around) {
    const dx = p.x - layout.core.x;
    const dy = p.y - layout.core.y;
    assert.ok(Math.hypot(dx, dy) > CORE_RADIUS + 6, "outside the planet");
    assert.ok(!(dy > 0 && Math.abs(dx) < 90), "not on the label below the planet");
  }
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
  const list = [...sessions("w0", MAX_SATELLITES + 5), ...sessions("w1", 3)];
  const layout = layoutPlanet(ws(2), list);
  assert.equal(layout.overflow.w0, 5);
  assert.equal(layout.overflow.w1, undefined);
  assert.equal(Object.keys(layout.satellites).filter((id) => id.startsWith("w0-")).length, MAX_SATELLITES);
  assert.ok(!layout.satellites["w0-s0"], "oldest session is the one dropped");
  assert.ok(layout.satellites[`w0-s${MAX_SATELLITES + 4}`]);
});

test("the map always holds every moon and its satellites", () => {
  const all = [home, ...ws(20)];
  const layout = layoutPlanet(all, all.flatMap((w) => sessions(w.id, 25)));
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
