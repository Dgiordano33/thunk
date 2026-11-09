/* eslint-disable @typescript-eslint/no-require-imports -- Compile the server helper with the installed compiler. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const { promisify } = require("node:util");

test("clone and both worktree paths terminate options before untrusted operands", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thunk-git-args-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  let exists = false;
  const execFile = () => {};
  execFile[promisify.custom] = async (_cmd, args) => {
    calls.push(args);
    if (args.includes("--git-common-dir")) return { stdout: path.join(dir, ".git") };
    if (args.includes("--verify") && !exists) throw new Error("missing");
    return { stdout: "yes" };
  };
  const source = await fs.readFile(path.join(__dirname, "../lib/projects/git.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => name === "server-only" ? {} : name === "node:child_process" ? { execFile } : name === "./repo-spec" ? { repoNameFromUrl: (url) => url.split("/").pop() } : require(name), exports);
  await exports.cloneRepo("--upload-pack=evil", dir);
  assert.deepEqual(calls.find((a) => a[0] === "clone").slice(0, 3), ["clone", "--", "--upload-pack=evil"]);
  const opts = { root: dir, path: path.join(dir, "worktree"), branch: "topic", baseRef: "--orphan" };
  await exports.createWorktree(opts);
  assert.deepEqual(calls.at(-1), ["worktree", "add", "-b", "topic", "--", opts.path, "--orphan"]);
  exists = true;
  await exports.createWorktree(opts);
  assert.deepEqual(calls.at(-1), ["worktree", "add", "--", opts.path, "topic"]);
});
