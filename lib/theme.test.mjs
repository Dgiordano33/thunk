import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { applyTheme, readTheme, themeScript } from "./theme.ts";

test("saved preferences and system appearance agree before paint and at runtime", () => {
  for (const saved of [null, "system", "invalid", "light", "dark"]) {
    for (const systemDark of [false, true]) {
      const classes = new Set(["font-sans"]);
      const document = { documentElement: { classList: {
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      } } };
      const localStorage = { getItem: () => saved };
      runInNewContext(themeScript, { document, localStorage, matchMedia: () => ({ matches: systemDark }) });
      const expected = saved === "dark" || (saved !== "light" && systemDark);
      assert.equal(classes.has("dark"), expected);
      assert.ok(classes.has("font-sans"));
      const oldDocument = globalThis.document;
      const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      try {
        globalThis.document = document;
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
        const theme = readTheme();
        assert.equal(theme, saved === "light" || saved === "dark" ? saved : "system");
        applyTheme(theme, systemDark);
        assert.equal(classes.has("dark"), expected);
        applyTheme("light", systemDark);
        assert.equal(classes.has("dark"), false);
      } finally {
        if (oldDocument === undefined) delete globalThis.document;
        else globalThis.document = oldDocument;
        if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
        else delete globalThis.localStorage;
      }
    }
  }
});

test("blocked storage still follows the system appearance", () => {
  let dark;
  const localStorage = { getItem: () => { throw new Error("Blocked"); } };
  runInNewContext(themeScript, {
    localStorage,
    document: { documentElement: { classList: { toggle: (_, enabled) => { dark = enabled; } } } },
    matchMedia: () => ({ matches: true }),
  });
  assert.equal(dark, true);
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage });
    assert.equal(readTheme(), "system");
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete globalThis.localStorage;
  }
});
