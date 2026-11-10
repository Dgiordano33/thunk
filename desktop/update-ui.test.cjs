const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fixture(prepare) {
  const windows = [];
  const messages = [];
  const errors = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = { executeJavaScript: async (script) => { this.script = script; } };
      windows.push(this);
    }
    async loadFile(file) { assert.equal(path.basename(file), "update.html"); }
    show() { this.visible = true; }
    close() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const context = vm.createContext({
    __dirname, console, AbortController, process: { ...process, resourcesPath: "/tmp/resources" },
    require: (name) => {
      if (name === "electron") return {
        app: { setName() {}, requestSingleInstanceLock: () => false, quit() {}, getPath: () => "/tmp" },
        BrowserWindow,
        dialog: {
          showMessageBox: async (options) => {
            assert.ok(windows[0].destroyed, "progress closes before result dialog");
            messages.push(options);
            return { response: 1 };
          },
          showErrorBox: (...args) => { assert.ok(windows[0].destroyed); errors.push(args); },
        },
      };
      if (name === "./updater.cjs") return { prepareUpdate: (options) => prepare(options, windows), installUpdate() {} };
      if (name === "./runtime.cjs") return { loginPath: () => "/usr/bin" };
      if (name === "node:fs") return { ...fs, readFileSync: () => '{"revision":"old"}', rmSync() {} };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8"), context);
  const check = vm.runInContext("checkForUpdates", context);
  const item = { enabled: true, label: "Check for Updates…" };
  return { check: () => check(item), item, windows, messages, errors };
}

test("shows sandboxed progress immediately and closes it before the up-to-date result", async () => {
  const f = fixture(async ({ onProgress }, [window]) => {
    assert.ok(window.visible);
    assert.equal(window.options.modal, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.sandbox, true);
    onProgress("Building your update…");
    assert.match(window.script, /textContent = "Building your update…"/);
    return null;
  });
  await f.check();
  assert.equal(f.messages[0].message, "Thunk is up to date");
  assert.equal(f.item.enabled, true);
  assert.equal(f.errors.length, 0);
});

test("closing the progress window allows preparation to finish and keeps restart confirmation", async () => {
  const f = fixture(async ({ onProgress }, [window]) => {
    window.close();
    onProgress("Verifying your update…");
    return { staged: "/tmp/staged", staging: "/tmp/staging" };
  });
  await f.check();
  assert.equal(f.messages[0].message, "Your update is ready");
  assert.equal(f.messages[0].buttons[0], "Restart and Update");
  assert.equal(f.errors.length, 0);
});

test("build errors close progress and restore the update menu", async () => {
  const f = fixture(async () => { throw new Error("Build failed"); });
  await f.check();
  assert.equal(f.errors[0][0], "Update could not be built");
  assert.match(f.errors[0][1], /Build failed/);
  assert.equal(f.item.enabled, true);
  assert.equal(f.item.label, "Check for Updates…");
});

test("repeated update checks do not create overlapping windows", async () => {
  let finish;
  const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const task = f.check();
  await Promise.resolve();
  await f.check();
  assert.equal(f.windows.length, 1);
  finish(null);
  await task;
});

test("Continue working and Escape dismiss the progress window", () => {
  const handlers = {};
  let closed = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "update.js"), "utf8"), {
    window: { close: () => closed++ },
    document: {
      getElementById: () => ({ addEventListener: (event, callback) => { handlers[event] = callback; } }),
      addEventListener: (event, callback) => { handlers[event] = callback; },
    },
  });
  handlers.keydown({ key: "Enter" });
  assert.equal(closed, 0);
  handlers.click();
  handlers.keydown({ key: "Escape" });
  assert.equal(closed, 2);
});
