/* eslint-disable @typescript-eslint/no-require-imports -- Use the existing TypeScript compiler test pattern. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function fixture() {
  let reads = 0;
  const stored = [
    { id: "a", projectId: "p", workspaceId: "w", createdAt: "2026-01-01", title: "Persisted", totalCostUsd: 4 },
    { id: "b", projectId: "p", workspaceId: "w", createdAt: "2026-01-02", title: "Other" },
  ];
  const live = [
    { id: "a", meta: { ...stored[0], title: "Live", status: "running" } },
    { id: "c", meta: { id: "c", projectId: "other", workspaceId: "elsewhere", createdAt: "2026-01-03" } },
  ];
  let fail = false;
  const mocks = {
    "server-only": {},
    "@/lib/env": {},
    "@/lib/projects": {},
    "@/lib/db/repo/messages": {},
    "@/lib/db/repo/sessions": {
      listSessionRows: async () => { reads++; if (fail) throw new Error("offline"); return stored; },
    },
    "./persist": {},
    "./session-registry": { listLiveSessions: () => live },
    "./transcripts": {},
    "@/lib/projects/checkouts": { restoreCheckouts: async () => false },
    "./types": {},
  };
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve("../lib/agent/index.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unmocked import: ${name}`);
    return mocks[name];
  }, exports);
  return { ...exports, stored, reads: () => reads, fail: () => { fail = true; } };
}

test("preloaded session rows avoid a second read and retain live overlays, ordering and limits", async () => {
  const f = fixture();
  const sessions = await f.listSessions({ projectId: "p", workspaceId: "w", limit: 2 }, f.stored);
  assert.equal(f.reads(), 0);
  assert.deepEqual(sessions.map((s) => [s.id, s.title, s.live]), [["b", "Other", false], ["a", "Live", true]]);
  assert.equal(f.stored[0].title, "Persisted");
  assert.equal(f.stored[0].totalCostUsd, 4);
  assert.deepEqual((await f.listSessions({ projectId: "p", limit: 1 }, f.stored)).map((s) => s.id), ["b"]);
  assert.deepEqual((await f.listSessions({ projectId: "p" }, [])).map((s) => s.id), ["a"]);
  assert.equal(f.reads(), 0);
});

test("existing session callers still read persistence and retain live sessions on failure", async (t) => {
  const f = fixture();
  await f.listSessions({ projectId: "p" });
  assert.equal(f.reads(), 1);
  f.fail();
  const log = t.mock.method(console, "error", () => {});
  assert.deepEqual((await f.listSessions({ projectId: "p" })).map((s) => s.id), ["a"]);
  assert.equal(log.mock.callCount(), 1);
});

test("project and directory chats allocate isolated efforts; an explicit workspace is reused", async () => {
  const calls = [];
  const workspaces = new Map([["canvas", { project: { id: "p" }, workspace: { id: "canvas", status: "active" } }]]);
  const mocks = {
    "server-only": {}, "@/lib/env": { env: { DEFAULT_MODEL: "test" } },
    "@/lib/projects": {
      projectForDirectory: async () => ({ id: "p" }),
      createWorkspace: async input => {
        calls.push(input);
        const id = `effort-${calls.length}`;
        workspaces.set(id, { project: { id: input.projectId }, workspace: { id, status: "active" } });
        return { id };
      },
      getWorkspaceContext: async id => workspaces.get(id),
    },
    "@/lib/db/repo/messages": {}, "@/lib/db/repo/sessions": {}, "./persist": {},
    "./session-registry": { createSession: async input => input }, "./transcripts": {},
    "@/lib/projects/checkouts": { restoreCheckouts: async () => false },
    "./types": { providerOf: () => "claude", permissionModesFor: () => ["default"] },
  };
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve("../lib/agent/index.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => mocks[name], exports);
  const a = await exports.startSession({ projectId: "p" });
  const b = await exports.startSession({ projectId: "p" });
  const c = await exports.startSession({ cwd: "/source" });
  assert.equal(new Set([a, b, c].map(s => s.ctx.workspace.id)).size, 3);
  assert.ok(calls.every(input => input.visibility === "project" && input.setup === undefined), "chats run setup in the background");
  assert.equal((await exports.startSession({ workspaceId: "canvas" })).ctx.workspace.id, "canvas");
  assert.equal(calls.length, 3);
  await assert.rejects(exports.startSession({ projectId: "other", workspaceId: "canvas" }), /does not belong/);
});
