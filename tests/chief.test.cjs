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
const archivedWorkspaces = [];
const resolved = [];
let nextWorkspace = null;
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
  emit,
  resolvePending: (live, requestId, result) => { const req = live.pending.get(requestId); if (!req) return null; live.pending.delete(requestId); req.resolve(result); return req; },
  refreshWaitingOn: (live) => { if (live.meta.status === "awaiting") emit(live, { type: "status", state: "awaiting", waitingOn: [...live.pending.values()].every((p) => p.routedTo === "chief") ? "chief" : null }); },
  pushUserMessage: (live, content) => { const queued = ["running", "awaiting"].includes(live.meta.status); emit(live, { type: "user_message", content, queued }); if (queued) live.queuedMessages.push({ content }); else emit(live, { type: "status", state: "running" }); },
};
const mocks = {
  "server-only": {},
  "@/lib/agent": agent,
  "@/lib/projects": {
    ensureMainWorkspace: async () => main,
    createWorkspace: async (input) => { workspaceInputs.push(input); if (setupFailure) throw new Error("setup failed"); const workspace = nextWorkspace?.(input) ?? { ...main, id: id(), slug: input.name, branch: `thunk/${input.name}` }; nextWorkspace = null; workspaces.set(workspace.id, workspace); return workspace; },
    getWorkspaceContext: async (id) => workspaces.has(id) ? { project, workspace: workspaces.get(id) } : null,
  },
  "@/lib/projects/paths": { projectConfigDir: () => tmp, workspaceMemoryFile: () => path.join(tmp, "MEMORY.md") },
  "@/lib/projects/repos": { sessionConfigRoot: () => tmp },
  "@/lib/prompts/context": { expandCommand: async (s) => s },
  "@/lib/supabase/repo/projects": { getProject: async (id) => id === project.id ? project : null, listProjects: async () => [project] },
  "@/lib/projects/archive": { archiveWorkspace: async (id) => { archivedWorkspaces.push(id); } },
  "@/lib/supabase/repo/workspaces": { getWorkspace: async (id) => workspaces.get(id) ?? null, listWorkspaces: async () => [...workspaces.values()] },
  "@/lib/supabase/repo/tasks": { getTask: async (id) => tasks.get(id), listTasks: async () => [...tasks.values()] },
  "@/lib/tasks/service": {
    createTask: async (input) => { const task = { id: id(), status: "open", ...input }; tasks.set(task.id, task); return task; },
    patchTask: async (id, patch) => { const task = tasks.get(id); Object.assign(task, patch); return task; },
  },
  "@/lib/supabase/repo/sessions": { upsertSession: async () => {}, getSessionRow: async (id) => persisted.get(id)?.meta ?? null },
  "@/lib/supabase/repo/messages": { insertEvents: async () => {}, loadEvents: async (id) => sessions.get(id)?.events ?? persisted.get(id)?.events ?? [] },
  "@/lib/notifications/service": { notify: async (n) => notifications.push(n), resolveBySubject: async (subject) => { resolved.push(subject); return []; } },
  "@/lib/projects/runtime": { processEnvironment: () => ({}) },
  "@/lib/notes/resolve": { projectNoteDirs: () => ({ notesDir: tmp }), repoDirsFor: async () => [], workspaceNoteDirs: (_p, w) => ({ notesDir: w.id }) },
  "@/lib/notes/store": {
    readNote: async (dirs, id) => notes.get(`${dirs.notesDir}/${id}`) ?? null,
    createNote: async (dirs, input, { keepId = false } = {}) => { const note = { ...input, id: keepId ? input.id : id(), updatedAt: id() }; note.path = `${dirs.notesDir}/${note.id}`; notes.set(note.path, note); return note; },
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
  const fifth = await service.delegate(project.id, chief.id, { title: "Fifth" });
  assert.equal(fifth.queued, true, "a fifth task queues instead of failing");
  assert.match(fifth.reason, /4 of 4 workers busy/);
  assert.deepEqual(await service.drainQueue(project.id), [], "nothing starts while every slot is busy");
  finish(first, "First complete");
  finish(sessions.get(workers[1].sessionId), "Second complete");
  assert.deepEqual(await service.drainQueue(project.id), [fifth.taskId], "a freed slot starts the queued task");
  assert.equal(tasks.get(fifth.taskId).status, "in_progress");
  await service.stopWorker(project.id, fifth.taskId, "Not needed for this test");
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
  const logNotes = [...notes.values()].filter((n) => n.title.startsWith("Work log"));
  assert.equal(logNotes.length, 1, "one note per day");
  assert.match(logNotes[0].markdown, /one\n- [^\n]*two/);
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

test("reopening a finished worker neither arms a watcher nor changes its task", async () => {
  const taskId = id();
  const live = await agent.startSession({ workspaceId: main.id, origin: { kind: "worker", chiefSessionId: null, taskId } });
  tasks.set(taskId, { id: taskId, projectId: project.id, sessionId: live.id, status: "done", title: "Finished" });
  live.meta.status = "starting";
  service.attachWorker(live);
  live.meta.status = "idle";
  emit(live, { type: "status", state: "closed" });
  await tick();
  assert.equal(tasks.get(taskId).status, "done");
  assert.equal(await reports.savedReport(project, live.id), null);
});

test("an empty needs_person field does not block a finished worker", async () => {
  const worker = await service.delegate(project.id, null, { title: "Blank field" });
  finish(sessions.get(worker.sessionId), "```worker-summary\noutcome: done\nsummary: ok\nbranch: b\nneeds_person:\n```");
  await until(async () => await reports.savedReport(project, worker.sessionId));
  assert.equal(tasks.get(worker.taskId).status, "done");
  assert.match((await reports.savedReport(project, worker.sessionId)).content, /status="done"/);
});

test("the chief cannot start a worker that bypasses permissions", async () => {
  await assert.rejects(service.delegate(project.id, null, { title: "Escalate", permissionMode: "bypassPermissions" }));
  assert.equal([...tasks.values()].some((t) => t.title === "Escalate"), false);
});

test("the timeout pauses while waiting on the person", async () => {
  const { watchWorker } = load("@/lib/workers/watch");
  const live = await agent.startSession({ workspaceId: main.id });
  const completions = [];
  watchWorker(live, 0.0002, { pauseWhileAwaiting: true, finish: (result) => completions.push(result) });
  emit(live, { type: "status", state: "awaiting" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(completions.length, 0);
  emit(live, { type: "status", state: "running" });
  await until(() => completions.length);
  assert.match(completions[0].error, /Timed out/);
});

test("a deleted chief stops report retries", async () => {
  const ghost = id();
  const meta = { id: id(), origin: { kind: "worker", chiefSessionId: ghost, taskId: id() } };
  await reports.queueReport(project, meta, 1, "<worker_report>Orphan</worker_report>");
  await reports.flushReports(ghost);
  assert.equal((await reports.savedReport(project, meta.id)).delivered, true);
});

test("a new chief takes over reports from running workers", async () => {
  const old = await service.openChief(project.id);
  const worker = await service.delegate(project.id, old.id, { title: "Handed over" });
  const fresh = await service.openChief(project.id, true);
  fresh.meta.createdAt = new Date(Date.now() + 60_000).toISOString();
  const before = old.events.length;
  finish(sessions.get(worker.sessionId), "Handover complete");
  await until(async () => await reports.savedReport(project, worker.sessionId));
  await reports.flushReports(old.id);
  assert.match(fresh.events.find((e) => e.type === "user_message").content, /Handover complete/);
  assert.equal(old.events.slice(before).some((e) => e.type === "user_message"), false);
});

test("worker questions go to the chief, which answers or escalates with a recommendation", async () => {
  const questions = load("@/lib/workers/questions");
  const chief = await service.openChief(project.id);
  const worker = await service.delegate(project.id, chief.id, { title: "Cache choice" });
  const live = sessions.get(worker.sessionId);
  const ask = (requestId, results) => {
    const asked = [{ question: "Postgres or SQLite for this cache?", header: "Cache", multiSelect: false, options: [{ label: "Postgres", description: "" }, { label: "SQLite", description: "" }] }];
    emit(live, { type: "ask_question", requestId, toolUseId: id(), questions: asked, routedTo: "chief" });
    live.pending.set(requestId, { kind: "question", input: { questions: asked }, routedTo: "chief", resolve: (r) => results.push(r) });
    emit(live, { type: "status", state: "awaiting", waitingOn: "chief" });
    return asked;
  };

  const answered = id(); const results = [];
  await questions.forwardQuestion(live, answered, ask(answered, results));
  assert.match(chief.events.at(-1).content, /<worker_question id="[^"]+"[\s\S]*Postgres or SQLite[\s\S]*- SQLite/);
  assert.throws(() => questions.answerQuestion(project.id, answered, { Wrong: "SQLite" }), /Missing: "Postgres or SQLite/);
  assert.throws(() => questions.answerQuestion(id(), answered, { "Postgres or SQLite for this cache?": "SQLite" }), /No open worker question/);
  questions.answerQuestion(project.id, answered, { "Postgres or SQLite for this cache?": "SQLite" });
  assert.deepEqual(results[0].updatedInput.answers, { "Postgres or SQLite for this cache?": "SQLite" });
  assert.equal(live.events.at(-1).by, "chief");
  assert.throws(() => questions.answerQuestion(project.id, answered, { "Postgres or SQLite for this cache?": "SQLite" }), /No open worker question/);

  const escalated = id();
  await questions.forwardQuestion(live, escalated, ask(escalated, []));
  await questions.escalateQuestion(escalated, "SQLite: the cache is per machine", "The chief asked for your decision.", project.id);
  const event = live.events.at(-1);
  assert.equal(event.type, "question_escalated");
  assert.equal(event.recommendation, "SQLite: the cache is per machine");
  assert.equal(live.pending.get(escalated).routedTo, undefined, "the person owns it now");
  assert.equal(live.events.findLast((e) => e.type === "status").waitingOn, null);
  assert.throws(() => questions.answerQuestion(project.id, escalated, { "Postgres or SQLite for this cache?": "SQLite" }), /No open worker question/);

  const silent = id();
  await questions.forwardQuestion(live, silent, ask(silent, []), { timeoutMs: 5 });
  await until(() => live.events.some((e) => e.type === "question_escalated" && e.requestId === silent));
  assert.match(live.events.findLast((e) => e.type === "question_escalated").reason, /did not answer/);
});

test("a worker whose chief is gone escalates its question at once", async () => {
  const questions = load("@/lib/workers/questions");
  const live = await agent.startSession({ workspaceId: main.id, origin: { kind: "worker", chiefSessionId: id(), taskId: id() } });
  const requestId = id();
  live.pending.set(requestId, { kind: "question", input: { questions: [] }, routedTo: "chief", resolve: () => {} });
  await questions.forwardQuestion(live, requestId, []);
  assert.match(live.events.at(-1).reason, /no chief/);
  assert.equal(prompt.asksChiefFirst(live), true);
  assert.equal(prompt.asksChiefFirst({ meta: { origin: { kind: "worker", chiefSessionId: null, taskId: id() } } }), false);
  assert.match(prompt.teamPrompt({ kind: "chief" }), /workers_answer/);
});

test("a session waiting only on its chief does not need the person", () => {
  const { needsPerson } = load("@/lib/agent/types");
  assert.equal(needsPerson({ status: "awaiting", waitingOn: "chief" }), false);
  assert.equal(needsPerson({ status: "awaiting", waitingOn: null }), true);
  assert.equal(needsPerson({ status: "awaiting" }), true);
  assert.equal(needsPerson({ status: "running", waitingOn: null }), false);
});

test("delegation reuses existing workspaces, validates targets and serializes competing assignments", async () => {
  for (const live of sessions.values()) agent.closeSession(live.id);
  const chief = await service.openChief(project.id);
  const target = { ...main, id: id(), status: "active", cwd: path.join(tmp, "existing"), branch: "feature/existing" };
  const other = { ...target, id: id(), cwd: path.join(tmp, "other") };
  const foreign = { ...target, id: id(), projectId: id() };
  const archived = { ...target, id: id(), status: "archived" };
  for (const workspace of [target, other, foreign, archived]) workspaces.set(workspace.id, workspace);
  const beforeTasks = tasks.size;
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: id() }), /Workspace not found in this project/);
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: foreign.id }), /Workspace not found in this project/);
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: archived.id }), /Workspace is archived/);
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: target.id, repoIds: [project.repos[0].id] }), /Choose workspaceId or repoIds/);
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: target.id, mode: "scout" }), /cannot be used for scouts or races/);
  await assert.rejects(service.delegate(project.id, chief.id, { workspaceId: target.id, race: ["a", "b"] }), /cannot be used for scouts or races/);
  assert.equal(tasks.size, beforeTasks, "invalid targets create no tasks");

  const beforeWorkspaces = workspaceInputs.length;
  const results = await Promise.allSettled(["First", "Competing"].map((title) => service.delegate(project.id, chief.id, { title, workspaceId: target.id })));
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.match(results[1].reason.message, /Workspace already has an active worker/);
  const worker = results[0].value;
  const second = await service.delegate(project.id, chief.id, { title: "Other workspace", workspaceId: other.id });
  assert.equal(workspaceInputs.length, beforeWorkspaces, "existing targets create no worktrees");
  assert.equal(worker.workspaceId, target.id);
  assert.equal(second.workspaceId, other.id);
  assert.equal(tasks.get(worker.taskId).workspaceId, target.id);
  assert.equal(sessions.get(worker.sessionId).ctx.workspace, target, "keeps the existing checkout and branch");
  finish(sessions.get(worker.sessionId));
  finish(sessions.get(second.sessionId));
  await until(async () => await reports.savedReport(project, second.sessionId));
  const followup = await service.delegate(project.id, chief.id, { title: "Next task", workspaceId: target.id });
  assert.equal(followup.workspaceId, target.id, "a finished worker does not block reuse");
  finish(sessions.get(followup.sessionId));
  await until(async () => await reports.savedReport(project, followup.sessionId));
  await reports.flushReports(chief.id);
});

// ---- Orchestration: queue, scouts, races, stats, plans, overlaps, integration, cleanup ----
const { execFileSync } = require("node:child_process");
const workersState = load("@/lib/workers/state");
const sh = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
async function stopAll() {
  for (const live of sessions.values()) if (live.meta.origin?.kind === "worker" && ["running", "awaiting", "starting"].includes(live.meta.status)) agent.closeSession(live.id);
  await tick();
}
function finishWith(live, markdown, costUsd) { emit(live, { type: "turn_complete", markdown }); emit(live, { type: "result", isError: false, costUsd }); emit(live, { type: "status", state: "idle" }); }

test("queued delegation revalidates existing workspace ownership, activity and archive status", async () => {
  await stopAll();
  const blocker = await service.delegate(project.id, null, { title: "Dependency" });
  const target = { ...main, id: id(), status: "active", slug: "existing" };
  workspaces.set(target.id, target);
  const waiting = await service.delegate(project.id, null, { title: "Queued existing", workspaceId: target.id, dependsOn: [blocker.taskId] });
  assert.equal(waiting.queued, true);
  const competing = await service.delegate(project.id, null, { title: "Competing", workspaceId: target.id });
  tasks.get(blocker.taskId).status = "done";
  assert.deepEqual(await service.drainQueue(project.id), []);
  assert.equal(tasks.get(waiting.taskId).status, "blocked");
  await service.stopWorker(project.id, competing.taskId, "Cleanup");

  tasks.get(blocker.taskId).status = "in_progress";
  const archived = await service.delegate(project.id, null, { title: "Archived before start", workspaceId: target.id, dependsOn: [blocker.taskId] });
  target.status = "archived";
  tasks.get(blocker.taskId).status = "done";
  assert.deepEqual(await service.drainQueue(project.id), []);
  assert.equal(tasks.get(archived.taskId).status, "blocked");
  assert.equal((await workersState.readWorkerState(project)).queue.length, 0);
  await service.stopWorker(project.id, blocker.taskId, "Cleanup");
});

test("dependsOn queues a task until its dependency is accepted; a cancelled dependency blocks it and tells the chief", async () => {
  await stopAll();
  const chief = await service.openChief(project.id);
  const schema = await service.delegate(project.id, chief.id, { title: "Schema", brief: "Add the table" });
  const api = await service.delegate(project.id, chief.id, { title: "API", brief: "Use the table", dependsOn: [schema.taskId] });
  assert.equal(api.queued, true);
  assert.match(api.reason, new RegExp(`waiting for ${schema.taskId}`));
  const ui = await service.delegate(project.id, chief.id, { title: "UI", dependsOn: [api.taskId] });
  await assert.rejects(service.delegate(project.id, chief.id, { title: "Ghost", dependsOn: [id()] }), /not in this project/);
  assert.deepEqual(await service.drainQueue(project.id), [], "dependencies are not done yet");
  tasks.get(schema.taskId).status = "done";
  assert.deepEqual(await service.drainQueue(project.id), [api.taskId], "an accepted dependency releases the queued task");
  const { queued } = await service.workersStatus(project.id);
  assert.deepEqual(queued.map((q) => q.taskId), [ui.taskId]);
  await service.stopWorker(project.id, api.taskId, "Change of plan");
  assert.deepEqual(await service.drainQueue(project.id), []);
  assert.equal(tasks.get(ui.taskId).status, "blocked");
  assert.match(chief.events.at(-1).content, /<worker_queue task="[^"]+" status="blocked">[\s\S]*UI/);
  assert.equal((await workersState.readWorkerState(project)).queue.length, 0);
  await service.stopWorker(project.id, schema.taskId, "Done with test");
});

test("stopping a queued task removes it from the queue", async () => {
  await stopAll();
  const blocker = await service.delegate(project.id, null, { title: "Blocker" });
  const waiting = await service.delegate(project.id, null, { title: "Waiting", dependsOn: [blocker.taskId] });
  await service.stopWorker(project.id, waiting.taskId, "Not needed");
  assert.equal(tasks.get(waiting.taskId).status, "cancelled");
  assert.equal((await workersState.readWorkerState(project)).queue.length, 0);
  await service.stopWorker(project.id, blocker.taskId, "Cleanup");
});

test("a scout runs read-only in the main checkout, needs no Git repository and reports without a diff", async () => {
  await stopAll();
  const saved = project.repos;
  project.repos = [];
  try {
    await assert.rejects(service.delegate(project.id, null, { title: "Needs a repo" }), /Use mode "scout"/);
    const before = workspaceInputs.length;
    const scout = await service.delegate(project.id, null, { title: "Investigate flaky test", brief: "Find the cause", mode: "scout" });
    assert.equal(workspaceInputs.length, before, "no worktree is created");
    assert.equal(scout.workspaceId, main.id);
    const live = sessions.get(scout.sessionId);
    assert.equal(live.meta.origin.scout, true);
    assert.equal(prompt.readOnlySession(live.meta.origin), true);
    assert.equal(prompt.readOnlySession({ kind: "worker", taskId: id(), chiefSessionId: null }), false);
    assert.match(prompt.teamPrompt(live.meta.origin), /read-only scout/);
    finish(live, "```worker-summary\noutcome: done\nsummary: The clock is mocked twice\nbranch: none\n```");
    await until(async () => await reports.savedReport(project, live.id));
    const report = (await reports.savedReport(project, live.id)).content;
    assert.match(report, /Mode: scout/);
    assert.doesNotMatch(report, /^Diff:/m);
    assert.equal(tasks.get(scout.taskId).status, "done");
  } finally { project.repos = saved; }
  await assert.rejects(service.delegate(project.id, null, { title: "Bad race", mode: "scout", race: ["a", "b"] }), /Scouts cannot race/);
});

test("a race runs one task on several models; the pick hands the task to the winner and archives the rest", async () => {
  await stopAll();
  const before = workspaceInputs.length;
  const raced = await service.delegate(project.id, null, { title: "Rewrite parser", brief: "Make it faster", race: ["claude-sonnet-5-5", "claude-haiku-5-5"] });
  assert.equal(workspaceInputs.length - before, 2, "each racer gets its own worktree");
  assert.equal(raced.race.length, 2);
  const [a, b] = raced.race.map((e) => sessions.get(e.sessionId));
  assert.equal(a.meta.origin.raceId, b.meta.origin.raceId);
  assert.equal(a.meta.origin.taskId, b.meta.origin.taskId);
  assert.match(prompt.teamPrompt(a.meta.origin), /Other workers are doing the same task/);
  finishWith(a, "Sonnet version", 0.4);
  finishWith(b, "Haiku version", 0.1);
  await until(async () => (await reports.savedReport(project, a.id)) && (await reports.savedReport(project, b.id)));
  assert.equal(tasks.get(raced.taskId).status, "in_progress", "an undecided race leaves the task open");
  assert.match((await reports.savedReport(project, b.id)).content, /pick one with workers_pick/);
  await assert.rejects(service.pickRaceWinner(project.id, raced.taskId, id()), /not racing/);
  const picked = await service.pickRaceWinner(project.id, raced.taskId, b.id);
  assert.deepEqual(picked.archived, [a.meta.workspaceId]);
  assert.ok(archivedWorkspaces.includes(a.meta.workspaceId));
  assert.equal(a.meta.status, "closed");
  assert.equal(tasks.get(raced.taskId).sessionId, b.id);
  await assert.rejects(service.pickRaceWinner(project.id, raced.taskId, a.id), /already has a winner/);
  await service.messageWorker(project.id, raced.taskId, "Add a benchmark");
  finishWith(b, "Benchmark added", 0.2);
  await until(async () => (await reports.savedReport(project, b.id))?.content.includes("Benchmark added"));
  assert.equal(tasks.get(raced.taskId).status, "done", "the winner owns the task after the pick");
  const history = await service.workersHistory(project.id);
  const row = history.recent.find((r) => r.taskId === raced.taskId);
  assert.equal(row.rounds, 1, "racers' first rounds are not rework");
  assert.equal(Math.round(row.costUsd * 100), 70, "every racer's cost counts");
  assert.deepEqual(row.models.sort(), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
  assert.ok(history.byModel.some((m) => m.model === "claude-haiku-5-5"));
  await assert.rejects(service.delegate(project.id, null, { title: "Too big", race: ["a", "b", "c", "d"] }));
});

test("stats count each finish once, including after recovery", async () => {
  await stopAll();
  const worker = await service.delegate(project.id, null, { title: "Counted once", model: "claude-sonnet-5-5" });
  const live = sessions.get(worker.sessionId);
  finishWith(live, "First pass", 0.25);
  await until(async () => await reports.savedReport(project, live.id));
  await service.recoverWorkers();
  const stats = (await workersState.readWorkerState(project)).stats[worker.taskId];
  assert.equal(stats.rounds, 1);
  assert.equal(stats.costUsd, 0.25);
  assert.equal(stats.outcome, "done");
  assert.match((await reports.savedReport(project, live.id)).content, /Cost: \$0\.2500 this round/);
  const summary = workersState.summarizeStats([stats, { ...stats, taskId: id(), rounds: 3, costUsd: 0.75, outcome: "done" }]);
  assert.deepEqual(summary.map((s) => [s.model, s.tasks, s.avgRounds, s.firstRoundDone, s.totalCostUsd]), [["claude-sonnet-5-5", 2, 2, 1, 1]]);
});

test("a delegation plan waits for the person; approval delegates in order with dependencies, rejection tells the chief", async () => {
  await stopAll();
  const plans = load("@/lib/workers/plans");
  const chief = await service.openChief(project.id);
  await assert.rejects(plans.proposePlan(project.id, chief.id, { summary: "x", tasks: [{ key: "b", title: "B", brief: "b", dependsOn: ["a"] }] }), /not an earlier task/);
  const before = tasks.size;
  const proposed = await plans.proposePlan(project.id, chief.id, { summary: "Ship onboarding", tasks: [
    { key: "copy", title: "Onboarding copy", brief: "Write the copy" },
    { key: "email", title: "Onboarding email", brief: "Send it", dependsOn: ["copy"] },
  ] });
  assert.equal(tasks.size, before, "nothing starts before approval");
  const item = notifications.at(-1);
  assert.equal(item.kind, "delegation_plan");
  assert.equal(item.urgency, "action");
  assert.deepEqual(item.actions.map((a) => [a.label, a.body.decision]), [["Approve", "approve"], ["Reject", "reject"]]);
  assert.match(item.detail, /\[email\] Onboarding email \(after copy\)/);
  const decided = await plans.decidePlan(project.id, proposed.planId, "approve");
  assert.equal(decided.status, "approved");
  const [copy, email] = decided.results;
  assert.equal(copy.queued, false);
  assert.equal(email.queued, true);
  assert.deepEqual((await workersState.readWorkerState(project)).queue.find((q) => q.taskId === email.taskId).dependsOn, [copy.taskId]);
  assert.ok(resolved.includes(`chief:plan:${proposed.planId}`));
  assert.match(chief.events.at(-1).content, /<delegation_plan id="[^"]+" status="approved">[\s\S]*Onboarding copy: started[\s\S]*Onboarding email: queued/);
  await assert.rejects(plans.decidePlan(project.id, proposed.planId, "approve"), /already approved/);
  const rejected = await plans.proposePlan(project.id, chief.id, { summary: "Too much", tasks: [{ key: "x", title: "Rewrite everything", brief: "All of it" }] });
  const count = tasks.size;
  await plans.decidePlan(project.id, rejected.planId, "reject", "Start smaller");
  assert.equal(tasks.size, count);
  assert.match(chief.events.at(-1).content, /status="rejected">[\s\S]*Start smaller/);
  await service.stopWorker(project.id, email.taskId, "Cleanup");
  await service.stopWorker(project.id, copy.taskId, "Cleanup");
});

test("overlapping files are flagged, branches trial-merge into an integration worktree, and merged workspaces are archived", async () => {
  await stopAll();
  const root = fs.mkdtempSync(path.join(tmp, "repo-"));
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.email", "test@example.com"); sh(root, "config", "user.name", "Test");
  fs.writeFileSync(path.join(root, "a.txt"), "base\n");
  sh(root, "add", "."); sh(root, "commit", "-qm", "base");
  const saved = project.repos;
  const repo = { id: id(), kind: "repo", path: root, defaultBranch: "main", remote: null, name: "app" };
  project.repos = [repo];
  const worktreeWorkspace = (name) => {
    const dir = path.join(tmp, `wt-${name}-${id().slice(0, 4)}`);
    sh(root, "worktree", "add", "-q", "-b", name, dir, "main");
    const workspace = { id: id(), projectId: project.id, slug: name, name, branch: name, cwd: dir, status: "active", repos: [{ repoId: repo.id, name: "app", cwd: dir, branch: name, worktreePath: dir, baseRef: "main" }] };
    workspaces.set(workspace.id, workspace);
    return workspace;
  };
  const commit = (ws, file, text) => { fs.writeFileSync(path.join(ws.cwd, file), text); sh(ws.cwd, "add", "."); sh(ws.cwd, "commit", "-qm", `edit ${file}`); };
  try {
    const owned = async (ws, title) => {
      const taskId = id();
      const live = await agent.startSession({ workspaceId: ws.id, origin: { kind: "worker", chiefSessionId: null, taskId } });
      tasks.set(taskId, { id: taskId, projectId: project.id, title, sessionId: live.id, workspaceId: ws.id, status: "in_progress" });
      return { taskId, live };
    };
    const wsA = worktreeWorkspace("feature-a"), wsB = worktreeWorkspace("feature-b"), wsC = worktreeWorkspace("feature-c");
    const [a, b, c] = [await owned(wsA, "A"), await owned(wsB, "B"), await owned(wsC, "C")];
    commit(wsA, "a.txt", "from A\n");
    fs.writeFileSync(path.join(wsB.cwd, "a.txt"), "from B\n"); // uncommitted still overlaps
    commit(wsC, "c.txt", "new\n");
    const conflicts = load("@/lib/workers/conflicts");
    const overlaps = await conflicts.workerOverlaps([a, b, c].map((w, i) => ({ taskId: w.taskId, title: "ABC"[i], workspaceId: [wsA, wsB, wsC][i].id })));
    assert.deepEqual(overlaps.get(a.taskId), [{ taskId: b.taskId, title: "B", paths: ["a.txt"] }]);
    assert.deepEqual(overlaps.get(b.taskId).map((o) => o.taskId), [a.taskId]);
    assert.equal(overlaps.has(c.taskId), false);
    const status = await service.workersStatus(project.id, true);
    assert.deepEqual(status.workers.find((w) => w.task.id === a.taskId).overlaps.map((o) => o.paths), [["a.txt"]]);

    sh(wsB.cwd, "commit", "-qam", "B edit");
    fs.writeFileSync(path.join(tmp, "thunk.json"), JSON.stringify({ scripts: { test: "test -f c.txt && grep -q 'from A' a.txt" } }));
    const wsI = worktreeWorkspace("integration");
    nextWorkspace = () => wsI;
    const mainBefore = sh(root, "rev-parse", "main");
    const integrate = load("@/lib/workers/integrate");
    const result = await integrate.integrateWorkers(project.id, [a.taskId, b.taskId, c.taskId]);
    assert.deepEqual(result.merged.map((m) => m.title), ["A", "C"]);
    assert.deepEqual(result.conflicts.map((m) => [m.title, m.files]), [["B", ["a.txt"]]]);
    assert.equal(result.tests.exitCode, 0, result.tests.output);
    assert.equal(sh(wsI.cwd, "status", "--porcelain"), "", "the conflicting merge was aborted");
    assert.equal(sh(root, "rev-parse", "main"), mainBefore, "nothing merged into main");
    assert.equal(sh(wsI.cwd, "log", "--first-parent", "--format=%s", "-3"), "Integrate C\nIntegrate A\nbase", "the clean branches are merged on the integration branch");
    assert.deepEqual((await workersState.readWorkerState(project)).integrations.map((i) => i.workspaceId), [wsI.id]);
    await assert.rejects(integrate.integrateWorkers(project.id, [id()]), /Worker task not found/);

    const cleanup = load("@/lib/workers/cleanup");
    assert.equal(await cleanup.workspaceMerged({ project, workspace: wsC }), false);
    sh(root, "merge", "-q", "--no-edit", "feature-c");
    assert.equal(await cleanup.workspaceMerged({ project, workspace: wsC }), true);
    // An explicitly selected workspace stays the person's even when every session is a worker.
    const reused = worktreeWorkspace("existing-target");
    const reusedWorker = await service.delegate(project.id, null, { title: "Existing target", workspaceId: reused.id });
    assert.equal(sessions.get(reusedWorker.sessionId).meta.origin.existingWorkspace, true);
    tasks.get(reusedWorker.taskId).status = "done";
    emit(sessions.get(reusedWorker.sessionId), { type: "status", state: "idle" });
    tasks.get(c.taskId).status = "done";
    tasks.get(a.taskId).status = "done";
    for (const w of [a, b, c]) emit(w.live, { type: "status", state: "idle" });
    const archived = await cleanup.cleanupWorkerWorkspaces(project.id);
    assert.equal(archived.some((x) => x.workspaceId === reused.id), false, "explicitly selected workspaces are kept");
    assert.ok(archived.some((x) => x.workspaceId === wsC.id && x.reason === "merged"));
    assert.equal(archived.some((x) => x.workspaceId === wsA.id), false, "done but unmerged work is kept");
    assert.equal(archived.some((x) => x.workspaceId === wsB.id), false, "open tasks are kept");
  } finally { project.repos = saved; nextWorkspace = null; }
});
