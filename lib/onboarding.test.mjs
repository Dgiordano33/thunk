import test from "node:test";
import assert from "node:assert/strict";
import { initialOnboarding, parseOnboarding, storeOnboarding } from "./onboarding.ts";
import { checkResult } from "./agent/readiness.ts";
test("onboarding ignores malformed keys and preserves explicit reset on existing installs", () => {
  assert.deepEqual(parseOnboarding("intro,intro,invalid,map-legend"), ["intro", "map-legend"]);
  assert.deepEqual(parseOnboarding('%invalid'), []);
  assert.deepEqual(initialOnboarding(undefined, true), ["intro"]);
  assert.deepEqual(initialOnboarding(undefined, false), []);
  assert.deepEqual(initialOnboarding("", true), []);
  assert.deepEqual(initialOnboarding("harvest", true), ["harvest"]);
});
test("cookie writes persist hints across ports and reset without deleting the cookie", () => {
  const previous = globalThis.document;
  globalThis.document = { cookie: "" };
  try {
    storeOnboarding(["intro", "map-legend"]);
    assert.match(document.cookie, /^thunk.onboarding=intro,map-legend; path=\/; max-age=31536000; samesite=lax$/);
    storeOnboarding([]);
    assert.match(document.cookie, /^thunk.onboarding=; path=/);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
test("readiness distinguishes missing, signed out, installed and unexpected failures", () => {
  for (const provider of ["claude", "codex"]) {
    assert.equal(checkResult(provider, { missing: true }).state, "missing");
    assert.equal(checkResult(provider, { signedIn: false }).state, "signed-out");
    assert.equal(checkResult(provider, { signedIn: true }).state, "ready");
    assert.equal(checkResult(provider, { error: true }).state, "unavailable");
    assert.match(checkResult(provider, {}).message, /not verified/);
  }
});
