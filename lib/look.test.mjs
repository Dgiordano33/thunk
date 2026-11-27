import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOOK, parseLook, storeLook } from "./look.ts";

test("Solar stays the default and saved game preferences migrate to Vanilla", () => {
  assert.equal(DEFAULT_LOOK, "space");
  for (const value of [null, undefined, "", "invalid", "space"]) assert.equal(parseLook(value), "space");
  assert.equal(parseLook("world"), "vanilla");
  assert.equal(parseLook("vanilla"), "vanilla");
});

test("switching looks replaces old classes while preserving theme and fonts", () => {
  const previous = globalThis.document;
  const classes = new Set(["look-world", "look-space", "dark", "font-sans"]);
  globalThis.document = { cookie: "", documentElement: { classList: {
    remove: (...names) => names.forEach(name => classes.delete(name)),
    add: name => classes.add(name),
  } } };
  try {
    storeLook("vanilla");
    assert.deepEqual([...classes].sort(), ["dark", "font-sans", "look-vanilla"]);
    assert.match(document.cookie, /^thunk\.look=vanilla; path=\//);
    storeLook("space");
    assert.deepEqual([...classes].sort(), ["dark", "font-sans", "look-space"]);
    assert.match(document.cookie, /^thunk\.look=space;/);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
