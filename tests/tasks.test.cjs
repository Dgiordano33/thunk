/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const sessions = new Map();
const sent = [];
let noteDirs;
let projectNoteDirs;
const agent = {
  getSession: (id) => sessions.get(id),
  resumeSession: async (id) => sessions.get(id),
  startSession: async ({ workspaceId }) => {
    const ws = await workspaces.getWorkspace(workspaceId);
    const live = { id: crypto.randomUUID(), meta: { workspaceId, projectId: ws.projectId } };
    sessions.set(live.id, live);
    return live;
  },
  pushUserMessage: (live, message) => sent.push({ id: live.id, message }),
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/agent") return agent;
  if (request === "../server") return { db: () => null }; // Never connect to configured local or remote databases.
  if (request === "@/lib/notes/resolve") return { dirsForScope: async (scope) => scope.kind === "projects" ? projectNoteDirs : noteDirs, repoDirsFor: async () => [] };
  return load.call(this, request, parent, isMain);
};
const repo = require("../lib/supabase/repo/tasks.ts");
const service = require("../lib/tasks/service.ts");
const schemas = require("../lib/tasks/schema.ts");
const events = require("../lib/tasks/events.ts");
const projects = require("../lib/supabase/repo/projects.ts");
const workspaces = require("../lib/supabase/repo/workspaces.ts");
const notes = require("../lib/notes/store.ts");
const collection = require("../app/api/tasks/route.ts");
const itemRoute = require("../app/api/tasks/[id]/route.ts");
const imports = require("../app/api/tasks/import-notes/route.ts");
const send = require("../app/api/tasks/[id]/send/route.ts");
const sse = require("../app/api/tasks/events/route.ts");
const req = (method, body, query = "") => new Request(`http://localhost/api/tasks${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
async function fixture() {
  const p = await projects.insertProject({ name: "Project", dataKey: crypto.randomUUID() });
  const w = await workspaces.insertWorkspace({ projectId: p.id, name: "Workspace", slug: "main", cwd: "/tmp", branch: null });
  return { p, w };
}

test("schemas reject malformed or immutable fields without patch defaults", () => {
  const projectId = crypto.randomUUID();
  for (const input of [{ title: " " }, { title: "x", priority: 4 }, { title: "x", dueAt: "tomorrow" }, { title: "x", noteId: "../secret" }, { title: "x", workspaceId: "bad" }])
    assert.equal(schemas.TaskInputSchema.safeParse({ projectId, ...input }).success, false);
  assert.equal(schemas.TaskPatchSchema.safeParse({ projectId }).success, false);
  assert.equal(schemas.TaskPatchSchema.safeParse({ position: Infinity }).success, false);
  assert.deepEqual(schemas.TaskPatchSchema.parse({ title: " Renamed " }), { title: "Renamed" });
});

test("CRUD, scope order, completion, rollups, counts and events", async () => {
  const { p, w } = await fixture();
  const received = [];
  const unsub = events.subscribeTasks((e) => received.push(e));
  try {
    const a = await service.createTask({ projectId: p.id, title: "Project task", priority: undefined });
    assert.equal(a.priority, 0);
    assert.equal((await service.patchTask(a.id, { status: undefined })).status, "open");
    const b = await service.createTask({ projectId: p.id, workspaceId: w.id, title: "Workspace task" });
    const c = await service.createTask({ projectId: p.id, workspaceId: w.id, title: "Next", status: "blocked" });
    assert.equal(a.position, 1); assert.equal(b.position, 1); assert.equal(c.position, 2);
    const tree = await service.taskTree(p.id);
    assert.deepEqual(tree.tasks.map((t) => t.id), [a.id]);
    assert.deepEqual(tree.workspaces[0].tasks.map((t) => t.id), [b.id, c.id]);
    assert.equal((await service.tasksForWorkspace(w.id)).project.length, 1);
    assert.deepEqual((await repo.countOpenTasks())[p.id], { project: 1, byWorkspace: { [w.id]: 2 } });
    const done = await service.patchTask(b.id, { status: "done" });
    assert.ok(done.completedAt);
    assert.equal((await service.patchTask(b.id, { title: "Renamed" })).completedAt, done.completedAt);
    assert.equal((await service.patchTask(b.id, { status: "open" })).completedAt, null);
    assert.ok((await service.patchTask(b.id, { status: "cancelled" })).completedAt);
    assert.equal((await repo.listTasks({ projectId: p.id, status: "open" })).length, 2);
    await service.patchTask(a.id, { workspaceId: w.id, after: b.id });
    assert.ok(received.some((e) => e.taskId === a.id && e.workspaceId === null && e.kind === "removed"));
    await repo.deleteTask(c.id);
    assert.equal(await repo.getTask(c.id), null);
    assert.equal(received.at(-1).kind, "removed");
  } finally { unsub(); }
});

test("create and patch validate project/workspace/session relationships", async () => {
  const { p, w } = await fixture();
  const other = await fixture();
  const sibling = await workspaces.insertWorkspace({ ...w, id: crypto.randomUUID(), slug: "sibling" });
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { id: sessionId, meta: { workspaceId: w.id, projectId: p.id } });
  await assert.rejects(service.createTask({ projectId: p.id, title: "x", workspaceId: other.w.id }), /Workspace/);
  await assert.rejects(service.createTask({ projectId: crypto.randomUUID(), title: "x" }), /Project/);
  await assert.rejects(service.createTask({ projectId: other.p.id, title: "x", sessionId }), /Session/);
  await assert.rejects(service.createTask({ projectId: p.id, workspaceId: sibling.id, title: "x" }, { createdInSessionId: sessionId }), /Session/);
  await assert.rejects(service.createTask({ projectId: p.id, title: "x", sessionId: crypto.randomUUID() }), /Session/);
  const task = await service.createTask({ projectId: p.id, workspaceId: w.id, sessionId, title: "x" }, { createdBy: "agent", createdInSessionId: sessionId });
  await assert.rejects(service.patchTask(task.id, { workspaceId: sibling.id }), /Session/);
  await assert.rejects(service.patchTask(task.id, { workspaceId: other.w.id }), /Workspace/);
  const foreign = await service.createTask({ projectId: other.p.id, title: "other" });
  await assert.rejects(service.patchTask(task.id, { after: foreign.id }), /same scope/);
  assert.equal((await service.patchTask(task.id, { workspaceId: sibling.id, sessionId: null })).workspaceId, sibling.id);
});

test("API envelopes, input failures, and send destinations", async () => {
  const { p, w } = await fixture();
  let response = await collection.POST(req("POST", { projectId: p.id, workspaceId: w.id, title: "Send me" }));
  assert.equal(response.status, 201);
  const { task } = await response.json();
  response = await collection.GET(req("GET", undefined, `?projectId=${p.id}&status=open`));
  assert.equal((await response.json()).tasks[0].id, task.id);
  assert.equal((await collection.GET(req("GET", undefined, "?status=bogus"))).status, 400);
  assert.equal((await itemRoute.PATCH(req("PATCH", { projectId: p.id }), ctx(task.id))).status, 400);
  const other = await fixture();
  assert.equal((await send.POST(req("POST", { workspaceId: other.w.id }), ctx(task.id))).status, 400);
  assert.equal(sent.length, 0);
  response = await send.POST(req("POST", {}), ctx(task.id));
  assert.equal(response.status, 200);
  const destination = await response.json();
  assert.equal(destination.workspaceId, w.id);
  assert.equal((await repo.getTask(task.id)).sessionId, destination.sessionId);
  assert.match(sent.at(-1).message, new RegExp(task.id));
  response = await send.POST(req("POST", { sessionId: destination.sessionId, workspaceId: other.w.id }), ctx(task.id));
  assert.equal(response.status, 400);
  assert.equal((await send.POST(req("POST", { sessionId: destination.sessionId }), ctx(task.id))).status, 200);
  assert.equal((await itemRoute.DELETE(req("DELETE"), ctx(task.id))).status, 200);
  assert.equal((await itemRoute.GET(req("GET"), ctx(task.id))).status, 404);
});

test("import preview and concurrent retries preserve notes and task edits", async (t) => {
  const { w } = await fixture();
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "thunk-tasks-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  noteDirs = { scope: { kind: "workspaces", id: w.id }, notesDir: path.join(base, "notes"), memoryFile: path.join(base, "MEMORY.md"), memoryTitle: "Memory" };
  projectNoteDirs = { ...noteDirs, scope: { kind: "projects", id: w.projectId }, notesDir: path.join(base, "project-notes"), memoryFile: path.join(base, "project-memory.md") };
  const note = await notes.createNote(noteDirs, { title: "Checklist", actionable: true, markdown: "- [ ] Same\n- [ ] Same\n- [x] Done\n" });
  await notes.createNote(noteDirs, { markdown: "- [ ] Not actionable" });
  const before = await fs.readFile(note.path, "utf8");
  assert.deepEqual(await (await imports.GET(req("GET", undefined, `?workspaceId=${w.id}`))).json(), { count: 2, folders: [] });
  const results = await Promise.all([imports.POST(req("POST", { workspaceId: w.id })), imports.POST(req("POST", { workspaceId: w.id }))]);
  const counts = await Promise.all(results.map((r) => r.json()));
  assert.equal(counts.reduce((sum, r) => sum + r.imported, 0), 2);
  const imported = await repo.listTasks({ workspaceId: w.id });
  assert.equal(imported.length, 2);
  assert.equal(imported[0].noteId, note.id);
  await service.patchTask(imported[0].id, { title: "Edited", status: "done" });
  assert.deepEqual(await (await imports.POST(req("POST", { workspaceId: w.id }))).json(), { imported: 0 });
  assert.deepEqual(await (await imports.GET(req("GET", undefined, `?workspaceId=${w.id}`))).json(), { count: 0, folders: [] });
  assert.equal(await fs.readFile(note.path, "utf8"), before);
  const projectNote = await notes.createNote(projectNoteDirs, { title: "Project checklist", actionable: true, markdown: "- [ ] Shared follow-up\n" });
  assert.deepEqual(await (await imports.GET(req("GET", undefined, `?projectId=${w.projectId}`))).json(), { count: 1, folders: [] });
  assert.deepEqual(await (await imports.POST(req("POST", { projectId: w.projectId }))).json(), { imported: 1 });
  const projectTasks = await repo.listTasks({ projectId: w.projectId, workspaceId: null });
  assert.equal(projectTasks.length, 1);
  assert.equal(projectTasks[0].noteId, projectNote.id);
  assert.equal(await service.importNoteTasks({ workspaceId: w.id }), 0);
  const sibling = await workspaces.insertWorkspace({ ...w, id: crypto.randomUUID(), slug: "sibling" });
  noteDirs = { ...noteDirs, notesDir: path.join(base, "sibling-notes"), memoryFile: path.join(base, "sibling-memory.md") };
  assert.equal(await service.importNoteTasks({ workspaceId: sibling.id }), 0);
});

test("concurrent creates in a scope get distinct positions, and a failed insert does not block the next", async () => {
  const { p, w } = await fixture();
  const created = await Promise.all(Array.from({ length: 5 }, (_, i) => repo.insertTask({ projectId: p.id, workspaceId: w.id, title: `Task ${i}` })));
  assert.deepEqual(created.map((t) => t.position).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  const id = crypto.randomUUID();
  await repo.insertTask({ id, projectId: p.id, title: "First" });
  await assert.rejects(repo.insertTask({ id, projectId: p.id, title: "Duplicate" }), /already exists/);
  assert.equal((await repo.insertTask({ projectId: p.id, title: "Second" })).position, 2);
});

test("SSE delivers changes and cleans up on abort and cancellation", async () => {
  const abort = new AbortController();
  const response = await sse.GET(new Request("http://localhost/api/tasks/events", { signal: abort.signal }));
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /:ok/);
  const event = { projectId: crypto.randomUUID(), workspaceId: null, taskId: crypto.randomUUID(), kind: "changed" };
  events.emitTask(event);
  assert.match(new TextDecoder().decode((await reader.read()).value), new RegExp(event.taskId));
  abort.abort();
  assert.equal((await reader.read()).done, true);
  const second = await sse.GET(new Request("http://localhost/api/tasks/events"));
  await second.body.cancel();
  events.emitTask(event);
  const already = new AbortController(); already.abort();
  const third = await sse.GET(new Request("http://localhost/api/tasks/events", { signal: already.signal }));
  const thirdReader = third.body.getReader(); await thirdReader.read();
  assert.equal((await thirdReader.read()).done, true);
});


test("memory-only deletions mirror task foreign-key cleanup", async () => {
  const { p, w } = await fixture();
  const sessionId = crypto.randomUUID();
  const owned = await repo.insertTask({ projectId: p.id, workspaceId: w.id, title: "Owned", sessionId, createdInSessionId: sessionId });
  await require("../lib/supabase/repo/sessions.ts").deleteSessionRow(sessionId);
  assert.equal((await repo.getTask(owned.id)).sessionId, null);
  assert.equal((await repo.getTask(owned.id)).createdInSessionId, null);
  const shared = await service.createTask({ projectId: p.id, title: "Shared" });
  await workspaces.deleteWorkspace(w.id);
  assert.equal(await repo.getTask(owned.id), null);
  assert.ok(await repo.getTask(shared.id));
  await projects.deleteProject(p.id);
  assert.equal(await repo.getTask(shared.id), null);
  assert.equal((await repo.countOpenTasks())[p.id], undefined);
});
