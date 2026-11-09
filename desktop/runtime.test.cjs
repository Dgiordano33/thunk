const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { startBackend, externalUrl } = require("./runtime.cjs");

function fixture(t, source) {
  const root = mkdtempSync(path.join(tmpdir(), "thunk-desktop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "bin"));
  mkdirSync(path.join(root, "server"));
  symlinkSync(process.execPath, path.join(root, "bin/node"));
  writeFileSync(path.join(root, "server/server.js"), source);
  const config = path.join(root, ".env");
  writeFileSync(config, "DESKTOP_TEST_SETTING=loaded\nHOSTNAME=0.0.0.0\nPORT=1\n");
  return { root, config, log: "ignore", timeout: 3000 };
}

test("starts on loopback, loads external config, and stops its child", async (t) => {
  const options = fixture(t, `
    require('node:http').createServer((req, res) => res.end(process.env.DESKTOP_TEST_SETTING))
      .listen(Number(process.env.PORT), process.env.HOSTNAME);
  `);
  const backend = await startBackend(options);
  t.after(() => backend.stop());
  assert.match(backend.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await (await fetch(backend.url)).text(), "loaded");
  await backend.stop();
  await assert.rejects(fetch(backend.url));
});

test("reports startup exit instead of waiting for readiness", async (t) => {
  await assert.rejects(startBackend(fixture(t, "process.exit(7)")), /stopped \(7\)/);
});

test("kills a backend that never becomes ready", async (t) => {
  const options = fixture(t, "setInterval(() => {}, 1000)");
  await assert.rejects(startBackend({ ...options, timeout: 150 }), /did not become ready/);
});

test("external links cannot launch file or executable protocols", () => {
  for (const value of ["https://github.com", "http://localhost:3000", "mailto:hello@example.com"]) assert.equal(externalUrl(value), true);
  for (const value of ["file:///etc/passwd", "javascript:alert(1)", "vscode://file/foo", "not a URL"]) assert.equal(externalUrl(value), false);
});
