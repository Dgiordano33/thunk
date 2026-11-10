const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installUpdate, prepareUpdate, run } = require("./updater.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-updater-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "Thunk.app");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "version"), "original");
  return { root, target };
}

test("replaces app at the same path and retains the previous app", (t) => {
  const { root, target } = fixture(t);
  const staged = path.join(root, "replacement.app");
  fs.mkdirSync(staged);
  fs.writeFileSync(path.join(staged, "version"), "updated");
  const backup = installUpdate(staged, target);
  assert.equal(fs.readFileSync(path.join(target, "version"), "utf8"), "updated");
  assert.equal(fs.readFileSync(path.join(backup, "version"), "utf8"), "original");
});

test("rolls back if moving the replacement fails", (t) => {
  const { root, target } = fixture(t);
  assert.throws(() => installUpdate(path.join(root, "missing.app"), target));
  assert.equal(fs.readFileSync(path.join(target, "version"), "utf8"), "original");
  assert.deepEqual(fs.readdirSync(root), ["Thunk.app"]);
});

function fakeTools(root, { failBuild = false } = {}) {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const [name, script] of Object.entries({
    git: 'if [ "$1" = "clone" ]; then for last; do :; done; mkdir -p "$last"; else printf abc123; fi',
    npm: failBuild ? 'exit 9' : `mkdir -p dist-desktop/${process.arch === "arm64" ? "mac-arm64" : "mac"}/Thunk.app/Contents/Resources/backend; printf updated > dist-desktop/${process.arch === "arm64" ? "mac-arm64" : "mac"}/Thunk.app/version`,
    node: 'test \"$2\" = \"$(cd \"$2\" && pwd -P)\"', codesign: 'exit 0',
  })) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return { PATH: `${bin}:/usr/bin:/bin`, HOME: root };
}

test("up-to-date check skips build and leaves the installed app alone", async (t) => {
  const { root, target } = fixture(t);
  const stages = [];
  const result = await prepareUpdate({ target, revision: "abc123", env: fakeTools(root, { failBuild: true }), logFile: path.join(root, "log"), signal: new AbortController().signal, onProgress: (message) => stages.push(message) });
  assert.equal(result, null);
  assert.deepEqual(stages, []);
  assert.equal(fs.readFileSync(path.join(target, "version"), "utf8"), "original");
});

test("build failure leaves installed app intact", async (t) => {
  const { root, target } = fixture(t);
  await assert.rejects(prepareUpdate({ target, revision: "old", env: fakeTools(root, { failBuild: true }), logFile: path.join(root, "log"), signal: new AbortController().signal }), /npm failed/);
  assert.equal(fs.readFileSync(path.join(target, "version"), "utf8"), "original");
  assert.ok(!fs.readdirSync(root).some(name => name.startsWith(".thunk-update-")));
});

test("successful preparation stages beside app without replacing it", async (t) => {
  const { root, target } = fixture(t);
  const stages = [];
  const prepared = await prepareUpdate({ target, revision: "old", env: fakeTools(root), logFile: path.join(root, "log"), signal: new AbortController().signal, onProgress: (message) => stages.push(message) });
  assert.deepEqual(stages, ["Downloading what’s new…", "Building your update…", "Verifying your update…"]);
  assert.equal(prepared.revision, "abc123");
  assert.equal(path.dirname(prepared.staging), root);
  assert.equal(fs.readFileSync(path.join(prepared.staged, "version"), "utf8"), "updated");
  assert.equal(fs.readFileSync(path.join(target, "version"), "utf8"), "original");
});

test("cancel stops the running build command", async () => {
  const controller = new AbortController();
  const task = run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: process.env, log: "ignore", signal: controller.signal });
  controller.abort();
  await assert.rejects(task, /abort/i);
});
