/* eslint-disable @typescript-eslint/no-require-imports -- Server TypeScript compiler harness. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-chief-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const id = () => crypto.randomUUID();
const project = { id: id(), dataKey: "test", name: "Test", repos: [{ id: id(), kind: "repo" }], repoFolders: [] };
const main = { id: id(), projectId: project.id, slug: "main", branch: null, cwd: tmp, repos: [] };
const workspaces = new Map([[main.id, main]]);
const sessions = new Map();
const persisted = new Map();
const tasks = new Map();
const notes = new Map();
const notifications = [];
let setupFailure = false;
let workspaceInputs = [];
const emit = (live, event) => {
  event = { ...event, sessionId: live.id, seq: ++live.seq, ts: Date.now() };
  live.events.push(event);
  if (event.type === "status") live.meta.status = event.state;
  for (const subscriber of live.subscribers) subscriber(event);
};
const agent = {
  getSession: (id) => sessions.get(id),
  listLiveSessions: () => [...sessions.values()],
  listSessions: async (opts = {}) => [...[...persisted.values()].map((s) => ({ ...s.meta, live: false })), ...[...sessions.values()].map((s) => ({ ...s.meta, live: true }))].filter((s) => !opts.workspaceId || s.workspaceId === opts.workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  subscribe: (live, fn) => { live.subscribers.add(fn); return () => live.subscribers.delete(fn); },
  onSessionCreated: () => {},
  startSession: async (input) => {
    const workspace = workspaces.get(input.workspaceId);
    const sessionId = id();
    const live = { id: sessionId, meta: { ...input, id: sessionId, projectId: project.id, workspaceId: workspace.id, status: "idle", createdAt: new Date().toISOString() }, ctx: { project, workspace }, events: [], seq: 0, pending: new Map(), queuedMessages: [], subscribers: new Set(), driver: { isClosed: false, interrupt: async () => {} } };
    sessions.set(sessionId, live); return live;
  },
  resumeSession: async (id) => { const live = sessions.get(id); if (live) { live.driver.isClosed = false; if (live.meta.status === "closed") live.meta.status = "idle"; } return live; },
  closeSession: (id) => { const live = sessions.get(id); if (live) { live.driver.isClosed = true; emit(live, { type: "status", state: "closed" }); } },
  pushUserMessage: (live, content) => { const queued = ["running", "awaiting"].includes(live.meta.status); emit(live, { type: "user_message", content, queued }); if (queued) live.queuedMessages.push({ content }); else emit(live, { type: "status", state: "running" }); },
};
const mocks = {
  "server-only": {},
  "@/lib/agent": agent,
  "@/lib/projects": {
    ensureMainWorkspace: async () => main,
    createWorkspace: async (input) => { workspaceInputs.push(input); if (setupFailure) throw new Error("setup failed"); const workspace = { ...main, id: id(), slug: input.name, branch: `thunk/${input.name}` }; workspaces.set(workspace.id, workspace); return workspace; },
    getWorkspaceContext: async (id) => workspaces.has(id) ? { project, workspace: workspaces.get(id) } : null,
  },
  "@/lib/projects/paths": { projectConfigDir: () => tmp, workspaceMemoryFile: () => path.join(tmp, "MEMORY.md") },
  "@/lib/projects/repos": { sessionConfigRoot: () => tmp },
  "@/lib/prompts/context": { expandCommand: async (s) => s },
  "@/lib/supabase/repo/projects": { getProject: async (id) => id === project.id ? project : null },
  "@/lib/supabase/repo/workspaces": { listWorkspaces: async () => [...workspaces.values()] },
  "@/lib/supabase/repo/tasks": { getTask: async (id) => tasks.get(id), listTasks: async () => [...tasks.values()] },
  "@/lib/tasks/service": {
    createTask: async (input) => { const task = { id: id(), status: "open", ...input }; tasks.set(task.id, task); return task; },
    patchTask: async (id, patch) => { const task = tasks.get(id); Object.assign(task, patch); return task; },
  },
  "@/lib/supabase/repo/sessions": { upsertSession: async () => {} },
  "@/lib/supabase/repo/messages": { insertEvents: async () => {}, loadEvents: async (id) => sessions.get(id)?.events ?? persisted.get(id)?.events ?? [] },
  "@/lib/notifications/service": { notify: async (n) => notifications.push(n) },
  "@/lib/notes/resolve": { projectNoteDirs: () => ({ notesDir: tmp }), repoDirsFor: async () => [], workspaceNoteDirs: (_p, w) => ({ notesDir: w.id }) },
  "@/lib/notes/store": {
    readNote: async (dirs, id) => notes.get(`${dirs.notesDir}/${id}`) ?? null,
    createNote: async (dirs, input) => { const note = { ...input, path: `${dirs.notesDir}/${input.id}`, updatedAt: id() }; notes.set(note.path, note); return note; },
    writeNote: async (dirs, id, patch) => { const note = notes.get(`${dirs.notesDir}/${id}`); assert.equal(patch.expectedUpdatedAt, note.updatedAt); Object.assign(note, patch, { updatedAt: crypto.randomUUID() }); return note; },
  },
  "@/lib/notes/prompt": { INJECT_LIMIT: 24_000 },
  "@/lib/workers/report": { collectReport: async ({ markdown }) => ({ summary: markdown, outcome: markdown.includes("outcome: blocked") ? "blocked" : "done", diffStat: { files: 1, additions: 2, deletions: 0 }, prUrl: null }) },
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
const service = load("@/lib/workers/service");
const reports = load("@/lib/workers/report-up");
const logs = load("@/lib/workers/log");
const prompt = load("@/lib/workers/prompt");
const tick = () => new Promise((r) => setTimeout(r, 10));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await tick(); } assert.fail("Timed out waiting for worker completion"); }
function finish(live, markdown = "done") { emit(live, { type: "turn_complete", markdown }); emit(live, { type: "result", isError: false, costUsd: 0 }); emit(live, { type: "status", state: "idle" }); }

test("chief delegates in isolated worktrees, caps concurrency, batches reports and resumes work", async () => {
  const chief = await service.openChief(project.id);
  assert.equal(chief.meta.origin.kind, "chief");
  assert.equal(chief.meta.permissionMode, "default");
  assert.equal((await service.openChief(project.id)).id, chief.id);
  const workers = await Promise.all(Array.from({ length: 4 }, (_, i) => service.delegate(project.id, chief.id, { title: `Task ${i}`, brief: `Brief ${i}` })));
  assert.equal(workspaceInputs.length, 4);
  for (const input of workspaceInputs) assert.equal(input.setup, "await");
  const first = sessions.get(workers[0].sessionId);
  assert.deepEqual(first.meta.origin, { kind: "worker", chiefSessionId: chief.id, taskId: workers[0].taskId });
  assert.equal(tasks.get(workers[0].taskId).sessionId, first.id);
  assert.match(first.events.find((e) => e.type === "user_message").content, /Brief 0/);
  await assert.rejects(service.delegate(project.id, chief.id, { title: "Fifth" }), /wait for a report/);
  finish(first, "First complete");
  finish(sessions.get(workers[1].sessionId), "Second complete");
  await until(async () => await reports.savedReport(project, workers[1].sessionId));
  assert.equal(chief.events.filter((e) => e.type === "user_message").length, 0);
  await reports.flushReports(chief.id);
  const delivered = chief.events.filter((e) => e.type === "user_message");
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].content, /First complete/);
  assert.match(delivered[0].content, /Second complete/);
  assert.equal(tasks.get(workers[0].taskId).status, "in_progress", "chief accepts completed work");
  await service.messageWorker(project.id, workers[2].taskId, "Queued follow-up");
  assert.equal(sessions.get(workers[2].sessionId).queuedMessages.length, 1);
  await service.stopWorker(project.id, workers[2].taskId, "No longer needed");
  assert.equal(tasks.get(workers[2].taskId).status, "cancelled");
  await service.stopWorker(project.id, workers[3].taskId, "Cleanup");
  await until(async () => await reports.savedReport(project, workers[3].sessionId));
  await reports.flushReports(chief.id);
  await service.messageWorker(project.id, workers[0].taskId, "Please fix the test");
  finish(first, "Fixed test");
  await until(async () => (await reports.savedReport(project, first.id))?.content.includes("Fixed test"));
  await reports.flushReports(chief.id);
  const before = notifications.length;
  await service.recoverWorkers();
  assert.equal(notifications.length, before, "recovery does not re-report settled sessions");
});

test("note brief round trip, direct worker completion and setup failure", async () => {
  notes.set(`${tmp}/brief`, { title: "Plan", id: "brief", path: `${tmp}/brief`, markdown: "- [ ] First\n- [ ] Second\n" + "x".repeat(25_000) });
  const worker = await service.delegate(project.id, null, { noteId: "brief" });
  assert.equal(tasks.get(worker.taskId).noteId, "brief");
  const live = sessions.get(worker.sessionId);
  const input = live.events.find((e) => e.type === "user_message").content;
  assert.match(input, /First\n- \[ \] Second/);
  assert.match(input, /Truncated; read the note path/);
  assert.ok(input.length < 25_000);
  finish(live);
  await until(async () => await reports.savedReport(project, live.id));
  assert.equal(tasks.get(worker.taskId).status, "done");
  const chief = await service.openChief(project.id);
  chief.meta.status = "running";
  const existing = { id: id(), projectId: project.id, title: "Chief-owned task", workspaceId: main.id, sessionId: chief.id, status: "open" };
  tasks.set(existing.id, existing);
  const assigned = await service.delegate(project.id, chief.id, { taskId: existing.id });
  assert.equal(assigned.taskId, existing.id);
  finish(sessions.get(assigned.sessionId));
  await until(async () => await reports.savedReport(project, assigned.sessionId));
  await reports.flushReports(chief.id);
  setupFailure = true;
  await assert.rejects(service.delegate(project.id, null, { title: "Broken setup" }), /setup failed/);
  setupFailure = false;
  assert.equal([...tasks.values()].find((t) => t.title === "Broken setup").status, "blocked");
  await assert.rejects(service.delegate(project.id, null, { taskId: id() }), /Task not found/);
  await assert.rejects(service.delegate(project.id, null, { repoIds: [id()] }), /Repository does not belong/);
});

test("work log serializes concurrent appends, memory uses explicit replacement", async () => {
  await Promise.all([logs.appendWorkLog(project, "one"), logs.appendWorkLog(project, "two")]);
  const log = [...notes.values()].find((n) => n.title.startsWith("Work log"));
  assert.match(log.markdown, /one[\s\S]*two/);
  await logs.saveChiefPlan(project, "Plan for next chief");
  assert.equal(fs.readFileSync(path.join(tmp, "MEMORY.md"), "utf8"), "Plan for next chief");
});

test("chief tools are exclusive and writes are denied", () => {
  assert.deepEqual(prompt.CHIEF_DISALLOWED_TOOLS, ["Edit", "Write", "NotebookEdit"]);
  for (const command of ["echo x > file", "tee file", "git commit -am x", "git push", "rm -rf folder"]) assert.equal(prompt.chiefWriteCommand("Bash", { command }), true);
  assert.equal(prompt.chiefWriteCommand("Bash", { command: "git diff --stat" }), false);
  assert.equal(prompt.chiefWriteCommand("Edit", {}), true);
  const { chiefTools } = load("@/lib/workers/tools");
  assert.deepEqual(chiefTools({ meta: { origin: { kind: "worker" } } }), []);
  assert.match(prompt.teamPrompt({ kind: "chief" }), /split unchecked checklist/i);
});

 test("watcher waits for pending prompts and queued work, times out once", async () => {
  const { watchWorker } = load("@/lib/workers/watch");
  const live = await agent.startSession({ workspaceId: main.id });
  let completions = [];
  const stop = watchWorker(live, 1, { waitForQueue: true, finish: (result) => completions.push(result) });
  live.pending.set("question", {});
  emit(live, { type: "result", isError: false });
  assert.equal(completions.length, 0);
  live.pending.clear(); live.queuedMessages.push({ content: "next" });
  emit(live, { type: "result", isError: false });
  assert.equal(completions.length, 0);
  live.queuedMessages = [];
  emit(live, { type: "result", isError: false });
  assert.equal(completions.length, 1); stop();
  completions = [];
  watchWorker(live, 0.0001, { finish: (result) => completions.push(result) });
  await until(() => completions.length);
  assert.equal(completions[0].status, "failed");
  emit(live, { type: "status", state: "closed" });
  assert.equal(completions.length, 1);
});

test("restart recovers detached results, reports interrupted work, and preserves pending batches", async () => {
  const chief = await service.openChief(project.id);
  const detached = await agent.startSession({ workspaceId: main.id, origin: { kind: "worker", chiefSessionId: chief.id, taskId: id() } });
  const task = { id: detached.meta.origin.taskId, projectId: project.id, sessionId: detached.id, status: "in_progress", title: "Detached result" };
  tasks.set(task.id, task);
  finish(detached, "Finished while detached");
  persisted.set(detached.id, detached); sessions.delete(detached.id);
  await service.recoverWorkers();
  assert.match((await reports.savedReport(project, detached.id)).content, /Finished while detached/);
  await reports.flushReports(chief.id);
  assert.match(chief.events.at(-1).content, /Finished while detached/);
  const count = notifications.length;
  await service.recoverWorkers();
  assert.equal(notifications.length, count);

  const interrupted = await agent.startSession({ workspaceId: main.id, origin: { kind: "worker", chiefSessionId: chief.id, taskId: id() } });
  tasks.set(interrupted.meta.origin.taskId, { id: interrupted.meta.origin.taskId, projectId: project.id, sessionId: interrupted.id, status: "in_progress", title: "Interrupted" });
  agent.pushUserMessage(interrupted, "Work in progress");
  agent.pushUserMessage(interrupted, "Queued follow-up still needs doing");
  finish(interrupted, "Only the first turn finished");
  persisted.set(interrupted.id, interrupted); sessions.delete(interrupted.id);
  await service.recoverWorkers();
  assert.equal(tasks.get(interrupted.meta.origin.taskId).status, "blocked");
  assert.match((await reports.savedReport(project, interrupted.id)).content, /interrupted by server restart/);
  await reports.flushReports(chief.id);

  await reports.queueReport(project, detached.meta, 100, "<worker_report>First undelivered</worker_report>");
  await reports.queueReport(project, detached.meta, 200, "<worker_report>Second undelivered</worker_report>");
  assert.equal((await reports.savedReports(project, detached.id)).filter((r) => !r.delivered).length, 2);
  await reports.flushReports(chief.id);
  assert.match(chief.events.at(-1).content, /First undelivered[\s\S]*Second undelivered/);
});
