/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mkdtempSync } = require("node:fs");
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

const base = mkdtempSync(path.join(os.tmpdir(), "thunk-multi-repo-"));
process.env.THUNK_DATA_DIR = path.join(base, "data");
const projects = require("../lib/projects/index.ts");
const { extraReposPrompt, extraRepoDirectories } = require("../lib/projects/repos-prompt.ts");

test.after(() => fs.rm(base, { recursive: true, force: true }));

function git(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function makeRepo(name) {
  const dir = path.join(base, name);
  await fs.mkdir(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "Multi-repo test"); git(dir, "config", "user.email", "test@example.invalid");
  await fs.writeFile(path.join(dir, "README"), `${name}\n`);
  git(dir, "add", "."); git(dir, "commit", "-m", "base");
  return dir;
}

test("a workspace spans every repo of a multi-repo project", async () => {
  const web = await makeRepo("web");
  const api = await makeRepo("api");
  const docs = await makeRepo("docs");

  let project = await projects.addProject(web);
  const main = await projects.ensureMainWorkspace(project);
  assert.deepEqual(project.extraRepos, []);

  const apiRepo = await projects.addProjectRepo(project.id, api);
  const docsRepo = await projects.addProjectRepo(project.id, path.join(docs, "."), { name: "handbook" });
  assert.equal(apiRepo.name, "api");
  assert.equal(apiRepo.defaultBranch, "main");
  assert.equal(docsRepo.name, "handbook");
  await assert.rejects(projects.addProjectRepo(project.id, api), /already/);
  await assert.rejects(projects.addProjectRepo(project.id, web), /primary/);
  await assert.rejects(projects.addProjectRepo(project.id, base), /Not a git repository/);

  // The main workspace works on every extra repo in place.
  const mainCtx = await projects.getWorkspaceContext(main.id);
  assert.deepEqual(mainCtx.workspace.extraRepos.map((r) => [r.name, r.cwd, r.worktreePath]), [["api", api, null], ["handbook", docs, null]]);
  project = mainCtx.project;
  assert.deepEqual(project.extraRepos.map((r) => r.id), [apiRepo.id, docsRepo.id]);

  // A branch workspace gets a worktree in the primary repo and in each chosen extra repo, all on one branch.
  const ws = await projects.createWorkspace({ projectId: project.id, name: "lisbon", repoIds: [apiRepo.id], setup: "skip" });
  assert.equal(ws.branch, "thunk/lisbon");
  assert.equal(ws.extraRepos.length, 1);
  const [apiCheckout] = ws.extraRepos;
  assert.equal(apiCheckout.name, "api");
  assert.equal(apiCheckout.branch, "thunk/lisbon");
  assert.equal(apiCheckout.cwd, path.join(api, ".claude", "worktrees", "lisbon"));
  assert.equal(git(apiCheckout.cwd, "branch", "--show-current"), "thunk/lisbon");
  assert.equal(git(ws.cwd, "branch", "--show-current"), "thunk/lisbon");
  await assert.rejects(fs.stat(path.join(docs, ".claude", "worktrees", "lisbon")));

  // Agents are told where each repo is and may work in them.
  const ctx = await projects.getWorkspaceContext(ws.id);
  const prompt = extraReposPrompt(ctx.workspace).join("\n");
  assert.match(prompt, /multi-repo workspace/);
  assert.ok(prompt.includes(`**api**: git worktree at \`${apiCheckout.cwd}\` on branch \`thunk/lisbon\``));
  assert.deepEqual(extraRepoDirectories(ctx.workspace), [apiCheckout.cwd]);
  assert.deepEqual(extraReposPrompt({ ...ws, extraRepos: [] }), []);

  // A repo with worktrees can't be dropped; unmerged work in any repo blocks deleting the workspace.
  await assert.rejects(projects.removeProjectRepo(project.id, apiRepo.id), /still has worktrees in: lisbon/);
  await fs.writeFile(path.join(apiCheckout.cwd, "endpoint"), "new\n");
  git(apiCheckout.cwd, "add", "."); git(apiCheckout.cwd, "commit", "-m", "endpoint");
  await assert.rejects(projects.removeWorkspace(ws.id, { removeWorktree: true }), /unmerged commits in api/);
  git(api, "merge", "--no-edit", "thunk/lisbon");

  await projects.removeWorkspace(ws.id, { removeWorktree: true, removeMemory: true });
  await assert.rejects(fs.stat(apiCheckout.cwd));
  await assert.rejects(fs.stat(ws.cwd));
  assert.doesNotMatch(git(api, "worktree", "list"), /lisbon/);

  // With no worktrees left, the repo can go; the main workspace forgets its in-place checkout.
  await projects.removeProjectRepo(project.id, apiRepo.id);
  const after = await projects.getWorkspaceContext(main.id);
  assert.deepEqual(after.project.extraRepos.map((r) => r.name), ["handbook"]);
  assert.deepEqual(after.workspace.extraRepos.map((r) => r.name), ["handbook"]);
});

test("a failed worktree in one repo rolls back the others", async () => {
  const one = await makeRepo("one");
  const two = await makeRepo("two");
  const project = await projects.addProject(one);
  await projects.ensureMainWorkspace(project);
  await projects.addProjectRepo(project.id, two);
  // Occupy the worktree path in the extra repo so its `git worktree add` fails.
  await fs.mkdir(path.join(two, ".claude", "worktrees", "oslo", "taken"), { recursive: true });
  await assert.rejects(projects.createWorkspace({ projectId: project.id, name: "oslo", setup: "skip" }));
  await assert.rejects(fs.stat(path.join(one, ".claude", "worktrees", "oslo")));
  assert.doesNotMatch(git(one, "worktree", "list"), /oslo/);
});

test("workspaces without worktrees use every extra repo in place", async () => {
  const a = await makeRepo("alpha");
  const b = await makeRepo("beta");
  const project = await projects.addProject(a);
  await projects.ensureMainWorkspace(project);
  await projects.addProjectRepo(project.id, b);
  const ws = await projects.createWorkspace({ projectId: project.id, name: "quito", worktree: false, setup: "skip" });
  assert.equal(ws.cwd, a);
  assert.deepEqual(ws.extraRepos.map((r) => [r.cwd, r.worktreePath]), [[b, null]]);
});
