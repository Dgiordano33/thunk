/* eslint-disable @typescript-eslint/no-require-imports -- Compile server modules with the installed TypeScript compiler. */
const { test, beforeEach } = require("node:test");
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

const project = { id: "p1", slug: "p", repoFolders: [{ id: "rf1" }] };
const otherWs = "ws-other";
let notes, tasks, fired, routines, harvested;
const mocks = {
  "@/lib/notes/resolve": {
    dirsForScope: async (scope) => ({ scope }),
    projectNoteDirs: () => ({ scope: { kind: "projects", id: project.id } }),
    workspaceNoteDirs: (_p, ws) => ({ scope: { kind: "workspaces", id: ws.id } }),
  },
  "@/lib/notes/store": {
    readNote: async (dirs, id) => notes[`${dirs.scope.kind}:${dirs.scope.id}:${id}`] ?? null,
    listNotes: async (dirs) => Object.entries(notes).filter(([k]) => k.startsWith(`${dirs.scope.kind}:${dirs.scope.id}:`)).map(([k, n]) => ({ ...n, id: k.split(":")[2] })),
  },
  "@/lib/supabase/repo/tasks": {
    getTask: async (id) => tasks[id] ?? null,
    listTasks: async ({ projectId, workspaceId }) => Object.values(tasks).filter((t) => t.projectId === projectId && (workspaceId === undefined || t.workspaceId === workspaceId)),
    updateTask: async (id, patch) => Object.assign(tasks[id], patch),
  },
  "@/lib/projects/harvest": { harvestWorkspace: async (_ctx, input) => { harvested.push(input); return { memory: null, notes: input.noteIds.map((id) => ({ from: id, to: `${id}-p` })) }; } },
  "@/lib/supabase/repo/workspaces": { getWorkspace: async (id) => (id === otherWs ? { id, projectId: "p2" } : { id, projectId: project.id, name: "ws", branch: "b" }) },
  "@/lib/supabase/repo/routines": { listEnabledRoutines: async ({ event }) => routines.filter((r) => r.events.includes(event)) },
  "./runner": { fire: async (routine, trigger, payload) => { fired.push({ routine: routine.id, trigger, payload }); } },
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "server-only") return {};
  if (mocks[request]) return mocks[request];
  return load.call(this, request, parent, ...rest);
};
const { renderRoutineContext, validateRoutineContext } = require("../lib/routines/context.ts");
const { onTaskEvent } = require("../lib/routines/triggers.ts");
const { routinesState } = require("../lib/routines/state.ts");
const { keepRunOutputs, runTasks } = require("../lib/routines/outputs.ts");

const note = (title, markdown) => ({ title, markdown, path: `/notes/${title}.md`, updatedAt: "2026-11-10T00:00:00Z" });
const task = (id, extra = {}) => ({ id, projectId: project.id, workspaceId: null, title: `Task ${id}`, body: "Do the thing", status: "open", priority: 1, createdBy: "user", sessionId: null, createdInSessionId: null, noteId: null, ...extra });
beforeEach(() => {
  notes = { "projects:p1:spec": note("Spec", "The plan."), "repos:rf1:adr": note("ADR", "Decision."), "projects:p1:linked": note("Linked", "x") };
  tasks = { "t-1": task("t-1", { noteId: "linked" }), "t-2": task("t-2", { status: "done" }), "t-x": task("t-x", { projectId: "p2" }) };
  fired = []; routines = []; harvested = []; routinesState.active.clear();
});

test("attached notes and tasks render with their current content; missing ones are named", async () => {
  const context = { notes: [{ scope: { kind: "projects", id: "p1" }, id: "spec" }, { scope: { kind: "repos", id: "rf1" }, id: "adr" }, { scope: { kind: "projects", id: "p1" }, id: "gone" }], taskIds: ["t-1", "t-x"] };
  const text = await renderRoutineContext({ project, context, trigger: "manual", payload: null });
  assert.match(text, /# Context for this run/);
  assert.match(text, /## Note: Spec[\s\S]*The plan\./);
  assert.match(text, /## Note: ADR[\s\S]*repo notebook/);
  assert.match(text, /## Task: Task t-1[\s\S]*Linked note:\*\* Linked/);
  assert.doesNotMatch(text, /Task t-x/);
  assert.match(text, /No longer available: note `gone`, task `t-x`/);
  notes["projects:p1:spec"].markdown = "Edited between runs.";
  assert.match(await renderRoutineContext({ project, context, trigger: "cron" }), /Edited between runs\./);
});

test("notes from another project's workspace never render, and nothing attached renders nothing", async () => {
  notes[`workspaces:${otherWs}:spy`] = note("Spy", "secret");
  const text = await renderRoutineContext({ project, context: { notes: [{ scope: { kind: "workspaces", id: otherWs }, id: "spy" }], taskIds: [] }, trigger: "manual" });
  assert.doesNotMatch(text, /secret/);
  assert.equal(await renderRoutineContext({ project, context: { notes: [], taskIds: [] }, trigger: "manual" }), "");
  await assert.rejects(validateRoutineContext(project, { notes: [{ scope: { kind: "projects", id: "p2" }, id: "spec" }], taskIds: [] }), /another project/);
  await assert.rejects(validateRoutineContext(project, { notes: [], taskIds: ["t-x"] }), /isn't in this project/);
  await validateRoutineContext(project, { notes: [{ scope: { kind: "projects", id: "p1" }, id: "spec" }], taskIds: ["t-1"] });
});

test("the task that fired a task event leads the context", async () => {
  const text = await renderRoutineContext({ project, context: { notes: [], taskIds: ["t-2"] }, trigger: "task_created", payload: { task: { id: "t-1" } } });
  assert.ok(text.indexOf("Task that was just created: Task t-1") < text.indexOf("## Task: Task t-2"));
});

test("task events fire listening routines, but never for work done by routine sessions", async () => {
  routines = [{ id: "r1", events: ["task_created"] }, { id: "r2", events: ["task_completed"] }];
  await onTaskEvent({ projectId: project.id, workspaceId: null, taskId: "t-1", kind: "changed", transition: "created" });
  assert.deepEqual(fired.map((f) => [f.routine, f.trigger, f.payload.task.id]), [["r1", "task_created", "t-1"]]);
  await onTaskEvent({ projectId: project.id, workspaceId: null, taskId: "t-2", kind: "changed", transition: "completed" });
  assert.deepEqual(fired.at(-1).routine, "r2");
  await onTaskEvent({ projectId: project.id, workspaceId: null, taskId: "t-1", kind: "changed" });
  assert.equal(fired.length, 2);

  tasks["t-3"] = task("t-3", { createdBy: "routine" });
  await onTaskEvent({ projectId: project.id, workspaceId: null, taskId: "t-3", kind: "changed", transition: "created" });
  routinesState.active.set("r9", { runId: "run", routineId: "r9", sessionId: "s-routine", cancel: () => {} });
  tasks["t-4"] = task("t-4", { status: "done", sessionId: "s-routine" });
  await onTaskEvent({ projectId: project.id, workspaceId: null, taskId: "t-4", kind: "changed", transition: "completed" });
  assert.equal(fired.length, 2);
});

test("a per-run worktree's notes and tasks move up to the project before it goes", async () => {
  notes["workspaces:ws-run:found"] = note("Found", "Bug list");
  tasks["t-5"] = task("t-5", { workspaceId: "ws-run", createdInSessionId: "s-run" });
  tasks["t-6"] = task("t-6", { sessionId: "s-run", status: "done" });
  const { created, updated } = await runTasks(project.id, "s-run");
  assert.deepEqual([created.map((t) => t.id), updated.map((t) => t.id)], [["t-5"], ["t-6"]]);
  const kept = await keepRunOutputs(project, { id: "ws-run" });
  assert.deepEqual(harvested, [{ memory: null, noteIds: ["found"] }]);
  assert.deepEqual(kept.notes, [{ id: "found-p", title: "Found" }]);
  assert.equal(tasks["t-5"].workspaceId, null);
});
