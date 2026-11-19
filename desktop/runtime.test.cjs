const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { startBackend, configuredRemote, externalUrl } = require("./runtime.cjs");

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

test("THUNK_PORT in the config pins the backend port", async (t) => {
  const options = fixture(t, `
    require('node:http').createServer((req, res) => res.end('ok')).listen(Number(process.env.PORT), process.env.HOSTNAME);
  `);
  const probe = require("node:net").createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  writeFileSync(options.config, `THUNK_PORT=${port}\n`);
  const backend = await startBackend(options);
  t.after(() => backend.stop());
  assert.equal(backend.url, `http://127.0.0.1:${port}`);
  writeFileSync(options.config, "THUNK_PORT=nope\n");
  await assert.rejects(startBackend(options), /THUNK_PORT must be a port number/);
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

test("THUNK_REMOTE_URL in the config selects a server origin", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "thunk-remote-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, ".env");
  const remote = (text) => { writeFileSync(config, text); return configuredRemote(config); };
  assert.equal(configuredRemote(path.join(dir, "missing.env")), undefined);
  assert.equal(remote("THUNK_PORT=4600\n"), undefined);
  assert.equal(remote("THUNK_REMOTE_URL=\n"), undefined);
  assert.equal(remote("THUNK_REMOTE_URL=https://thunk.tail1234.ts.net/projects?x=1\n"), "https://thunk.tail1234.ts.net");
  assert.equal(remote("THUNK_REMOTE_URL= https://thunk.tail1234.ts.net:8443/ \n"), "https://thunk.tail1234.ts.net:8443");
  assert.throws(() => remote("THUNK_REMOTE_URL=thunk.tail1234.ts.net\n"), /must be a URL/);
  assert.throws(() => remote("THUNK_REMOTE_URL=file:///etc/passwd\n"), /must start with https/);
});
