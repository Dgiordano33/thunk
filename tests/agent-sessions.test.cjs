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
    "@/lib/supabase/repo/messages": {},
    "@/lib/supabase/repo/sessions": {
      listSessionRows: async () => { reads++; if (fail) throw new Error("offline"); return stored; },
    },
    "./persist": {},
    "./session-registry": { listLiveSessions: () => live },
    "./transcripts": {},
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
