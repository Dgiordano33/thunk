/* eslint-disable @typescript-eslint/no-require-imports -- The compiler hook exercises server TypeScript through Node’s CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

// Use the installed compiler so these server modules need no additional test runner.
require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const { readLifecycleConfig, copyWorkspaceFiles } = require("../lib/projects/lifecycle-config.ts");
const { workspaceGitAction, workspaceGitState, assertWorkspaceCanRemove } = require("../lib/projects/workspace-git.ts");
const runtime = require("../lib/projects/runtime.ts");

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "thunk-lifecycle-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "root");
  const cwd = path.join(base, "workspace");
  await fs.mkdir(root); await fs.mkdir(cwd);
  return { base, root, cwd };
}
function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function repo(t) {
  const { base, root, cwd } = await fixture(t);
  await fs.rmdir(cwd);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Lifecycle test"); git(root, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(root, "file"), "base\n");
  git(root, "add", "."); git(root, "commit", "-m", "base");
  git(root, "worktree", "add", "-b", "topic", cwd);
  const ctx = { project: { root, kind: "repo", defaultBranch: "main", id: crypto.randomUUID() }, workspace: { id: crypto.randomUUID(), name: "test", cwd, branch: "topic", worktreePath: cwd, status: "active" } };
  return { base, root, cwd, ctx };
}
async function commit(cwd, text, name = "file") {
  await fs.writeFile(path.join(cwd, name), text);
  git(cwd, "add", name); git(cwd, "commit", "-m", text.trim());
}
async function eventually(check) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for process output");
}

test("config precedence, validation, copying without overwrite, and path boundaries", async (t) => {
  const { base, root, cwd } = await fixture(t);
  await fs.writeFile(path.join(root, "conductor.json"), JSON.stringify({ scripts: { setup: "legacy" } }));
  assert.equal((await readLifecycleConfig(root)).scripts.setup, "legacy");
  await fs.writeFile(path.join(root, "thunk.json"), JSON.stringify({ scripts: { setup: "preferred" } }));
  const config = await readLifecycleConfig(root);
  assert.equal(config.scripts.setup, "preferred");
  await fs.writeFile(path.join(root, ".env.local"), "secret");
  await copyWorkspaceFiles(root, cwd, config);
  assert.equal(await fs.readFile(path.join(cwd, ".env.local"), "utf8"), "secret");
  await fs.writeFile(path.join(cwd, ".env.local"), "keep");
  await copyWorkspaceFiles(root, cwd, config);
  assert.equal(await fs.readFile(path.join(cwd, ".env.local"), "utf8"), "keep");
  for (const file of ["../outside", "/tmp/file", ".git/config", "nested/../file"]) {
    await assert.rejects(copyWorkspaceFiles(root, cwd, { scripts: {}, filesToCopy: [file] }), /Unsafe/);
  }
  await fs.symlink(path.join(root, ".env.local"), path.join(root, "link"));
  await assert.rejects(copyWorkspaceFiles(root, cwd, { scripts: {}, filesToCopy: ["link"] }), /regular files/);
  await fs.mkdir(path.join(root, "nested")); await fs.writeFile(path.join(root, "nested", "config"), "local");
  await fs.symlink(base, path.join(cwd, "nested"));
  await assert.rejects(copyWorkspaceFiles(root, cwd, { scripts: {}, filesToCopy: ["nested/config"] }), /escapes/);
  await fs.writeFile(path.join(root, "thunk.json"), '{"scripts":{"setup":3}}');
  await assert.rejects(readLifecycleConfig(root));
});

test("merge back and safe cleanup reject dirty and unmerged work", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "workspace\n");
  await assert.rejects(assertWorkspaceCanRemove(ctx), /unmerged/);
  await fs.writeFile(path.join(root, "dirty"), "keep");
  await assert.rejects(workspaceGitAction(ctx, "merge"), /Commit or stash/);
  await fs.unlink(path.join(root, "dirty"));
  await workspaceGitAction(ctx, "merge");
  assert.equal(await fs.readFile(path.join(root, "file"), "utf8"), "workspace\n");
  await assertWorkspaceCanRemove(ctx);
  await fs.writeFile(path.join(cwd, "dirty"), "keep");
  await assert.rejects(assertWorkspaceCanRemove(ctx), /Commit or stash/);
});

test("squash commits into default branch and allows cleanup", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "first\n"); await commit(cwd, "second\n");
  await workspaceGitAction(ctx, "squash");
  assert.equal(git(root, "rev-list", "--count", "HEAD"), "2");
  assert.equal(await fs.readFile(path.join(root, "file"), "utf8"), "second\n");
  await assertWorkspaceCanRemove(ctx);
});

test("sync conflict surfaces paths and abort preserves both branches", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "topic\n"); await commit(root, "main\n");
  await assert.rejects(workspaceGitAction(ctx, "sync"));
  const state = await workspaceGitState(ctx);
  assert.equal(state.operation, "merge"); assert.deepEqual(state.conflicts, ["file"]);
  await workspaceGitAction(ctx, "merge-abort");
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "topic\n");
  assert.equal((await workspaceGitState(ctx)).operation, null);
});

test("rebase conflict supports continue while HEAD is detached", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "topic\n"); await commit(root, "main\n");
  await assert.rejects(workspaceGitAction(ctx, "rebase"));
  assert.equal((await workspaceGitState(ctx)).operation, "rebase");
  await fs.writeFile(path.join(cwd, "file"), "resolved\n"); git(cwd, "add", "file");
  await workspaceGitAction(ctx, "rebase-continue");
  assert.equal(git(cwd, "branch", "--show-current"), "topic");
  assert.equal((await workspaceGitState(ctx)).operation, null);
});

test("rebase abort and root merge conflict recovery", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "topic\n"); await commit(root, "main\n");
  await assert.rejects(workspaceGitAction(ctx, "rebase"));
  await workspaceGitAction(ctx, "rebase-abort");
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "topic\n");
  await assert.rejects(workspaceGitAction(ctx, "merge"));
  assert.deepEqual((await workspaceGitState(ctx)).rootConflicts, ["file"]);
  await workspaceGitAction(ctx, "merge-abort");
  assert.equal(await fs.readFile(path.join(root, "file"), "utf8"), "main\n");
  await assert.rejects(workspaceGitAction(ctx, "squash"));
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("sync fetches fresh remote default branch", async (t) => {
  const { base, root, cwd, ctx } = await repo(t);
  const remote = path.join(base, "remote.git");
  git(base, "init", "--bare", remote);
  git(root, "remote", "add", "origin", remote); git(root, "push", "origin", "main");
  await commit(root, "remote update\n"); git(root, "push", "origin", "main");
  await workspaceGitAction(ctx, "sync");
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "remote update\n");
  assert.equal((await workspaceGitState(ctx)).behind, 0);
});

test("real PTY setup, retry, shell input/resize, preview, stop, archive failure", async (t) => {
  const { root, cwd } = await fixture(t);
  const ctx = { project: { root, defaultBranch: "main" }, workspace: { id: crypto.randomUUID(), name: "pty-test", cwd, status: "active" } };
  t.after(() => runtime.stopWorkspaceProcesses(ctx.workspace.id));
  const config = path.join(root, "thunk.json");
  await fs.writeFile(path.join(root, ".env.local"), "copied");
  await fs.writeFile(config, JSON.stringify({ scripts: { setup: "printf failed; exit 7", run: "true" } }));
  await assert.rejects(runtime.prepareWorkspace(ctx), /Setup failed/);
  let state = await runtime.runtimeSnapshot(ctx);
  assert.equal(state.processes[0].exitCode, 7); assert.match(state.processes[0].output, /failed/);
  await assert.rejects(runtime.startWorkspaceProcess(ctx, "run"), /Fix setup/);
  const server = `require("node:http").createServer((q,s)=>s.end("preview-ok")).listen(Number(process.env.THUNK_PORT),"127.0.0.1")`;
  await fs.writeFile(config, JSON.stringify({ scripts: { setup: "printf setup-ok", run: `exec '${process.execPath}' -e '${server}'`, archive: "printf archive-failed; exit 5" } }));
  await runtime.prepareWorkspace(ctx);
  assert.equal(await fs.readFile(path.join(cwd, ".env.local"), "utf8"), "copied");
  assert.equal((await runtime.runtimeSnapshot(ctx)).setupError, null);
  await runtime.startWorkspaceProcess(ctx, "shell");
  state = await runtime.runtimeSnapshot(ctx);
  const shell = state.processes.find((p) => p.kind === "shell");
  runtime.terminalInput(ctx.workspace.id, shell.id, "printf '\\nterminal-ok\\n'\r", 90, 20);
  await eventually(async () => (await runtime.runtimeSnapshot(ctx)).processes.find((p) => p.kind === "shell").output.includes("terminal-ok"));
  await runtime.startWorkspaceProcess(ctx, "run");
  await assert.rejects(runtime.startWorkspaceProcess(ctx, "run"), /already running/);
  await eventually(async () => (await runtime.runtimeSnapshot(ctx)).previewUrl);
  state = await runtime.runtimeSnapshot(ctx);
  assert.equal(await (await fetch(state.previewUrl)).text(), "preview-ok");
  await assert.rejects(runtime.archiveWorkspaceProcesses(ctx), /Archive hook failed/);
  state = await runtime.runtimeSnapshot(ctx);
  assert.equal(state.processes.find((p) => p.kind === "archive").exitCode, 5);
  assert.equal(state.processes.filter((p) => p.running).length, 0);
  assert.equal(state.previewUrl, null);
  await assert.rejects(fetch(`http://127.0.0.1:${state.port}`));
});

test("workspace lock rejects overlapping operations", async () => {
  const id = crypto.randomUUID();
  let release;
  const first = runtime.withWorkspaceLock(id, () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(runtime.withWorkspaceLock(id, async () => {}), /already running/);
  release(); await first;
  await runtime.withWorkspaceLock(id, async () => {});
});
