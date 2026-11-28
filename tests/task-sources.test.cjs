/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
// The repos read one shared stub, so each test points them at its own in-memory Postgres.
const server = { db: () => null };
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "../server") return server;
  return load.call(this, request, parent, isMain);
};

const sources = require("../lib/db/repo/task-sources.ts");
const documents = require("../lib/db/repo/documents.ts");
const reports = require("../lib/db/repo/worker-reports.ts");
const plans = require("../lib/db/repo/delegation-plans.ts");
const { buildSourceRevisionPayload, buildTaskUpdatePayload } = require("../lib/sources/payloads.ts");
const { criteriaToText, diffLines, parseCriteriaText, stampLabel } = require("../lib/sources/types.ts");

async function withDb(t) {
  const { testDb } = require("./helpers/test-db.cjs");
  const db = await testDb();
  t.after(() => { server.db = () => null; return db.close(); });
  server.db = () => db;
  const [p] = await db.query("insert into projects (name, data_key, slug) values ('P', 'p', 'p') returning id");
  const [w] = await db.query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'main', 'main', '/src') returning id", [p.id]);
  const sessionId = crypto.randomUUID();
  await db.query("insert into sessions (id, workspace_id, cwd, model, permission_mode) values ($1, $2, '/src', 'm', 'default')", [sessionId, w.id]);
  const task = async (title) => (await db.query("insert into tasks (project_id, title) values ($1, $2) returning id", [p.id, title]))[0].id;
  return { db, projectId: p.id, sessionId, task };
}

test("task sources, plan changes and report stamps round-trip through Postgres", async (t) => {
  const { db, projectId, sessionId, task } = await withDb(t);
  const a = await task("A"), b = await task("B");
  const link = await sources.linkTaskSource({ taskId: a, kind: "document", sourceId: "d1", contentHash: "h1", content: "one" });
  assert.deepEqual([link.version, link.deliveredVersion, link.content], [1, 1, "one"]);
  await sources.linkTaskSource({ taskId: b, kind: "document", sourceId: "d1", contentHash: "h1", content: "one" });
  await sources.linkTaskSource({ taskId: a, kind: "note", sourceId: "brief", contentHash: "n", content: "note" });
  assert.deepEqual((await sources.listTaskSources(a)).map((s) => s.kind), ["document", "note"], "documents first");
  // Linking again keeps the versions.
  const [revised] = await sources.reviseTaskSources([{ taskId: a, kind: "document", sourceId: "d1" }], "two", "h2");
  assert.deepEqual([revised.version, revised.content, revised.contentHash], [2, "two", "h2"]);
  assert.equal((await sources.linkTaskSource({ taskId: a, kind: "document", sourceId: "d1", contentHash: "x", content: "x" })).version, 2);
  assert.deepEqual((await sources.tasksForSources("document", ["d0", "d1"])).map((s) => s.taskId).sort(), [a, b].sort());
  await sources.setDeliveredVersion({ taskId: a, kind: "document", sourceId: "d1" }, 2);
  await sources.setDeliveredVersion({ taskId: a, kind: "document", sourceId: "d1" }, 1);
  assert.equal((await sources.listTaskSources(a))[0].deliveredVersion, 2, "delivered never moves backwards");

  const change = await sources.insertPlanChange({ projectId, kind: "document", sourceId: "d1", sourceTitle: "Plan", version: 2, diff: "<edits/>", chiefSessionId: null, items: [{ taskId: a, title: "A", affected: false, summary: "", brief: null, criteria: null, previousBrief: null, previousCriteria: null, decision: "pending", delivery: null }] });
  assert.equal(change.status, "waiting");
  const opened = await sources.updatePlanChange(change.id, ["waiting"], { status: "open", items: [{ ...change.items[0], affected: true, summary: "S", brief: "B" }] });
  assert.equal(opened.items[0].brief, "B");
  assert.equal(await sources.updatePlanChange(change.id, ["waiting"], { status: "dismissed" }), null, "a change that moved on is not updated twice");
  const applied = await sources.updatePlanChange(change.id, ["open"], { status: "applied" });
  assert.ok(applied.resolvedAt);
  assert.equal((await sources.getPlanChange(change.id)).status, "applied");
  assert.equal(await sources.getPlanChange("not-a-uuid"), null);
  await db.query("insert into notifications (kind, urgency, project_id, subject_key, title, href) values ('plan_changed', 'action', $1, 'plan-change:x', 'T', '/inbox')", [projectId]);

  const stamp = { kind: "document", sourceId: "d1", version: 2, latest: 3 };
  await reports.saveWorkerReport(projectId, { sessionId, seq: 4, content: "r", chiefSessionId: null, delivered: true, sourceVersion: stamp });
  assert.deepEqual((await reports.latestWorkerReport(sessionId)).sourceVersion, stamp);
  assert.equal(stampLabel(stamp), "Implements plan v2");

  const planId = crypto.randomUUID();
  await plans.insertPlan(projectId, { id: planId, chiefSessionId: sessionId, summary: "S", tasks: [{ key: "k", title: "T", brief: "B" }], sourceDocumentId: "doc-1", status: "pending", createdAt: new Date().toISOString(), decidedAt: null, note: null, taskIds: {} });
  assert.equal((await plans.getDelegationPlan(planId)).sourceDocumentId, "doc-1");

  // A revision of a later version of a document is a revision of the same plan.
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  await documents.insertDocument({ id: first, sessionId, kind: "response", version: 1, markdown: "# Plan\n" });
  await documents.insertDocument({ id: second, sessionId, kind: "response", version: 2, parentDocumentId: first, markdown: "# Plan v2\n" });
  assert.deepEqual(await documents.documentLineage(second), [second, first]);
  assert.equal((await documents.getDocument(second)).markdown, "# Plan v2\n");
});

test("the source revision and task update messages carry the diff, the tasks and the new brief", () => {
  const payload = buildSourceRevisionPayload({ changeId: "c", kind: "note", sourceId: "brief", title: "Brief <x>", version: 3, before: "a\nb\n", after: "a\nc\n", tasks: [{ id: "t1", title: "T", status: "in_progress", brief: "Do b", criteria: [{ id: "c1", text: "b works", kind: "test" }], working: true }] });
  assert.match(payload, /^<source_revision id="c" source="note" source_id="brief" title="Brief &lt;x&gt;" version="3">/);
  assert.match(payload, /tasks_revise once with revisionId "c"/);
  assert.match(payload, /-b\n\+c/);
  assert.match(payload, /<current_note>\na\nc\n<\/current_note>/);
  assert.match(payload, /<task id="t1" title="T" status="in_progress" worker="running">\n<brief>\nDo b\n<\/brief>\n<criteria>\n- c1 \(test\): b works/);
  const update = buildTaskUpdatePayload({ taskId: "t1", kind: "document", version: 2, summary: "Inbox only", brief: "New brief", criteria: null, criteriaBrief: null });
  assert.match(update, /^<task_update task="t1" source="document" version="2">\nThe plan for your task changed and the person approved this update: Inbox only/);
  assert.match(update, /<brief>\nNew brief\n<\/brief>\n<\/task_update>$/);
});

test("criteria edit as kind: text lines, and diffs split into marked lines", () => {
  const criteria = [{ id: "c1", text: "Tests pass", kind: "test" }, { id: "c2", text: "Looks right", kind: "visual" }];
  assert.equal(criteriaToText(criteria), "test: Tests pass\nvisual: Looks right");
  assert.deepEqual(parseCriteriaText("test: Tests pass\n- Shows in the Inbox\nnote: kept as text", criteria), [
    { id: "c1", text: "Tests pass", kind: "test" },
    { id: "c2", text: "Shows in the Inbox", kind: "other" },
    { text: "note: kept as text", kind: "other" },
  ]);
  assert.deepEqual(diffLines('<edits format="unified-diff" stat="+1 -1">\n--- before.md\n+++ after.md\n@@ -1 +1 @@\n-a\n+b\n</edits>').map((l) => l.kind), ["hunk", "remove", "add"]);
});
