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
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
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
const projects = require("../lib/projects/index.ts");
const paths = require("../lib/projects/paths.ts");
const { getProject } = require("../lib/supabase/repo/projects.ts");
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

test("a project with no repos has a main workspace in its home directory, and creates isolated non-git workspaces", async () => {
  const { project, workspace, repos } = await projects.createProject({ name: "Empty Idea", repos: [] });
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
  const { project, workspace } = await projects.createProject({ name: "Grows", repos: [] });
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
  const { project, workspace } = await projects.createProject({ name: "Mixed", repos: [existing(docs), existing(code)] });
  assert.deepEqual(project.repos.map((r) => r.kind), ["folder", "repo"]);
  assert.deepEqual(workspaceRepoTargets({ project, workspace }).map((t) => t.root), [code]);

  const ws = await projects.createWorkspace({ projectId: project.id, name: "mixed-branch", setup: "skip" });
  assert.equal(ws.cwd, path.join(code, ".claude", "worktrees", "mixed-branch"), "sessions start in the worktree, not the leading folder");
  assert.deepEqual(ws.repos.map((r) => [r.name, r.worktreePath !== null]), [["docs-folder", false], ["code", true]]);

  const onlyFolder = await projects.createProject({ name: "Folder Only", repos: [existing(await makeFolder("only-folder"))] });
  const folderWorkspace = await projects.createWorkspace({ projectId: onlyFolder.project.id, setup: "skip" });
  assert.equal(folderWorkspace.cwd, onlyFolder.workspace.cwd);
  assert.equal(folderWorkspace.branch, null);
  assert.equal((await projects.contextForDirectory(folderWorkspace.cwd)).workspace.id, onlyFolder.workspace.id);
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
  assert.equal(result.workspace.cwd, left);
  assert.deepEqual(result.workspace.repos.map((r) => r.name), ["left", "right", "brand-new"]);
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
  const { project, workspace } = await projects.createProject({ name: "Folder removal", repos: [existing(await makeFolder("remove-folder"))] });
  const extra = await projects.createWorkspace({ projectId: project.id });
  await projects.removeProjectRepo(project.id, project.repos[0].id);
  const a = await projects.getWorkspaceContext(workspace.id);
  const b = await projects.getWorkspaceContext(extra.id);
  assert.notEqual(a.workspace.cwd, b.workspace.cwd);
});
