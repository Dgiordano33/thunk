import assert from "node:assert/strict";
import test from "node:test";
import { LEVEL_THRESHOLDS, cityActivity, cityHue, cityLevel, cityMood } from "./cities.ts";

const level = (workspaceCount, sessionCount) => cityLevel({ workspaceCount, sessionCount });

test("cities grow at each threshold of workspaces * 2 + sessions", () => {
  assert.equal(level(0, 0), 1);
  assert.equal(level(0, 1), 1);
  assert.deepEqual(LEVEL_THRESHOLDS, [2, 6, 14, 30]);
  for (const [i, t] of LEVEL_THRESHOLDS.entries()) {
    assert.equal(level(0, t - 1), i + 1);
    assert.equal(level(0, t), i + 2);
  }
  assert.equal(level(1, 0), 2);
  assert.equal(level(3, 0), 3);
  assert.equal(level(10, 20), 5);
  assert.equal(level(100, 1000), 5);
});

test("cities with no activity in 30 days fall dormant", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  assert.equal(cityMood({ lastActivityAt: null }, now), "dormant");
  assert.equal(cityMood({ lastActivityAt: "2026-11-01T00:00:00Z" }, now), "settled");
  assert.equal(cityMood({ lastActivityAt: "2026-09-01T00:00:00Z" }, now), "dormant");
});

test("hues are stable per id", () => {
  assert.equal(cityHue("abc"), cityHue("abc"));
  assert.ok(cityHue("abc") >= 0 && cityHue("abc") < 360);
});

test("live activity reports the most urgent state for a project", () => {
  const running = { projectId: "p", pending: 0, status: "running" };
  assert.equal(cityActivity([running], "p"), "Running");
  assert.equal(cityActivity([running, { ...running, status: "error" }], "p"), "Session error");
  assert.equal(cityActivity([running, { ...running, pending: 1 }], "p"), "Needs attention");
  assert.equal(cityActivity([running], "other"), null);
});
