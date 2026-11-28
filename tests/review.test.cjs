/* eslint-disable @typescript-eslint/no-require-imports -- Server TypeScript compiler harness. */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { promisify } = require("node:util");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

// A `gh` and `git` stub, as tests/delivery.test.cjs does: every call is recorded, PR state is scripted.
let calls = [];
let prState = null; // null: no PR yet; otherwise "OPEN" | "MERGED" | "CLOSED"
let heads = { "thunk/fix": "sha-1" };
const prJson = () => JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7", state: prState, title: "Fix", isDraft: false, statusCheckRollup: [{ __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null }], reviewDecision: "", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" });
const fakeExec = () => {};
fakeExec[promisify.custom] = async (cmd, args) => {
  calls.push([cmd, ...args]);
  if (cmd === "git" && args[0] === "symbolic-ref") return { stdout: "thunk/fix\n" };
  if (cmd === "git" && args[0] === "remote") return { stdout: "git@github.com:o/r.git\n" };
  if (cmd === "git" && args[0] === "push") return { stdout: "" };
  if (cmd === "gh" && args[1] === "view") { if (!prState) throw Object.assign(new Error("no pull requests found"), { stderr: "no pull requests found for branch" }); return { stdout: prJson() }; }
  if (cmd === "gh" && args[1] === "create") { prState = "OPEN"; return { stdout: "https://github.com/o/r/pull/7\n" }; }
  throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
};

const id = () => crypto.randomUUID();
const taskId = id(), sessionId = id(), workspaceId = id();
const repo = { id: id(), kind: "repo", path: "/repo", defaultBranch: "main", remote: "git@github.com:o/r.git" };
const workspace = { id: workspaceId, projectId: "p", cwd: "/wt", branch: "thunk/fix", repos: [{ repoId: repo.id, name: "repo", cwd: "/wt", branch: "thunk/fix", worktreePath: "/wt", baseRef: "origin/main" }] };
const ctx = { project: { id: "p", repos: [repo] }, workspace };
const session = { id: sessionId, workspaceId, projectId: "p", title: "Fix the bug", origin: { kind: "worker", taskId, chiefSessionId: null } };
let integration = null;
const resolvedWhere = [];
const mocks = {
  "server-only": {},
  "node:child_process": { execFile: fakeExec },
  "@/lib/projects": { getWorkspaceContext: async (wid) => wid === workspaceId ? ctx : null },
  "@/lib/agent": { listSessions: async () => [session], liveMeta: (sid) => sid === sessionId ? session : null },
  "@/lib/db/repo/sessions": { getSessionRow: async () => null },
  "@/lib/db/repo/tasks": { getTask: async (tid) => tid === taskId ? { id: taskId, title: "Fix the login bug", body: "Brief" } : null },
  "@/lib/db/repo/worker-reports": { latestWorkerReport: async () => ({ content: `<worker_report task="${taskId}" status="done">\nFixed the redirect loop and added a test\nBranch: thunk/fix\n</worker_report>` }) },
  "@/lib/db/repo/integrations": { latestIntegrationForTask: async () => integration },
  "@/lib/notifications/service": { resolveWhere: async (m) => { resolvedWhere.push(m); return []; } },
  "@/lib/projects/git": {
    tryGit: async (_cwd, args) => args[0] === "rev-parse" ? heads[args.at(-1).replace("refs/heads/", "")] ?? null : null,
    workspaceChanges: async () => ({ files: [{ path: "a.ts" }, { path: "b.ts" }], additions: 10, deletions: 2 }),
  },
};
const cache = new Map();
function load(name, from = path.join(root, "index.ts")) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
  let filename = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(from), name);
  if (!filename.endsWith(".ts")) filename += ".ts";
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  mod.require = (request) => load(request, filename);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const github = load("@/lib/projects/github");
const card = load("@/lib/review/card");
const { reportSummary } = load("@/lib/review/types");
beforeEach(() => { calls = []; prState = null; heads = { "thunk/fix": "sha-1" }; integration = null; resolvedWhere.length = 0; });

test("Open PR pushes the branch and creates a PR titled from the worker's report", async () => {
  const result = await github.openPullRequest(workspaceId);
  assert.equal(result.created, true);
  assert.equal(result.url, "https://github.com/o/r/pull/7");
  assert.deepEqual(calls.find((c) => c[1] === "push"), ["git", "push", "--set-upstream", "origin", "thunk/fix"]);
  const create = calls.find((c) => c[0] === "gh" && c[2] === "create");
  assert.deepEqual(create.slice(3, 7), ["--base", "main", "--head", "thunk/fix"]);
  assert.equal(create[create.indexOf("--title") + 1], "Fix the login bug");
  assert.match(create[create.indexOf("--body") + 1], /^Fixed the redirect loop and added a test\n\nTask: Fix the login bug/);
  assert.equal(result.status.pr.state, "OPEN");
});

test("Open PR returns an open PR without pushing again, and refuses a workspace it cannot open from", async () => {
  prState = "OPEN";
  const result = await github.openPullRequest(workspaceId);
  assert.equal(result.created, false);
  assert.ok(!calls.some((c) => c[1] === "push" || c[2] === "create"));
  await assert.rejects(github.openPullRequest(id()), /Workspace not found/);
});

test("the review card reports changes, the trial merge and its staleness, and the PR", async () => {
  let review = await card.reviewState(sessionId);
  assert.deepEqual(review.changes, { files: 2, additions: 10, deletions: 2 });
  assert.equal(review.integration, null);
  assert.equal(review.pr.pr, null);
  assert.equal(review.pr.canCreate, true);
  integration = {
    id: "i", workspaceId: "iw", branch: "integration-x", createdAt: "2026-11-27T00:00:00Z",
    merged: [{ taskId, title: "Fix", repo: "repo", branch: "thunk/fix", uncommitted: false }], conflicts: [],
    tests: { command: "npm test", exitCode: 0, output: "ok" }, headShas: [{ taskId, repo: "repo", branch: "thunk/fix", sha: "sha-1" }],
  };
  review = await card.reviewState(sessionId);
  assert.equal(review.integration.merged, true);
  assert.equal(review.integration.tests.state, "passed");
  assert.equal(review.integration.outOfDate, false);
  heads["thunk/fix"] = "sha-2";
  assert.equal((await card.reviewState(sessionId)).integration.outOfDate, true, "a moved branch head makes the trial merge out of date");
  integration = { ...integration, merged: [], conflicts: [{ taskId, title: "Fix", repo: "repo", branch: "thunk/fix", files: ["a.ts"] }], tests: { command: null, reason: "No scripts.test in thunk.json" } };
  review = await card.reviewState(sessionId);
  assert.equal(review.integration.merged, false);
  assert.deepEqual(review.integration.conflicts, [{ repo: "repo", files: ["a.ts"] }]);
  assert.equal(review.integration.tests.state, "not_run");
  assert.equal(resolvedWhere.length, 0);
  prState = "MERGED";
  assert.equal((await card.reviewState(sessionId)).pr.pr.state, "MERGED");
  assert.deepEqual(resolvedWhere, [{ sessionId, kinds: ["review_ready"] }], "a merged PR resolves the card");
});

test("the report summary stops at the report's metadata lines", () => {
  assert.equal(reportSummary(`<worker_report task="t">\nLine one\nLine two\nBranch: b\nDiff: {}\n</worker_report>`), "Line one\nLine two");
  assert.equal(reportSummary(null), null);
});
