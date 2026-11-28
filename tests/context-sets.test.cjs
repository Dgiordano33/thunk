/* eslint-disable @typescript-eslint/no-require-imports -- Compile server modules with the installed TypeScript compiler. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};

let current = null;
const tasks = {};
const mocks = {
  "../server": { db: () => current, hasDatabase: () => Boolean(current) },
  "@/lib/db/server": { db: () => current, hasDatabase: () => Boolean(current) },
  "@/lib/db/repo/tasks": { getTask: async (id) => tasks[id] ?? null },
  "@/lib/projects": { getWorkspaceContext: async () => null },
  "@/lib/agent": { getSession: () => null },
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "server-only") return {};
  if (mocks[request]) return mocks[request];
  return load.call(this, request, parent, ...rest);
};

const { testDb } = require("./helpers/test-db.cjs");
const projects = require("../lib/db/repo/projects.ts");
const routines = require("../lib/db/repo/routines.ts");
const sets = require("../lib/context/sets.ts");
const { renderRoutineContext, validateRoutineContext } = require("../lib/routines/context.ts");
const { RoutineContextSchema } = require("../lib/routines/schema.ts");

const json = (method, body) => new Request("http://x", { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const task = (id, projectId, title) => ({ id, projectId, workspaceId: null, title, body: `About ${title}`, status: "open", priority: 1, noteId: null });

let project, other;
before(async () => {
  current = await testDb();
  project = await projects.insertProject({ name: "Sets", dataKey: crypto.randomUUID(), slug: crypto.randomUUID() });
  other = await projects.insertProject({ name: "Other", dataKey: crypto.randomUUID(), slug: crypto.randomUUID() });
});
after(() => current?.close());

test("context sets: create, list, rename, reject other projects' items and duplicate names, delete", async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID(), foreign = crypto.randomUUID();
  tasks[a] = task(a, project.id, "Billing");
  tasks[b] = task(b, project.id, "Search");
  tasks[foreign] = task(foreign, other.id, "Theirs");

  let res = await sets.collection.POST(json("POST", { name: "Billing work", notes: [], taskIds: [a] }), ctx(project.id));
  assert.equal(res.status, 201);
  const { set } = await res.json();
  assert.deepEqual([set.name, set.taskIds, set.vaultIds], ["Billing work", [a], []]);

  assert.equal((await sets.collection.POST(json("POST", { name: "Billing work", notes: [], taskIds: [] }), ctx(project.id))).status, 409);
  assert.equal((await sets.collection.POST(json("POST", { name: "Sneaky", notes: [], taskIds: [foreign] }), ctx(project.id))).status, 400);
  assert.equal((await sets.collection.POST(json("POST", { name: " ", notes: [], taskIds: [] }), ctx(project.id))).status, 400);
  assert.equal((await sets.collection.GET(json("GET"), ctx(crypto.randomUUID()))).status, 404);

  res = await sets.item.PATCH(json("PATCH", { name: "Billing", taskIds: [a, b] }), ctx(set.id));
  assert.deepEqual((await res.json()).set.taskIds, [a, b]);
  const listed = (await (await sets.collection.GET(json("GET"), ctx(project.id))).json()).sets;
  assert.deepEqual(listed.map((s) => s.name), ["Billing"]);
  assert.deepEqual((await (await sets.collection.GET(json("GET"), ctx(other.id))).json()).sets, []);

  assert.equal((await sets.item.DELETE(json("DELETE"), ctx(set.id))).status, 200);
  assert.equal((await sets.item.GET(json("GET"), ctx(set.id))).status, 404);
});

test("a routine can point at a set instead of its own list; deleting the set sends it back to its own", async () => {
  const mine = crypto.randomUUID(), shared = crypto.randomUUID();
  tasks[mine] = task(mine, project.id, "Own item");
  tasks[shared] = task(shared, project.id, "Shared item");
  const { set } = await (await sets.collection.POST(json("POST", { name: "Shared", notes: [], taskIds: [shared] }), ctx(project.id))).json();

  assert.ok(RoutineContextSchema.safeParse({ notes: [], taskIds: [mine], setId: set.id }).success);
  assert.ok(!RoutineContextSchema.safeParse({ notes: [], taskIds: [], setId: "nope" }).success);
  await validateRoutineContext(project, { notes: [], taskIds: [mine], setId: set.id });
  const { set: theirs } = await (await sets.collection.POST(json("POST", { name: "Theirs", notes: [], taskIds: [] }), ctx(other.id))).json();
  await assert.rejects(validateRoutineContext(project, { notes: [], taskIds: [], setId: theirs.id }), /isn't in this project/);

  const routine = await routines.insertRoutine({ projectId: project.id, name: "Nightly", prompt: "go", model: "m", permissionMode: "default", targetKind: "ephemeral", targetWorkspaceId: null, scheduleCron: null, scheduleTz: null, events: [], context: { notes: [], taskIds: [mine], setId: set.id }, webhookToken: null, enabled: true, catchUp: "skip", maxRunsPerDay: 5, maxRunMinutes: 30, nextRunAt: null });
  assert.equal((await routines.getRoutine(routine.id)).context.setId, set.id, "setId survives the jsonb round trip");

  let part = await renderRoutineContext({ project, context: (await routines.getRoutine(routine.id)).context, trigger: "manual" });
  assert.match(part.text, /context set “Shared”/);
  assert.match(part.text, /Shared item/);
  assert.doesNotMatch(part.text, /Own item/);
  assert.deepEqual(part.items.map((i) => [i.kind, i.refId]), [["task", shared]]);

  // An edit to the set reaches the routine's next run.
  await sets.item.PATCH(json("PATCH", { taskIds: [shared, mine] }), ctx(set.id));
  part = await renderRoutineContext({ project, context: (await routines.getRoutine(routine.id)).context, trigger: "manual" });
  assert.match(part.text, /Own item/);

  await sets.item.DELETE(json("DELETE"), ctx(set.id));
  const after = await routines.getRoutine(routine.id);
  assert.equal(after.context.setId, undefined);
  part = await renderRoutineContext({ project, context: after.context, trigger: "manual" });
  assert.match(part.text, /Own item/);
  assert.doesNotMatch(part.text, /Shared item/);

  // A routine whose set vanished says so in its brief.
  part = await renderRoutineContext({ project, context: { notes: [], taskIds: [], setId: crypto.randomUUID() }, trigger: "manual" });
  assert.match(part.text, /No longer available: the routine's context set/);
});
