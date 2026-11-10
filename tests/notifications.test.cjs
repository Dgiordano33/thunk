/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through the installed compiler. */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const repo = require("../lib/supabase/repo/notifications.ts");
const service = require("../lib/notifications/service.ts");
const { subscribeNotifications } = require("../lib/notifications/events.ts");
const { sessionNotification } = require("../lib/notifications/session.ts");
const { sessionIsStuck } = require("../lib/notifications/stuck.ts");
const { deliveryNotifications } = require("../lib/notifications/delivery.ts");
const { notificationTools } = require("../lib/notifications/tools.ts");
const base = { projectId: "project", kind: "permission", urgency: "action", subjectKey: "session:a:req:1", title: "Allow?", href: "/w/w/s/a", sessionId: "a" };
beforeEach(() => { globalThis.__thunkMemNotifications.clear(); globalThis.__thunkPendingChecks.clear(); });

test("concurrent upserts share a row and emit opened only once", async () => {
  const events = []; const off = subscribeNotifications((e) => events.push(e));
  const rows = await Promise.all(Array.from({ length: 10 }, () => service.notify(base)));
  off();
  assert.equal(new Set(rows.map((n) => n.id)).size, 1);
  assert.equal(events.filter((e) => e.kind === "opened").length, 1);
  assert.equal((await repo.countOpen()).action, 1);
  await service.resolveBySubject(base.subjectKey);
  assert.equal((await repo.countOpen()).total, 0);
  assert.equal((await repo.listNotifications({ status: "all" }))[0].status, "resolved");
});
test("reading info resolves it without resolving an action of the same kind", async () => {
  const a = await service.notify({ ...base, kind: "agent_request" });
  const b = await service.notify({ ...base, kind: "agent_request", urgency: "info", subjectKey: "info" });
  await service.markRead([a.id, b.id]);
  const rows = await repo.listNotifications({ status: "all" });
  assert.equal(rows.find((n) => n.id === a.id).status, "open");
  assert.equal(rows.find((n) => n.id === b.id).status, "resolved");
  assert.ok(rows.every((n) => n.readAt));
  await service.dismiss(a.id);
  assert.equal((await repo.countOpen()).total, 0);
});
test("project counts, scoped dismissal, history and bounded memory fallback", async () => {
  await service.notify(base);
  await service.notify({ ...base, projectId: "other", subjectKey: "other" });
  assert.deepEqual((await repo.countOpen()).byProject, { project: 1, other: 1 });
  await service.dismissAll("project");
  assert.equal((await repo.listNotifications())[0].projectId, "other");
  for (let i = 0; i < 510; i++) await repo.openNotification({ ...base, subjectKey: `row:${i}` });
  assert.equal((await repo.listNotifications({ status: "all", limit: 500 })).length, 500);
  assert.equal(globalThis.__thunkMemNotifications.size, 500);
});
test("session requests have usable actions, resolve on answer, and close clears pending requests", async () => {
  const live = { id: "a", meta: { projectId: "project", workspaceId: "w", status: "running", createdAt: new Date(0).toISOString() }, events: [] };
  await sessionNotification(live, { type: "permission_request", requestId: "1", toolName: "Bash", input: { command: "pwd" } });
  const row = (await repo.listNotifications())[0];
  assert.equal(row.actions[0].path, "/api/sessions/a/permission");
  assert.deepEqual(row.actions[0].body, { requestId: "1", decision: "allow" });
  await sessionNotification(live, { type: "permission_resolved", requestId: "1" });
  assert.equal((await repo.countOpen()).action, 0);
  await sessionNotification(live, { type: "ask_question", requestId: "2", questions: [{ question: "Which?", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] });
  assert.equal((await repo.listNotifications())[0].actions.length, 2);
  await sessionNotification(live, { type: "status", state: "closed" });
  assert.equal((await repo.countOpen()).action, 0);
  live.meta.origin = { kind: "routine" };
  await sessionNotification(live, { type: "result", seq: 4, isError: false });
  assert.equal((await repo.countOpen()).total, 0);
  assert.equal(sessionIsStuck(live, 600001), true);
  live.events.push({ ts: 600000 });
  assert.equal(sessionIsStuck(live, 600001), false);
  live.meta.status = "awaiting";
  assert.equal(sessionIsStuck(live, 9999999), false);
});
test("delivery is project scoped, detects stuck CI once, and clears requests on merge", async () => {
  const snapshot = { id: "pr", state: "OPEN", pr: { number: 1, title: "Fix", url: "https://github.com/a/b/pull/1", head: "a" }, checks: [{ state: "pending" }], requests: [] };
  const previous = { seq: 0, events: [] };
  await deliveryNotifications("p", previous, previous, [snapshot], 0);
  await deliveryNotifications("p", previous, previous, [snapshot], 1800001);
  let rows = await repo.listNotifications(); assert.equal(rows[0].kind, "ci_stuck");
  await service.dismiss(rows[0].id);
  await deliveryNotifications("p", previous, previous, [snapshot], 1900000);
  assert.equal((await repo.countOpen()).total, 0);
  const failed = { seq: 1, events: [{ seq: 1, id: "f", type: "ci_failed", pr: snapshot.pr }] };
  await deliveryNotifications("p", previous, failed, [{ ...snapshot, checks: [{ state: "fail" }] }]);
  await deliveryNotifications("q", previous, failed, [{ ...snapshot, checks: [{ state: "fail" }] }]);
  assert.equal((await repo.countOpen()).action, 2);
  const merged = { seq: 2, events: [{ seq: 2, id: "m", type: "pr_merged", pr: snapshot.pr }] };
  await deliveryNotifications("p", failed, merged, [{ ...snapshot, state: "MERGED" }]);
  rows = await repo.listNotifications();
  assert.equal(rows.filter((n) => n.kind === "ci_failed").length, 1);
  assert.equal(rows.find((n) => n.kind === "pr_merged").urgency, "info");
});
test("notify tool validates untrusted input and binds scope to the calling session", async () => {
  const tool = notificationTools({ projectId: "p", workspaceId: "w", sessionId: "s" })[0];
  assert.equal((await tool.handler({ title: "" })).isError, true);
  assert.equal((await tool.handler({ title: "Hi", projectId: "other" })).isError, true);
  assert.equal((await tool.handler({ title: "Need help" })).isError, false);
  const row = (await repo.listNotifications())[0];
  assert.equal(row.projectId, "p"); assert.equal(row.urgency, "action");
});
test("pagination does not lose rows with identical timestamps", async () => {
  for (let i = 0; i < 7; i++) {
    const { row } = await repo.openNotification({ ...base, subjectKey: `page:${i}` });
    globalThis.__thunkMemNotifications.set(row.id, { ...row, createdAt: "2026-11-08T00:00:00.000Z" });
  }
  const seen = [];
  let before, beforeId;
  for (;;) {
    const page = await repo.listNotifications({ limit: 2, before, beforeId });
    if (!page.length) break;
    seen.push(...page.map((n) => n.id));
    before = page.at(-1).createdAt; beforeId = page.at(-1).id;
  }
  assert.equal(new Set(seen).size, 7);
  assert.equal(seen.length, 7);
});
test("installed producers detect silence, clear on new activity, and observe setup failures once", async () => {
  const live = { id: "live", meta: { projectId: "p", workspaceId: "w", status: "running", createdAt: new Date(0).toISOString() }, events: [{ ts: 0 }] };
  let subscriber, tick;
  const originalLoad = Module._load;
  const originalInterval = globalThis.setInterval;
  const registry = { listLiveSessions: () => [live], onSessionCreated: () => {}, subscribe: (_live, fn) => { subscriber = fn; } };
  Module._load = function (request, ...rest) { return request === "@/lib/agent" ? registry : originalLoad.call(this, request, ...rest); };
  globalThis.setInterval = (fn) => { tick = fn; return { unref() {} }; };
  try {
    const { ensureNotificationProducers } = require("../lib/notifications/producers.ts");
    ensureNotificationProducers(); ensureNotificationProducers();
  } finally { Module._load = originalLoad; globalThis.setInterval = originalInterval; }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  tick(); await flush();
  assert.equal((await repo.listNotifications())[0].kind, "session_stuck");
  subscriber({ type: "text_delta", ts: Date.now() }); await flush();
  assert.equal((await repo.countOpen()).total, 0);
  const { projectEvents } = require("../lib/projects/events.ts");
  projectEvents().emit("setup_failed", { projectId: "p", workspaceId: "w", exitCode: 1, tail: "Setup failed" });
  await flush();
  const rows = await repo.listNotifications();
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, "script_failed");
  assert.match(rows[0].title, /Setup/);
});

test("delivery batches reconciliation, preserves project scope, and emits every resolved row", async (t) => {
  const history = { seq: 0, events: [] };
  const snapshots = Array.from({ length: 50 }, (_, number) => ({
    id: `pr-${number}`, state: "CLOSED", pr: { number, title: "Done", url: "/", head: "a" }, checks: [], requests: [],
  }));
  for (const s of snapshots) for (const suffix of ["ci", "stuck", "review"])
    await service.notify({ ...base, projectId: "p", subjectKey: `project:p:pr:${s.pr.number}:${suffix}` });
  await service.notify({ ...base, projectId: "q", subjectKey: "project:q:pr:0:ci" });
  const calls = [];
  const original = service.resolveWhere;
  t.mock.method(service, "resolveWhere", (match) => { calls.push(match); return original(match); });
  const events = [];
  const off = subscribeNotifications((event) => events.push(event));
  t.after(off);
  await deliveryNotifications("p", history, history, snapshots);
  assert.deepEqual(calls.map((call) => call.subjectKeys.length), [100, 50]);
  assert.ok(calls.every((call) => call.projectId === "p"));
  assert.equal(events.length, 150);
  assert.ok(events.every((event) => event.kind === "updated" && event.notification.status === "resolved"));
  assert.deepEqual((await repo.listNotifications()).map((n) => n.projectId), ["q"]);
  assert.deepEqual(await service.resolveWhere({ projectId: "p", subjectKeys: ["project:q:pr:0:ci"] }), []);
  assert.deepEqual(await service.resolveWhere({ projectId: "q", subjectKeys: [] }), []);

  calls.length = 0;
  events.length = 0;
  // Reconcile again so a stale notification from another process is still cleared.
  await service.notify({ ...base, projectId: "p", subjectKey: "project:p:pr:0:ci" });
  events.length = 0;
  await deliveryNotifications("p", history, history, snapshots);
  assert.equal(calls.length, 2);
  assert.equal(events.length, 1);
  calls.length = 0;
  await deliveryNotifications("p", history, history, []);
  assert.equal(calls.length, 0);
});

test("delivery batch errors propagate and reconciliation can be retried", async (t) => {
  const history = { seq: 0, events: [] };
  const snapshot = { id: "pr", state: "CLOSED", pr: { number: 1, head: "a" }, checks: [], requests: [] };
  await service.notify({ ...base, projectId: "p", subjectKey: "project:p:pr:1:ci" });
  const original = service.resolveWhere;
  const mocked = t.mock.method(service, "resolveWhere", async () => { throw new Error("offline"); });
  await assert.rejects(deliveryNotifications("p", history, history, [snapshot]), /offline/);
  mocked.mock.restore();
  assert.equal((await repo.countOpen()).total, 1);
  await deliveryNotifications("p", history, history, [snapshot]);
  assert.equal((await repo.countOpen()).total, 0);
  assert.equal(service.resolveWhere, original);
});

test("database reconciliation sends one scoped PATCH with all subjects and surfaces failures", async (t) => {
  const { createClient } = require("@supabase/supabase-js");
  const requests = [];
  let fail = false;
  const client = createClient("https://database.example", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return new Response(JSON.stringify(fail ? { message: "offline" } : []), {
        status: fail ? 400 : 200, headers: { "content-type": "application/json" },
      });
    } },
  });
  t.mock.method(require("../lib/supabase/server.ts"), "db", () => client);
  assert.deepEqual(await repo.resolveWhere({ projectId: "p", subjectKeys: ["pr:1:ci", "pr:2:ci"] }), []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, "PATCH");
  assert.equal(requests[0].url.searchParams.get("project_id"), "eq.p");
  assert.equal(requests[0].url.searchParams.get("status"), "eq.open");
  assert.equal(requests[0].url.searchParams.get("subject_key"), 'in.(pr:1:ci,pr:2:ci)');
  assert.equal(requests[0].url.searchParams.get("select"), "*");
  fail = true;
  await assert.rejects(repo.resolveWhere({ projectId: "p", subjectKeys: ["pr:1:ci"] }), { message: "offline" });
});
