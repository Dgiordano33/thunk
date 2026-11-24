import assert from "node:assert/strict";
import test from "node:test";
import { fromEvent, label, matches, problem } from "./shortcut.ts";

const key = (code, mods = {}) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test("a key press becomes a cross-platform accelerator", () => {
  assert.equal(fromEvent(key("KeyK", { metaKey: true, shiftKey: true }), true), "CommandOrControl+Shift+K");
  assert.equal(fromEvent(key("KeyK", { ctrlKey: true, shiftKey: true }), false), "CommandOrControl+Shift+K");
  assert.equal(fromEvent(key("Space", { altKey: true }), true), "Alt+Space");
  assert.equal(fromEvent(key("KeyJ", { ctrlKey: true }), true), "Control+J");
  assert.equal(fromEvent(key("ShiftLeft", { shiftKey: true }), true), null);
});

test("shortcuts that would fire while typing or clash with Thunk are refused", () => {
  assert.match(problem("K"), /modifier/);
  assert.match(problem("Shift+K"), /typing/);
  assert.match(problem("CommandOrControl+K"), /already/);
  assert.equal(problem("F5"), null);
  assert.equal(problem("Alt+Space"), null);
});

test("matching and labels", () => {
  assert.ok(matches(key("KeyK", { ctrlKey: true, shiftKey: true }), "CommandOrControl+Shift+K") || matches(key("KeyK", { metaKey: true, shiftKey: true }), "CommandOrControl+Shift+K"));
  assert.ok(!matches(key("KeyK", { metaKey: true, ctrlKey: true }), ""));
  assert.equal(label("CommandOrControl+Shift+K", true), "⇧⌘K");
  assert.equal(label("Alt+Space", true), "⌥ Space");
  assert.equal(label("CommandOrControl+Shift+K", false), "Ctrl+Shift+K");
  assert.equal(label("", true), "Off");
});
