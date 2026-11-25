/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mkdtempSync, realpathSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const base = path.join(__dirname, "..", request.slice(2));
    request = require("node:fs").existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, "index.ts");
  }
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "../server") return { db: () => null }; // Memory mode: never connect to a configured database.
  return load.call(this, request, parent, isMain);
};

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "thunk-repoless-")));
process.env.THUNK_DATA_DIR = path.join(base, "data");
process.env.CLAUDE_CONFIG_DIR = path.join(base, "claude");
const projects = require("../lib/projects/index.ts");
const paths = require("../lib/projects/paths.ts");
const { getProject } = require("../lib/db/repo/projects.ts");
const { workspaceRepoTargets } = require("../lib/projects/repo-targets.ts");
const { anchorRepo, sessionConfigRoot } = require("../lib/projects/repos.ts");

test.after(() => fs.rm(base, { recursive: true, force: true }));

function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function makeRepo(name) {
  const dir = path.join(base, name);
  await fs.mkdir(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "Repoless test"); git(dir, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(dir, "README"), `${name}\n`);
  git(dir, "add", "."); git(dir, "commit", "-m", "base");
  return dir;
}
const makeFolder = async (name) => { const dir = path.join(base, name); await fs.mkdir(dir); return dir; };
const existing = (p, name) => ({ source: "existing", path: p, name });

test("a project starts without a workspace and allocates isolated environments on demand", async () => {
  const { project, repos } = await projects.createProject({ name: "Empty Idea", repos: [] });
  assert.deepEqual(await require("../lib/db/repo/workspaces.ts").listWorkspaces(project.id), []);
  const workspace = await projects.ensureMainWorkspace(project);
  assert.equal(project.dataKey, "empty-idea");
  assert.deepEqual(project.repos, []);
  assert.deepEqual(repos, []);
  assert.equal(workspace.slug, "main");
  assert.equal(workspace.cwd, paths.projectHomeDir(project.dataKey));
  assert.ok((await fs.stat(workspace.cwd)).isDirectory());
  assert.ok(!workspace.cwd.startsWith(path.join(paths.DATA_DIR, "projects")), "stays out of the tree the notes watcher recurses");
  const ctx = { project, workspace };
  assert.equal(anchorRepo(ctx), null);
  assert.equal(sessionConfigRoot(ctx), workspace.cwd);
  assert.deepEqual(workspaceRepoTargets(ctx), []);
  const extra = await projects.createWorkspace({ projectId: project.id, setup: "skip" });
  assert.notEqual(extra.cwd, workspace.cwd);
  assert.equal(extra.branch, null);
  const inPlace = await projects.createWorkspace({ projectId: project.id, worktree: false, setup: "skip" });
  assert.notEqual(inPlace.cwd, workspace.cwd);
  assert.notEqual(inPlace.cwd, extra.cwd);
  assert.deepEqual(await projects.listExternalSessions(project), []);
});

test("data keys are suffixed on collision, including with directories left on disk", async () => {
  await fs.mkdir(paths.projectDir("left-behind"), { recursive: true });
  const leftover = await projects.createProject({ name: "Left Behind", repos: [] });
  assert.equal(leftover.project.dataKey, "left-behind-2");
  const twin = await projects.createProject({ name: "Left Behind", repos: [] });
  assert.equal(twin.project.dataKey, "left-behind-3");
});

test("the first repo re-anchors the main workspace; any repo can be removed and the anchor moves on", async () => {
  const first = await makeRepo("first");
  const second = await makeRepo("second");
  const { project } = await projects.createProject({ name: "Grows", repos: [] });
  const workspace = await projects.ensureMainWorkspace(project);
  const home = workspace.cwd;

  const repoA = await projects.addProjectRepo(project.id, first);
  let ctx = await projects.getWorkspaceContext(workspace.id);
  assert.equal(ctx.workspace.cwd, first);
  assert.equal(anchorRepo(ctx).id, repoA.id);
  assert.equal(sessionConfigRoot(ctx), first);

  const repoB = await projects.addProjectRepo(project.id, second);
  ctx = await projects.getWorkspaceContext(workspace.id);
  assert.equal(ctx.workspace.cwd, first, "a later repo doesn't move the anchor");

  await projects.removeProjectRepo(project.id, repoA.id);
  ctx = await projects.getWorkspaceContext(workspace.id);
  assert.equal(ctx.workspace.cwd, second);
  assert.deepEqual(ctx.workspace.repos.map((r) => r.repoId), [repoB.id]);

  await projects.removeProjectRepo(project.id, repoB.id);
  ctx = await projects.getWorkspaceContext(workspace.id);
  assert.equal(ctx.workspace.cwd, home);
  assert.deepEqual(ctx.project.repos, []);
  assert.ok((await fs.stat(first)).isDirectory(), "nothing on disk is touched");
});

test("a project opened from a directory keeps its data key, and its former primary is an ordinary repo", async () => {
  const dir = await makeRepo("opened");
  const other = await makeRepo("opened-too");
  const project = await projects.addProject(dir);
  assert.equal(project.dataKey, paths.projectSlug(dir));
  await projects.ensureMainWorkspace(project);
  await projects.addProjectRepo(project.id, other);
  await projects.removeProjectRepo(project.id, project.repos[0].id);
  assert.deepEqual((await getProject(project.id)).repos.map((r) => r.path), [other]);
});

test("contextForDirectory is idempotent, finds worktrees and repos held by wizard projects, and survives a memory reset", async () => {
  const dir = await makeRepo("quick");
  const one = await projects.contextForDirectory(dir);
  const two = await projects.contextForDirectory(path.join(dir, "."));
  assert.equal(one.project.id, two.project.id);
  assert.equal(one.workspace.id, two.workspace.id);
  assert.equal(one.workspace.slug, "main");

  const ws = await projects.createWorkspace({ projectId: one.project.id, name: "topic", setup: "skip" });
  assert.equal((await projects.contextForDirectory(ws.cwd)).workspace.id, ws.id);

  const held = await makeRepo("held");
  const other = await makeRepo("held-second");
  const wizard = await projects.createProject({ name: "Wizard", repos: [existing(other), existing(held)] });
  assert.equal((await projects.contextForDirectory(held)).project.id, wizard.project.id, "second repo of a wizard project resolves to that project");

  const memoryFile = paths.projectMemoryFile(one.project.dataKey);
  await fs.writeFile(memoryFile, "# remembered\n");
  // A restart in memory-only mode forgets every row but not the files.
  globalThis.__thunkMemProjectsV2.clear();
  globalThis.__thunkMemWorkspacesV2.clear();
  globalThis.__thunkMemProjectReposV2.clear();
  globalThis.__thunkMemWorkspaceReposV2.length = 0;
  const after = await projects.contextForDirectory(dir);
  assert.notEqual(after.project.id, one.project.id);
  assert.equal(after.project.dataKey, one.project.dataKey);
  assert.equal(await fs.readFile(paths.projectMemoryFile(after.project.dataKey), "utf8"), "# remembered\n");
});

test("plain folders are in a project but out of its git targets", async () => {
  const code = await makeRepo("code");
  const docs = await makeFolder("docs-folder");
  const { project } = await projects.createProject({ name: "Mixed", repos: [existing(docs), existing(code)] });
  const workspace = await projects.ensureMainWorkspace(project);
  assert.deepEqual(project.repos.map((r) => r.kind), ["folder", "repo"]);
  assert.deepEqual(workspaceRepoTargets({ project, workspace }).map((t) => t.root), [code]);

  const ws = await projects.createWorkspace({ projectId: project.id, name: "mixed-branch", setup: "skip" });
  assert.equal(ws.cwd, path.join(code, ".claude", "worktrees", "mixed-branch"), "sessions start in the worktree, not the leading folder");
  assert.deepEqual(ws.repos.map((r) => [r.name, r.worktreePath !== null]), [["docs-folder", false], ["code", true]]);

  const onlyFolder = await projects.createProject({ name: "Folder Only", repos: [existing(await makeFolder("only-folder"))] });
  const folderWorkspace = await projects.createWorkspace({ projectId: onlyFolder.project.id, setup: "skip" });
  assert.equal(folderWorkspace.cwd, onlyFolder.project.repos[0].path);
  assert.equal(folderWorkspace.branch, null);
  assert.equal((await projects.contextForDirectory(folderWorkspace.cwd)).workspace.id, folderWorkspace.id);
});

test("preflight rejects impossible specs with nothing created", async () => {
  const repo = await makeRepo("pre");
  const taken = await makeFolder("taken");
  const count = async () => (await fs.readdir(path.join(paths.DATA_DIR, "projects"))).length;
  const before = await count();
  const rejects = async (repos, pattern) => {
    await assert.rejects(projects.createProject({ name: "Nope", repos }), (err) => err.status === 400 && pattern.test(err.message));
  };
  await rejects([existing(repo), existing(repo)], /listed twice/);
  await rejects([existing(repo, "same"), { source: "new", parent: base, folder: "fresh", name: "same" }], /named same/);
  await rejects([existing(path.join(base, "missing"))], /Not a directory/);
  await rejects([{ source: "new", parent: base, folder: "taken" }], /Already exists/);
  await rejects([{ source: "github", url: "owner/taken", parent: base }], /Already exists/);
  await rejects([{ source: "new", parent: base, folder: "a/b" }], /single path segment/);
  await assert.rejects(fs.stat(path.join(base, "fresh")));
  await assert.ok(taken);
  assert.equal(await count(), before);
});

test("a failing middle spec is reported and the rest are still added", async () => {
  const left = await makeRepo("left");
  const right = await makeRepo("right");
  const origin = path.join(base, "no-such-remote.git");
  const clone = { source: "github", url: origin, parent: path.join(base, "clones") };
  const result = await projects.createProject({ name: "Partial", repos: [existing(left), clone, existing(right), { source: "new", parent: base, folder: "brand-new", git: true }] });
  assert.deepEqual(result.repos.map((r) => r.status), ["added", "failed", "added", "added"]);
  assert.ok(result.repos[1].error);
  assert.deepEqual(result.project.repos.map((r) => r.name), ["left", "right", "brand-new"]);
  assert.deepEqual(await require("../lib/db/repo/workspaces.ts").listWorkspaces(result.project.id), []);
  assert.equal(result.project.repos[2].kind, "repo");

  // Once the failure is fixed, the retry goes through the single-repo path.
  execFileSync("git", ["clone", "--bare", left, origin], { stdio: "ignore" });
  const retried = await projects.addRepoFromSpec(result.project.id, clone);
  assert.equal(retried.name, "no-such-remote");
  assert.equal((await getProject(result.project.id)).repos.length, 4);
});

test("folder specs without git become folder repos", async () => {
  const { project } = await projects.createProject({ name: "Plain", repos: [{ source: "new", parent: base, folder: "plain-folder", git: false }] });
  assert.deepEqual(project.repos.map((r) => [r.name, r.kind]), [["plain-folder", "folder"]]);
});


test("scratch deletion preserves files, and reused names never adopt leftover files", async () => {
  const { project } = await projects.createProject({ name: "Scratch safety", repos: [] });
  const empty = await projects.createWorkspace({ projectId: project.id, name: "empty" });
  await projects.removeWorkspace(empty.id);
  await assert.rejects(fs.stat(empty.cwd), { code: "ENOENT" });
  const full = await projects.createWorkspace({ projectId: project.id, name: "full" });
  await fs.writeFile(path.join(full.cwd, "draft.md"), "keep me");
  assert.equal((await projects.removeWorkspace(full.id)).retainedDirectory, full.cwd);
  assert.equal(await fs.readFile(path.join(full.cwd, "draft.md"), "utf8"), "keep me");
  const again = await projects.createWorkspace({ projectId: project.id, name: "full" });
  assert.notEqual(again.cwd, full.cwd);
});

test("projects sharing repos allocate different paths and branches, including concurrent creation", async () => {
  const repo = await makeRepo("shared");
  const one = await projects.createProject({ name: "Shared one", repos: [existing(repo)] });
  const two = await projects.createProject({ name: "Shared two", repos: [existing(repo)] });
  const [a, b] = await Promise.all([one, two].map(({ project }) => projects.createWorkspace({ projectId: project.id, name: "paris", setup: "skip" })));
  assert.notEqual(a.cwd, b.cwd);
  assert.notEqual(a.branch, b.branch);
  assert.equal(git(a.cwd, "branch", "--show-current"), a.branch);
  assert.equal(git(b.cwd, "branch", "--show-current"), b.branch);
});

test("removing the last folder gives each workspace its own scratch directory", async () => {
  const { project } = await projects.createProject({ name: "Folder removal", repos: [existing(await makeFolder("remove-folder"))] });
  const workspace = await projects.ensureMainWorkspace(project);
  const extra = await projects.createWorkspace({ projectId: project.id });
  await projects.removeProjectRepo(project.id, project.repos[0].id);
  const a = await projects.getWorkspaceContext(workspace.id);
  const b = await projects.getWorkspaceContext(extra.id);
  assert.notEqual(a.workspace.cwd, b.workspace.cwd);
});

test("automatic efforts start in independent clean worktrees and leave source edits alone", async () => {
  const root = await makeRepo("effort-isolation");
  const { project } = await projects.createProject({ name: "Efforts", repos: [existing(root)] });
  await fs.writeFile(path.join(root, "README"), "uncommitted source edit\n");
  const [a, b] = await Promise.all([1, 2].map(() => projects.createWorkspace({ projectId: project.id, visibility: "project", setup: "skip" })));
  assert.notEqual(a.cwd, b.cwd);
  assert.notEqual(a.branch, b.branch);
  assert.equal(a.visibility, "project");
  assert.equal(git(a.cwd, "status", "--porcelain"), "");
  assert.equal(git(b.cwd, "status", "--porcelain"), "");
  await fs.writeFile(path.join(a.cwd, "README"), "effort A\n");
  assert.equal(await fs.readFile(path.join(b.cwd, "README"), "utf8"), "effort-isolation\n");
  assert.equal(await fs.readFile(path.join(root, "README"), "utf8"), "uncommitted source edit\n");
  const explicit = await projects.createWorkspace({ projectId: project.id, setup: "skip" });
  assert.equal(explicit.visibility, "workspace");
});

test("plain-folder automatic efforts work in the folder itself, so the work lands there", async () => {
  const root = await makeFolder("in-place-source");
  await fs.writeFile(path.join(root, "draft.md"), "original");
  const { project } = await projects.createProject({ name: "Folder efforts", repos: [existing(root)] });
  const a = await projects.createWorkspace({ projectId: project.id, visibility: "project", setup: "skip" });
  assert.equal(a.cwd, root);
  await fs.writeFile(path.join(a.cwd, "draft.md"), "changed");
  assert.equal(await fs.readFile(path.join(root, "draft.md"), "utf8"), "changed");
});

test("idle efforts release empty worktrees and restore them at the same path; work is never released", async () => {
  const checkouts = require("../lib/projects/checkouts.ts");
  const root = await makeRepo("release-efforts");
  const { project } = await projects.createProject({ name: "Release efforts", repos: [existing(root)] });
  const ws = await projects.createWorkspace({ projectId: project.id, visibility: "project", setup: "skip" });
  const ctx = await projects.getWorkspaceContext(ws.id);
  assert.equal(await checkouts.releaseCheckouts(ctx), true);
  assert.equal(await fs.stat(ws.cwd).catch(() => null), null);
  assert.equal(git(root, "branch", "--list", ws.branch), "", "the branch goes too");
  assert.equal(await checkouts.restoreCheckouts(ctx), true);
  assert.equal(git(ws.cwd, "rev-parse", "--abbrev-ref", "HEAD"), ws.branch, "restored at the same path and branch");
  await fs.writeFile(path.join(ws.cwd, "work.txt"), "unsaved");
  assert.equal(await checkouts.releaseCheckouts(ctx), false, "uncommitted work keeps the worktree");
  git(ws.cwd, "add", "work.txt"); git(ws.cwd, "commit", "-qm", "work");
  assert.equal(await checkouts.releaseCheckouts(ctx), false, "unmerged commits keep the worktree");
  assert.ok(await fs.stat(path.join(ws.cwd, "work.txt")));
});

test("canvas callers share one persisted worktree, separate canvases remain isolated", async () => {
  const { ensureBoardWorkspace } = require("../lib/board/workspace.ts");
  const { createCanvas } = require("../lib/board/service.ts");
  const { readBoard } = require("../lib/board/store.ts");
  const { listWorkspaces, updateWorkspace } = require("../lib/db/repo/workspaces.ts");
  const root = await makeRepo("canvas-efforts");
  const { project } = await projects.createProject({ name: "Canvas efforts", repos: [existing(root)] });
  const [a, b] = await Promise.all([ensureBoardWorkspace(project.id), ensureBoardWorkspace(project.id)]);
  assert.equal(a.id, b.id);
  assert.equal((await listWorkspaces(project.id)).length, 1);
  await fs.writeFile(path.join(a.cwd, "shared.txt"), "visible to every canvas agent");
  assert.equal(await fs.readFile(path.join(b.cwd, "shared.txt"), "utf8"), "visible to every canvas agent");
  assert.equal((await readBoard(paths.projectBoardsDir(project.dataKey))).workspaceId, a.id);
  assert.equal((await ensureBoardWorkspace(project.id)).id, a.id);
  const other = await createCanvas(project.dataKey, "Other effort");
  const c = await ensureBoardWorkspace(project.id, other.id);
  assert.notEqual(a.id, c.id);
  assert.equal(git(c.cwd, "status", "--porcelain"), "");
  await updateWorkspace(a.id, { status: "archived" });
  const replaced = await ensureBoardWorkspace(project.id);
  assert.notEqual(replaced.id, a.id, "an archived canvas workspace is replaced instead of breaking the canvas");
  assert.equal((await readBoard(paths.projectBoardsDir(project.dataKey))).workspaceId, replaced.id);
  assert.equal((await ensureBoardWorkspace(project.id)).id, replaced.id);
});

test("a transcript resumed from another directory is copied there, leaving the original", async () => {
  const { ensureTranscriptAt } = require("../lib/agent/transcripts.ts");
  const id = "0f2c7f4e-1111-4222-8333-444455556666";
  const from = path.join(base, "claude", "projects", "-old-canvas"), to = path.join(base, "new-canvas");
  await fs.mkdir(from, { recursive: true });
  await fs.writeFile(path.join(from, `${id}.jsonl`), "history");
  await ensureTranscriptAt(to, id);
  assert.equal(await fs.readFile(path.join(base, "claude", "projects", to.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`), "utf8"), "history");
  assert.equal(await fs.readFile(path.join(from, `${id}.jsonl`), "utf8"), "history");
  await ensureTranscriptAt(to, "../escape");
});

test("new and restored efforts branch from the remote's latest, not a stale local ref", async () => {
  const checkouts = require("../lib/projects/checkouts.ts");
  const root = await makeRepo("fetch-source");
  const remote = path.join(base, "fetch-remote.git");
  git(base, "clone", "--bare", "-q", root, remote);
  git(root, "remote", "add", "origin", remote); git(root, "fetch", "-q", "origin");
  const { project } = await projects.createProject({ name: "Fetch efforts", repos: [existing(root)] });
  const pushFromElsewhere = async (name) => {
    const other = path.join(base, `fetch-${name}`);
    git(base, "clone", "-q", remote, other);
    git(other, "config", "user.name", "Elsewhere"); git(other, "config", "user.email", "x@example.invalid");
    await fs.writeFile(path.join(other, `${name}.txt`), name);
    git(other, "add", "."); git(other, "commit", "-qm", name); git(other, "push", "-q", "origin", "main");
  };
  await pushFromElsewhere("first");
  const ws = await projects.createWorkspace({ projectId: project.id, visibility: "project", setup: "skip" });
  assert.equal(await fs.readFile(path.join(ws.cwd, "first.txt"), "utf8"), "first", "a new effort sees commits pushed since the last fetch");
  const ctx = await projects.getWorkspaceContext(ws.id);
  await checkouts.releaseCheckouts(ctx);
  await pushFromElsewhere("second");
  require("../lib/projects/git.ts").__forgetFetches(); // the throttle would otherwise reuse the first fetch
  await checkouts.restoreCheckouts(ctx);
  assert.equal(await fs.readFile(path.join(ws.cwd, "second.txt"), "utf8"), "second", "a restored effort starts from the remote's latest");
});
