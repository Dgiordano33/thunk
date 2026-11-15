import assert from "node:assert/strict";
import test from "node:test";
import { BODY_KINDS, bodyColors, bodyKind, bodySpec, moonKind, oklchToRgb } from "./bodies.ts";
import { PLANET_PALETTES } from "./system.ts";

test("type follows the size level and clamps out-of-range levels", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(bodyKind), ["rock", "ice", "cloud", "gas", "giant"]);
  assert.equal(bodyKind(0), "rock");
  assert.equal(bodyKind(9), "giant");
});

test("a body's look is stable for its id", () => {
  for (const kind of BODY_KINDS) assert.deepEqual(bodySpec("thunk", kind), bodySpec("thunk", kind));
  assert.notDeepEqual(bodySpec("thunk", "gas"), bodySpec("docs", "gas"));
  assert.equal(moonKind("ws-1"), moonKind("ws-1"));
  assert.ok(["rock", "ice"].includes(moonKind("ws-2")));
});

test("variation stays inside its ranges", () => {
  const deg = Math.PI / 180;
  for (let i = 0; i < 300; i++) {
    const s = bodySpec(`p${i}`, BODY_KINDS[i % 5]);
    assert.ok(s.seed >= 0 && s.seed < 1);
    assert.ok(Math.abs(s.tilt) <= 25 * deg + 1e-9, "tilt within ±25°");
    assert.ok(s.period >= 60 && s.period <= 180, "rotation period 60–180s");
    assert.ok(s.bands >= 5 && s.bands <= 11);
    assert.ok(Math.abs(s.hueShift) <= 20);
    if (s.ring) assert.ok(Math.abs(s.ring.roll) <= 12 * deg + 1e-9);
  }
});

test("only gas and great giants have rings", () => {
  for (const kind of BODY_KINDS) assert.equal(bodySpec("x", kind).ring !== null, kind === "gas" || kind === "giant");
});

test("OKLCH converts to sRGB", () => {
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  assert.ok(close(oklchToRgb(1, 0, 0), [1, 1, 1]));
  assert.ok(close(oklchToRgb(0, 0, 0), [0, 0, 0]));
  // Pure sRGB red is oklch(0.628 0.2577 29.23).
  assert.ok(close(oklchToRgb(0.628, 0.2577, 29.23), [1, 0, 0]));
  for (const p of PLANET_PALETTES) {
    for (const kind of BODY_KINDS) {
      for (const rgb of Object.values(bodyColors(p, bodySpec("x", kind)))) assert.ok(rgb.every((v) => v >= 0 && v <= 1));
    }
  }
});
