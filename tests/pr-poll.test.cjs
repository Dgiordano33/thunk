/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript with the installed compiler. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { promisify } = require("node:util");

const pr = (repo, number, createdAt) => ({ number, url: `https://github.com/o/${repo}/pull/${number}`, title: `${repo} ${number}`, author: { login: "a" }, headRefName: "topic", createdAt });
const repo = (name, remote) => ({ id: name, name, path: `/${name}`, kind: "repo", remote });

function loadPoll({ project, routine, listings, failing = new Set() }) {
  const fired = [];
  const updates = [];
  const execFile = () => {};
  execFile[promisify.custom] = async (_cmd, _args, { cwd }) => {
    if (failing.has(cwd)) throw new Error("gh failed");
    return { stdout: JSON.stringify(listings[cwd] ?? []) };
  };
  const stubs = {
    "node:child_process": { execFile },
    "@/lib/projects/repos": { gitRepos: (p) => p.repos.filter((r) => r.kind === "repo") },
    "@/lib/supabase/repo/projects": { getProject: async () => project },
    "@/lib/supabase/repo/routines": {
      listEnabledRoutines: async () => [routine],
      updateRoutine: async (_id, patch) => { updates.push(patch); routine.triggerState = patch.triggerState; },
    },
    "./runner": { fire: async (_r, _event, payload) => void fired.push(payload.pr.url) },
    "server-only": {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../lib/routines/pr-poll.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => stubs[name] ?? require(name), exports);
  return { poll: exports.pollPullRequests, fired, updates };
}

test("PR numbers that repeat across repos each fire once", async () => {
  const project = { id: "p", name: "P", repos: [repo("one", "git@x:o/one"), repo("two", "git@x:o/two"), repo("local", null)] };
  const routine = { id: "r", projectId: "p", triggerState: { prSeenAt: "2026-01-01T00:00:00Z", prSeen: [] } };
  const listings = { "/one": [pr("one", 7, "2026-02-01T00:00:00Z")], "/two": [pr("two", 7, "2026-02-02T00:00:00Z")] };
  const { poll, fired } = loadPoll({ project, routine, listings });
  await poll();
  assert.deepEqual(fired, ["https://github.com/o/one/pull/7", "https://github.com/o/two/pull/7"]);
  await poll();
  assert.equal(fired.length, 2, "seen URLs don't fire again");
});

test("a repo that fails to list holds the cursor for the whole project", async () => {
  const project = { id: "p", name: "P", repos: [repo("one", "git@x:o/one"), repo("two", "git@x:o/two")] };
  const routine = { id: "r", projectId: "p", triggerState: { prSeenAt: "2026-01-01T00:00:00Z", prSeen: [] } };
  const listings = { "/one": [pr("one", 1, "2026-02-01T00:00:00Z")] };
  const { poll, fired, updates } = loadPoll({ project, routine, listings, failing: new Set(["/two"]) });
  await poll();
  assert.deepEqual(fired, []);
  assert.deepEqual(updates, []);
});

test("a project with no remote repos is skipped", async () => {
  const project = { id: "p", name: "P", repos: [] };
  const routine = { id: "r", projectId: "p", triggerState: {} };
  const { poll, updates } = loadPoll({ project, routine, listings: {} });
  await poll();
  assert.deepEqual(updates, []);
});
