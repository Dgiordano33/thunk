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

test("squash allows cleanup after the default branch moved on", async (t) => {
  const { cwd, root, ctx } = await repo(t);
  await commit(cwd, "topic\n");
  await commit(root, "other work\n", "other");
  await workspaceGitAction(ctx, "squash");
  await assertWorkspaceCanRemove(ctx);
  await commit(cwd, "unmerged\n");
  await assert.rejects(assertWorkspaceCanRemove(ctx), /unmerged/);
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

test("workspace lock queues waiters in order", async () => {
  const id = crypto.randomUUID();
  const order = [];
  let release;
  const first = runtime.withWorkspaceLock(id, () => new Promise((resolve) => { release = resolve; }));
  const second = runtime.withWorkspaceLock(id, async () => { order.push("second"); }, { wait: true });
  const third = runtime.withWorkspaceLock(id, async () => { order.push("third"); }, { wait: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  release(); await Promise.all([first, second, third]);
  assert.deepEqual(order, ["second", "third"]);
});

test("setup script runs without holding the workspace lock", async (t) => {
  const { root, cwd } = await fixture(t);
  const ctx = { project: { root, defaultBranch: "main" }, workspace: { id: crypto.randomUUID(), name: "setup-lock", cwd, status: "active" } };
  t.after(() => runtime.stopWorkspaceProcesses(ctx.workspace.id));
  await fs.writeFile(path.join(root, "thunk.json"), JSON.stringify({ scripts: { setup: "sleep 1", run: "true" } }));
  const setup = runtime.prepareWorkspace(ctx);
  await eventually(async () => (await runtime.runtimeSnapshot(ctx)).processes.some((p) => p.kind === "setup" && p.running));
  await runtime.withWorkspaceLock(ctx.workspace.id, async () => {});
  await assert.rejects(runtime.startWorkspaceProcess(ctx, "run"), /Wait for setup/);
  await setup;
});

test("terminal SSE replays deltas, resets truncated output, isolates IDs and cancels cleanly", async () => {
  const source = await fs.readFile(path.join(__dirname, "../app/api/workspaces/[id]/terminal/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const processId = crypto.randomUUID();
  let snapshot = { output: "hello", offset: 0, running: false };
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const dependencies = {
    zod: require("zod"),
    "@/lib/api/http": { handle: (handler) => handler, HttpError },
    "@/lib/projects": { getWorkspaceContext: async () => ({}) },
    "@/lib/projects/runtime": { terminalSnapshot: (id, pid) => id === "workspace" && pid === processId ? snapshot : null },
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => dependencies[name], exports);
  const ctx = { params: Promise.resolve({ id: "workspace" }) };
  const url = `http://localhost/api/workspaces/workspace/terminal?processId=${processId}`;
  const replay = await exports.GET(new Request(url, { headers: { "last-event-id": "2" } }), ctx);
  assert.match(await replay.text(), /"output":"llo","reset":false,"done":true/);
  snapshot = { output: "tail", offset: 100, running: false };
  assert.match(await (await exports.GET(new Request(url), ctx)).text(), /"output":"tail","reset":true/);
  await assert.rejects(exports.GET(new Request(url), { params: Promise.resolve({ id: "another-workspace" }) }), { status: 404 });
  snapshot = { output: "live", offset: 0, running: true };
  const controller = new AbortController();
  const stream = await exports.GET(new Request(url, { signal: controller.signal }), ctx);
  const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"output":"live"/);
  controller.abort();
  assert.equal((await reader.read()).done, true);
  const cancelled = await exports.GET(new Request(url), ctx);
  await cancelled.body.cancel();
});

const { captureCheckpoint, restoreCheckpoint, listCheckpoints } = require("../lib/projects/checkpoints.ts");

test("checkpoints restore tracked, binary, symlink and untracked files, preserve index and ignored files, and retain recovery", async (t) => {
  const { cwd, ctx } = await repo(t);
  const wid = ctx.workspace.id;
  await fs.writeFile(path.join(cwd, ".gitignore"), "ignored\n");
  await fs.writeFile(path.join(cwd, "ignored"), "private");
  await fs.writeFile(path.join(cwd, "file"), "staged\n"); git(cwd, "add", "file");
  const index = git(cwd, "diff", "--cached");
  await fs.writeFile(path.join(cwd, "file"), "before turn\n");
  await fs.writeFile(path.join(cwd, "binary"), Buffer.from([0, 1, 2, 255]));
  await fs.symlink("file", path.join(cwd, "link"));
  const head = git(cwd, "rev-parse", "HEAD");
  const cp = await captureCheckpoint(cwd, wid, "session", "message", "Do a thing");
  assert.equal(git(cwd, "diff", "--cached"), index);
  assert.equal((await listCheckpoints(cwd, wid))[0].messageId, "message");
  assert.deepEqual(await listCheckpoints(cwd, crypto.randomUUID()), []);
  await fs.writeFile(path.join(cwd, "file"), "after turn\n");
  await fs.unlink(path.join(cwd, "binary")); await fs.unlink(path.join(cwd, "link"));
  await fs.mkdir(path.join(cwd, "new-dir")); await fs.writeFile(path.join(cwd, "new-dir", "new"), "new");
  await fs.writeFile(path.join(cwd, "ignored"), "still private");
  const recovery = await restoreCheckpoint(cwd, wid, cp.id);
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "before turn\n");
  assert.deepEqual(await fs.readFile(path.join(cwd, "binary")), Buffer.from([0, 1, 2, 255]));
  assert.equal(await fs.readlink(path.join(cwd, "link")), "file");
  await assert.rejects(fs.stat(path.join(cwd, "new-dir", "new")), /ENOENT/);
  assert.equal(await fs.readFile(path.join(cwd, "ignored"), "utf8"), "still private");
  assert.equal(git(cwd, "diff", "--cached"), index);
  assert.equal(git(cwd, "rev-parse", "HEAD"), head);
  await restoreCheckpoint(cwd, wid, recovery.id);
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "after turn\n");
  assert.equal(await fs.readFile(path.join(cwd, "new-dir", "new"), "utf8"), "new");
  await assert.rejects(restoreCheckpoint(cwd, wid, crypto.randomUUID()), /not found/);
  await commit(cwd, "commit\n");
  await assert.rejects(restoreCheckpoint(cwd, wid, cp.id), /HEAD changed/);
});

test("rewind refuses ignored file collisions and leaves original contents intact", async (t) => {
  const { cwd, ctx } = await repo(t);
  await fs.writeFile(path.join(cwd, "collision"), "snapshot");
  const cp = await captureCheckpoint(cwd, ctx.workspace.id, "s", "m", "before");
  await fs.writeFile(path.join(cwd, ".gitignore"), "collision\n");
  await fs.writeFile(path.join(cwd, "collision"), "private ignored contents");
  await assert.rejects(restoreCheckpoint(cwd, ctx.workspace.id, cp.id));
  assert.equal(await fs.readFile(path.join(cwd, "collision"), "utf8"), "private ignored contents");
});

test("checkpoints work before a repository's first commit", async (t) => {
  const { cwd } = await fixture(t);
  git(cwd, "init", "-b", "main");
  await fs.writeFile(path.join(cwd, "first"), "before");
  const wid = crypto.randomUUID();
  const cp = await captureCheckpoint(cwd, wid, "s", "m", "first turn");
  await fs.writeFile(path.join(cwd, "first"), "after");
  await restoreCheckpoint(cwd, wid, cp.id);
  assert.equal(await fs.readFile(path.join(cwd, "first"), "utf8"), "before");
  assert.equal(git(cwd, "ls-files"), "");
});

test("snapshots include newly staged ignored files without changing staging", async (t) => {
  const { cwd, ctx } = await repo(t);
  await fs.writeFile(path.join(cwd, ".gitignore"), "forced\n");
  await fs.writeFile(path.join(cwd, "forced"), "staged content");
  git(cwd, "add", "-f", "forced");
  await fs.writeFile(path.join(cwd, "forced"), "working content");
  const cp = await captureCheckpoint(cwd, ctx.workspace.id, "s", "m", "forced file");
  await fs.writeFile(path.join(cwd, "forced"), "later");
  await restoreCheckpoint(cwd, ctx.workspace.id, cp.id);
  assert.equal(await fs.readFile(path.join(cwd, "forced"), "utf8"), "working content");
  assert.equal(git(cwd, "show", ":forced"), "staged content");
});

test("checkpoints refuse index flags that could hide working-tree edits", async (t) => {
  const { cwd, ctx } = await repo(t);
  git(cwd, "update-index", "--assume-unchanged", "file");
  await fs.writeFile(path.join(cwd, "file"), "hidden edits");
  await assert.rejects(captureCheckpoint(cwd, ctx.workspace.id, "s", "m", "flags"), /assume-unchanged/);
  assert.equal(await fs.readFile(path.join(cwd, "file"), "utf8"), "hidden edits");
});
