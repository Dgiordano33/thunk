const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync } = require("node:fs");
const { files } = require("./builder.cjs");

test("desktop package includes every runtime module, preload and UI file", () => {
  // The backend smoke test cannot catch missing Electron modules or preloads.
  // Keep the explicit packaging allowlist in sync with the desktop runtime.
  const runtimeFiles = readdirSync(__dirname).filter((file) =>
    /\.(cjs|js|html)$/.test(file) && file !== "builder.cjs" && !file.endsWith(".test.cjs")
  );
  for (const file of runtimeFiles) {
    assert.ok(files.includes(file), `Desktop package is missing ${file}`);
  }
});
