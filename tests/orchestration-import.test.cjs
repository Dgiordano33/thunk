/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through the installed compiler. */
// Orchestration state that older versions kept in files is imported into Postgres once, at startup.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-import-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
process.env.THUNK_DATA_DIR = tmp;
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
let current = null;
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "../server" || request === "./server" || request === "@/lib/db/server") return { db: () => current, hasDatabase: () => Boolean(current) };
  return load.call(this, request, parent, isMain);
};
const { testDb } = require("./helpers/test-db.cjs");
const { importStateFiles } = require("../lib/db/import-files.ts");
const plans = require("../lib/db/repo/delegation-plans.ts");
const integrations = require("../lib/db/repo/integrations.ts");
const workerState = require("../lib/db/repo/worker-state.ts");

const id = () => crypto.randomUUID();
const configDir = (key) => path.join(tmp, "projects", key, "config");
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
// Postgres prints timestamps as `…+00:00`; compare instants, not spellings.
const instants = (value) => JSON.parse(JSON.stringify(value), (_k, v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : v);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

async function withDb(t) {
  fs.rmSync(path.join(tmp, "projects"), { recursive: true, force: true });
  current = await testDb();
  t.after(async () => { await current.close(); current = null; });
  const [project] = await current.query("insert into projects (name, data_key, slug) values ('App', 'app', 'app') returning id");
  return project.id;
}

test("plans and the current integration move from workers/state.json into Postgres, once", async (t) => {
  const projectId = await withDb(t);
  const [planId, chiefId, copyTask, workspaceId] = [id(), id(), id(), id()];
  const file = path.join(configDir("app"), "workers", "state.json");
  write(file, {
    queue: [{ taskId: id(), chiefSessionId: chiefId, input: { title: "Kept" }, dependsOn: [], queuedAt: "2026-11-20T10:00:00.000Z" }],
    plans: { [planId]: {
      id: planId, chiefSessionId: chiefId, status: "approved", createdAt: "2026-11-20T09:00:00.000Z", decidedAt: "2026-11-20T09:05:00.000Z", note: "Go",
      summary: "Ship onboarding", noteId: "brief", taskIds: { copy: copyTask },
      tasks: [{ key: "copy", title: "Copy", brief: "Write it", model: "claude-sonnet-5-5" }, { key: "email", title: "Email", brief: "Send it", dependsOn: ["copy"], race: ["a", "b"] }],
    } },
    integrations: [{ workspaceId, taskIds: [copyTask], createdAt: "2026-11-20T11:00:00.000Z" }],
  });

  await importStateFiles();
  const plan = await plans.getDelegationPlan(planId);
  assert.equal(plan.projectId, projectId);
  assert.equal(plan.status, "approved");
  assert.equal(plan.note, "Go");
  assert.equal(plan.noteId, "brief");
  assert.deepEqual(plan.taskIds, { copy: copyTask });
  assert.deepEqual(plan.tasks, [
    { key: "copy", title: "Copy", brief: "Write it", model: "claude-sonnet-5-5", taskId: copyTask },
    { key: "email", title: "Email", brief: "Send it", dependsOn: ["copy"], race: ["a", "b"], taskId: null },
  ]);
  const integration = await integrations.latestIntegrationForTask(copyTask);
  assert.equal(integration.workspaceId, workspaceId);
  assert.equal(integration.merged, null, "imported integrations have no stored result");
  assert.deepEqual((await integrations.currentIntegrations(projectId)).map((i) => i.workspaceId), [workspaceId]);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(`${file}.imported`), "the file is renamed once imported");

  // An old copy restored next to it imports again without duplicating anything.
  write(file, { ...read(`${file}.imported`), plans: { [planId]: { ...plan, status: "pending" } } });
  await importStateFiles();
  assert.equal((await plans.getDelegationPlan(planId)).status, "approved");
  assert.equal((await current.query("select count(*)::int as n from integrations"))[0].n, 1);
});

test("the queue, races, task stats and relay ledger move from workers/state.json into Postgres", async (t) => {
  const projectId = await withDb(t);
  const [first, second, dep, raceTask, raceId, s1, s2, relayId, chiefId] = Array.from({ length: 9 }, id);
  const file = path.join(configDir("app"), "workers", "state.json");
  const stats = { taskId: raceTask, title: "Race", models: ["a", "b"], mode: "worktree", startedAt: "2026-11-20T08:00:00.000Z", finishedAt: "2026-11-20T08:30:00.000Z", durationMs: 1_800_000, costUsd: 0.5, rounds: 1, outcome: "done", counted: [`${s1}:7`] };
  const fixture = {
    queue: [
      { taskId: second, chiefSessionId: chiefId, input: { title: "Second", race: ["a", "b"] }, dependsOn: [dep], queuedAt: "2026-11-20T10:00:00.000Z" },
      { taskId: first, chiefSessionId: null, input: { title: "First", relayId }, dependsOn: [], queuedAt: "2026-11-20T09:00:00.000Z" },
    ],
    races: { [raceId]: { id: raceId, taskId: raceTask, entries: [{ sessionId: s1, workspaceId: id(), model: "a" }, { sessionId: s2, workspaceId: id(), model: "b" }], winner: s2, createdAt: "2026-11-20T08:00:00.000Z" } },
    stats: { [raceTask]: stats },
    relayTasks: { [relayId]: { [`id:${first}`]: first, "first": first } },
  };
  write(file, fixture);
  await importStateFiles();

  const queue = await workerState.listQueue(projectId);
  assert.deepEqual(queue.map((q) => q.taskId), [second, first], "the file's order is kept");
  assert.deepEqual(instants(queue[0]), instants(fixture.queue[0]));
  assert.equal(await workerState.isQueued(first), true);
  assert.deepEqual(instants(await workerState.getRace(raceId)), instants(fixture.races[raceId]));
  assert.equal((await workerState.findRace(raceTask, s1)).id, raceId);
  assert.equal(await workerState.setRaceWinner(raceId, s1), false, "an imported winner stays");
  assert.deepEqual(instants(await workerState.getTaskStats(raceTask)), instants(stats));
  assert.equal(await workerState.relayTaskId(relayId, "first"), first);
  assert.deepEqual(await workerState.relayTaskIds(relayId), [first]);
  assert.equal(fs.existsSync(file), false);

  // The counted key stops a recovered report from being counted twice.
  assert.equal((await workerState.countTaskFinish(raceTask, `${s1}:7`, { costUsd: 1, ownsTask: true, outcome: "done" })).rounds, 1);
  const counted = await workerState.countTaskFinish(raceTask, `${s2}:9`, { costUsd: 0.25, ownsTask: true, outcome: "blocked" });
  assert.deepEqual([counted.rounds, counted.costUsd, counted.outcome], [2, 0.75, "blocked"]);

  write(file, fixture);
  await importStateFiles();
  assert.equal((await workerState.listQueue(projectId)).length, 2, "importing again adds nothing");
  assert.equal((await workerState.getTaskStats(raceTask)).rounds, 2, "nor overwrites newer rows");
  assert.equal(await workerState.enqueueDelegation(projectId, { taskId: id(), chiefSessionId: null, input: {}, dependsOn: [], queuedAt: new Date().toISOString() }), 3);
  assert.equal(await workerState.dequeueDelegation(first), true);
  assert.equal(await workerState.dequeueDelegation(first), false, "only one caller dequeues a task");
});

test("no state file is fine, and memory-only mode leaves files alone", async (t) => {
  await withDb(t);
  await importStateFiles();
  assert.equal(fs.existsSync(path.join(configDir("app"), "workers", "state.json")), false, "no file is created");
  const db = current;
  current = null;
  const file = path.join(configDir("app"), "workers", "state.json");
  write(file, { plans: { [id()]: {} } });
  await importStateFiles();
  assert.ok(read(file).plans, "memory-only mode does not touch the file");
  current = db;
});

test("Postgres: a new trial merge replaces the current one in one transaction, and a plan is decided once", async (t) => {
  const projectId = await withDb(t);
  const [task, first, second] = [id(), id(), id()];
  const base = { projectId, branch: "thunk/integration", taskIds: [task], merged: [], conflicts: [], tests: { command: null, reason: "Tests not requested" }, headShas: [{ taskId: task, repo: "app", branch: "b", sha: "abc" }] };
  assert.deepEqual((await integrations.recordIntegration({ ...base, workspaceId: first })).replaced, []);
  const { replaced } = await integrations.recordIntegration({ ...base, workspaceId: second });
  assert.deepEqual(replaced.map((i) => [i.workspaceId, i.taskIds]), [[first, [task]]]);
  assert.deepEqual((await integrations.currentIntegrations(projectId)).map((i) => i.workspaceId), [second]);
  const latest = await integrations.latestIntegrationForTask(task);
  assert.equal(latest.workspaceId, second);
  assert.deepEqual(latest.headShas, base.headShas);

  const planId = id();
  await plans.insertPlan(projectId, { id: planId, chiefSessionId: id(), status: "pending", createdAt: new Date().toISOString(), decidedAt: null, note: null, summary: "S", taskIds: {}, tasks: [{ key: "a", title: "A", brief: "a" }] });
  await plans.setPlanTask(planId, "a", task);
  const [one, two] = await Promise.all([plans.decidePlanRow(planId, "approved", null), plans.decidePlanRow(planId, "rejected", null)]);
  assert.equal(one.status, "approved");
  assert.equal(two, null);
  assert.deepEqual(one.taskIds, { a: task });
  assert.equal(await plans.getDelegationPlan("not-a-uuid"), null);
});

test("routing plans and routes move from the Home project's routing/state.json into Postgres", async (t) => {
  await withDb(t);
  await current.query("insert into projects (name, data_key, slug) values ('Home', '__home', '__home')");
  const routes = require("../lib/db/repo/routes.ts");
  const [planId, pendingId, projectId] = [id(), id(), id()];
  const file = path.join(configDir("__home"), "routing", "state.json");
  const item = { projectId, title: "Fix login", brief: "It fails", why: "#app", line: 2 };
  const route = { ref: "a1b2c3d4", planId, projectId, projectName: "App", workspaceId: null, title: "Fix login", brief: "It fails", noteId: "inbox", status: "done", summary: "Fixed", createdAt: "2026-11-20T09:10:00.000Z", updatedAt: "2026-11-21T09:00:00.000Z" };
  const fixture = {
    plans: {
      [planId]: { id: planId, summary: "Route the inbox", noteId: "inbox", items: [item], status: "approved", createdAt: "2026-11-20T09:00:00.000Z", decidedAt: "2026-11-20T09:10:00.000Z", note: null, refs: [route.ref] },
      [pendingId]: { id: pendingId, summary: "Later", items: [item], status: "pending", createdAt: "2026-11-20T10:00:00.000Z", decidedAt: null, note: null, refs: [] },
    },
    routes: { [route.ref]: route },
  };
  write(file, fixture);
  await importStateFiles();
  assert.deepEqual(instants(await routes.getRoutePlan(planId)), instants(fixture.plans[planId]));
  assert.deepEqual((await routes.listRoutePlans("pending")).map((p) => p.id), [pendingId]);
  assert.deepEqual(instants(await routes.listRoutes()), instants([route]));
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.existsSync(`${file}.imported`));

  assert.equal(await routes.settleRoute(route.ref, id(), "failed", "x"), null, "only the project it went to settles it");
  assert.equal((await routes.settleRoute(route.ref, projectId, "blocked", "Waiting")).status, "blocked");
  assert.equal((await routes.decideRoutePlanRow(pendingId, "rejected", "No")).note, "No");
  assert.equal(await routes.decideRoutePlanRow(pendingId, "approved", null), null);
  write(file, fixture);
  await importStateFiles();
  assert.equal((await routes.listRoutes())[0].status, "blocked", "importing again keeps newer rows");
});
