/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = `${path.join(__dirname, "..", request.slice(2))}.ts`;
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return load.call(this, request, parent, isMain);
};

const { listDirs, expandPath } = require("../lib/fs/list-dirs.ts");

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "thunk-list-dirs-")));
const home = path.join(base, "home");
mkdirSync(path.join(home, "code", "api", ".git"), { recursive: true });
mkdirSync(path.join(home, "code", "Web"), { recursive: true });
mkdirSync(path.join(home, "code", ".cache"), { recursive: true });
writeFileSync(path.join(home, "code", "notes.txt"), "");
mkdirSync(path.join(base, "outside"));
symlinkSync(path.join(base, "outside"), path.join(home, "escape"));

test("expands ~ against home", () => {
  assert.equal(expandPath("~", home), home);
  assert.equal(expandPath("~/code", home), path.join(home, "code"));
  assert.equal(expandPath("code", home), path.join(home, "code"));
  assert.equal(expandPath("  ", home), home);
});

test("lists visible subfolders, sorted, with git flags", async () => {
  const listing = await listDirs("~/code", home);
  assert.equal(listing.path, path.join(home, "code"));
  assert.equal(listing.parent, home);
  assert.deepEqual(listing.entries.map((e) => [e.name, e.git]), [["api", true], ["Web", false]]);
});

test("home has no parent", async () => {
  assert.equal((await listDirs("~", home)).parent, null);
});

test("refuses paths outside home, including through symlinks", async () => {
  await assert.rejects(listDirs(base, home), { status: 403 });
  await assert.rejects(listDirs("~/..", home), { status: 403 });
  await assert.rejects(listDirs("~/escape", home), { status: 403 });
});

test("missing folders are a 404", async () => {
  await assert.rejects(listDirs("~/nope", home), { status: 404 });
});
