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
const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const otherWorkspace = "44444444-4444-4444-8444-444444444444";
const ctx = { projectId, workspaceId, sessionId };
let rows, writes, requests, rpc;
const mocks = {
  "@/lib/supabase/repo/tasks": { listTasks: async ({ projectId }) => rows.filter((t) => t.projectId === projectId) },
  "@/lib/supabase/repo/workspaces": { getWorkspace: async (id) => ({ id, projectId }) },
  "@/lib/tasks/service": {
    createTask: async (input, meta) => { const task = { ...input, ...meta, id: crypto.randomUUID(), status: "open" }; rows.push(task); writes.push(task); return task; },
    patchTask: async (id, patch) => { const task = rows.find((t) => t.id === id); Object.assign(task, patch); writes.push(patch); return task; },
    tasksForWorkspace: async () => ({ workspace: rows.filter((t) => t.workspaceId === workspaceId && t.projectId === projectId), project: rows.filter((t) => t.workspaceId === null && t.projectId === projectId) }),
  },
  "@anthropic-ai/claude-agent-sdk": { createSdkMcpServer: (v) => v, tool: (name, description, schema, handler) => ({ name, description, schema, handler }) },
  "@/lib/notes/prompt": { loadSessionNotes: async () => ({ projectDir: "/tmp", repos: [], workspaceDir: "/tmp" }), notesPrompt: () => "notes" },
  "@/lib/projects/connectors": { readConnectors: async () => ({ config: { mcpServers: {} } }), codexConnectors: () => ({}) },
  "@/lib/projects/memory": { readMemory: async () => "" },
  "@/lib/projects/paths": Object.fromEntries(["projectMemoryDir", "projectMemoryFile", "workspaceMemoryDir", "workspaceMemoryFile", "projectVaultDir", "projectInstructionsFile", "projectConfigDir"].map((k) => [k, () => "/tmp"])),
  "@/lib/vault/store": { listItems: async () => [], readItem: async () => null },
  "@/lib/routines/prompt": { routineSystemPrompt: () => "" },
};
const registry = { emit: () => {}, setState: () => {} };
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (mocks[request]) return mocks[request];
  if (request === "./service" && parent?.filename.endsWith("/tasks/tools.ts")) return mocks["@/lib/tasks/service"];
  if (["./session-registry", "../session-registry"].includes(request)) return registry;
  if (request === "../event-bridge") return {};
  if (request === "./rpc") return { CodexRpc: class {
    constructor(opts) { this.opts = opts; this.exited = Promise.resolve({ killed: true }); rpc = { opts }; }
    async request(method, params) { requests.push({ method, params }); return { thread: { id: "thread" }, model: "codex", cwd: "/tmp" }; }
    notify(method) { requests.push({ method }); }
    kill() {}
  } };
  return load.call(this, request, parent, ...rest);
};
const { tasksTools, resolveTaskId, TASK_TOOL_NAMES } = require("../lib/tasks/tools.ts");
const { tasksPrompt } = require("../lib/tasks/prompt.ts");
const { buildCanUseTool } = require("../lib/agent/permissions.ts");
const { buildOptions } = require("../lib/agent/options.ts");
const { createCodexDriver } = require("../lib/agent/codex/driver.ts");
const call = (name, args, context = ctx) => tasksTools(context).find((t) => t.name === name).handler(args);
const text = (result) => result.content[0].text;
const task = (id, extra = {}) => ({ id, projectId, workspaceId, title: "Workspace job", status: "open", body: null, sessionId: null, ...extra });
const live = () => ({ id: sessionId, ctx: { project: { id: projectId, dataKey: "project", repos: [], name: "Project" }, workspace: { id: workspaceId, cwd: "/tmp", slug: "ws", repos: [] } }, meta: { model: "codex", permissionMode: "default" }, events: [], pending: new Map(), stderrTail: [] });
beforeEach(() => {
  rows = [task("aaaaaaaa-1111-4111-8111-111111111111"), task("bbbbbbbb-1111-4111-8111-111111111111", { workspaceId: null, title: "Project job" }), task("cccccccc-1111-4111-8111-111111111111", { workspaceId: otherWorkspace, title: "Sibling job" }), task("dddddddd-1111-4111-8111-111111111111", { projectId: otherWorkspace, title: "Secret job" })];
  writes = []; requests = [];
});

test("UUID resolution accepts full IDs and unique case-insensitive prefixes, rejects ambiguity and invalid IDs", () => {
  assert.equal(resolveTaskId("AAAAAAAA", rows), rows[0].id);
  assert.equal(resolveTaskId(rows[0].id, rows), rows[0].id);
  assert.throws(() => resolveTaskId("", rows), /UUID/);
  assert.throws(() => resolveTaskId("%", rows), /UUID/);
  assert.throws(() => resolveTaskId("eeee", rows), /not found/);
  assert.throws(() => resolveTaskId("aaaa", [...rows, task("aaaaaaaa-2222-4222-8222-222222222222")]), /Ambiguous/);
});

test("list scopes exclude other projects and open status excludes completed tasks", async () => {
  rows.push(task("eeeeeeee-1111-4111-8111-111111111111", { status: "done", title: "Finished" }));
  assert.match(text(await call("tasks_list", {})), /Workspace job/);
  assert.doesNotMatch(text(await call("tasks_list", {})), /Project job|Sibling job|Secret job|Finished/);
  assert.match(text(await call("tasks_list", { scope: "project" })), /Project job/);
  const all = text(await call("tasks_list", { scope: "all", status: "all" }));
  assert.match(all, /Sibling job/); assert.match(all, /Finished/); assert.doesNotMatch(all, /Secret job/);
});

test("create fixes scope and provenance; malformed inputs and forged scope fields never write", async () => {
  assert.equal((await call("tasks_create", { title: "Work", scope: "project", priority: 3 })).isError, false);
  assert.equal(writes[0].projectId, projectId); assert.equal(writes[0].workspaceId, null);
  assert.equal(writes[0].sessionId, sessionId); assert.equal(writes[0].createdBy, "agent"); assert.equal(writes[0].createdInSessionId, sessionId);
  for (const args of [{ title: " " }, { title: "x", priority: 4 }, { title: "x", projectId: otherWorkspace }, { title: "x", workspaceId: otherWorkspace }])
    assert.equal((await call("tasks_create", args)).isError, true);
  assert.equal(writes.length, 1);
  assert.equal((await call("tasks_list", {}, { ...ctx, projectId: otherWorkspace })).isError, true);
});

test("routine sessions file project-level tasks marked as routine work, and list every workspace by default", async () => {
  const routineCtx = { ...ctx, routine: true };
  assert.equal((await call("tasks_create", { title: "Found during the run" }, routineCtx)).isError, false);
  assert.equal(writes[0].workspaceId, null); assert.equal(writes[0].createdBy, "routine"); assert.equal(writes[0].createdInSessionId, sessionId);
  assert.equal((await call("tasks_create", { title: "Here", scope: "workspace" }, routineCtx)).isError, false);
  assert.equal(writes[1].workspaceId, workspaceId);
  const listed = text(await call("tasks_list", {}, routineCtx));
  assert.match(listed, /Sibling job/); assert.match(listed, /Project job/); assert.doesNotMatch(listed, /Secret job/);
  assert.equal((await call("tasks_create", { title: "Interactive" })).isError, false);
  assert.equal(writes[2].workspaceId, workspaceId); assert.equal(writes[2].createdBy, "agent");
});

test("updates/completions cannot cross projects; claims cannot cross workspaces", async () => {
  for (const name of ["tasks_update", "tasks_complete"])
    for (const id of [rows[3].id, "dddddddd"])
      assert.equal((await call(name, { id })).isError, true);
  assert.equal((await call("tasks_update", { id: "cccccccc", claim: true })).isError, true);
  assert.equal((await call("tasks_update", { id: "aaaaaaaa", sessionId: "forged" })).isError, true);
  assert.equal(writes.length, 0);
  for (const id of ["aaaaaaaa", "bbbbbbbb"]) {
    assert.equal((await call("tasks_update", { id, claim: true, status: "in_progress" })).isError, false);
    assert.equal(rows.find((t) => t.id.startsWith(id)).sessionId, sessionId);
  }
  rows[0].body = "Original";
  assert.equal((await call("tasks_complete", { id: "aaaaaaaa", note: "Finished" })).isError, false);
  assert.equal(rows[0].body, "Original\n\nFinished"); assert.equal(rows[0].status, "done");
  rows[0].body = "x".repeat(20_000);
  assert.equal((await call("tasks_complete", { id: "aaaaaaaa", note: "overflow" })).isError, true);
  assert.equal(rows[0].body.length, 20_000);
});

test("Claude autoallows local task and notification tools; similarly named tools still request permission", async () => {
  const session = live(); const canUse = buildCanUseTool(session);
  const opts = { toolUseID: "tool", signal: new AbortController().signal };
  for (const name of [...TASK_TOOL_NAMES, "notify"]) assert.equal((await canUse(`mcp__thunk__${name}`, {}, opts)).behavior, "allow");
  for (const name of ["tasks_create", "mcp__evil__tasks_create", "mcp__thunk__tasks_delete", "mcp__thunk__tasks_create_extra"]) {
    const pending = canUse(name, {}, opts);
    assert.equal(session.pending.size, 1);
    const [id, req] = [...session.pending][0]; session.pending.delete(id); req.resolve({ behavior: "deny", message: "Test" });
    assert.equal((await pending).behavior, "deny");
  }
});

test("both transports include workspace/project tasks and register validated tools", async () => {
  const options = await buildOptions(live(), {});
  assert.equal(options.mcpServers.thunk.alwaysLoad, true);
  assert.deepEqual(options.mcpServers.thunk.tools.map((t) => t.name), ["notify", ...TASK_TOOL_NAMES, "vault_list", "vault_read"]);
  assert.match(options.systemPrompt.append, /Workspace job/); assert.match(options.systemPrompt.append, /Project job/);
  assert.doesNotMatch(options.systemPrompt.append, /Secret job|Sibling job/);
  const driver = await createCodexDriver(live(), {}); await driver.run();
  assert.equal(requests[0].params.capabilities.experimentalApi, true);
  const start = requests.find((r) => r.method === "thread/start").params;
  assert.deepEqual(start.dynamicTools.map((t) => t.name), ["notify", ...TASK_TOOL_NAMES, "vault_list", "vault_read"]);
  assert.ok(start.dynamicTools.every((t) => t.type === "function" && t.inputSchema.additionalProperties === false));
  assert.match(start.developerInstructions, /Workspace job/); assert.match(start.developerInstructions, /Project job/);
  assert.doesNotMatch(start.developerInstructions, /Secret job|Sibling job/);
  const request = { threadId: "thread", namespace: null, tool: "tasks_complete", arguments: { id: "aaaaaaaa" } };
  assert.equal((await rpc.opts.onRequest("item/tool/call", request, 1)).success, true);
  assert.equal((await rpc.opts.onRequest("item/tool/call", { ...request, threadId: "other" }, 2)).success, false);
  assert.equal((await rpc.opts.onRequest("item/tool/call", { ...request, namespace: "evil" }, 3)).success, false);
  assert.equal((await rpc.opts.onRequest("item/tool/call", { ...request, tool: "tasks_delete" }, 4)).success, false);
  assert.equal((await rpc.opts.onRequest("item/tool/call", { ...request, arguments: { id: "dddddddd" } }, 5)).success, false);
  requests = [];
  await (await createCodexDriver(live(), { resume: "thread" })).run();
  assert.equal(requests.find((r) => r.method === "thread/resume").params.dynamicTools, undefined);
});

test("prompt omits done tasks and directs agents to claim and complete work", () => {
  rows[0].status = "done";
  const prompt = tasksPrompt(rows.slice(0, 2));
  assert.doesNotMatch(prompt, /Workspace job/); assert.match(prompt, /bbbbbbbb/);
  assert.match(prompt, /claim tasks you start/); assert.match(prompt, /tasks_complete/);
});

test("chief tools are mounted on both providers and Claude blocks file writes", async () => {
  const chief = live();
  chief.meta.origin = { kind: "chief" };
  const options = await buildOptions(chief, {});
  assert.deepEqual(options.disallowedTools, ["Edit", "Write", "NotebookEdit"]);
  const names = options.mcpServers.thunk.tools.map((t) => t.name);
  for (const name of ["delegate", "workers_status", "workers_message", "workers_stop", "chief_log"]) assert.ok(names.includes(name));
  assert.equal((await buildOptions(live(), {})).mcpServers.thunk.tools.some((t) => t.name === "delegate"), false);
  const canUse = buildCanUseTool(chief);
  const opts = { toolUseID: "write", signal: new AbortController().signal };
  assert.equal((await canUse("Edit", {}, opts)).behavior, "deny");
  assert.equal((await canUse("Bash", { command: "git commit -am changes" }, opts)).behavior, "deny");
  assert.equal((await canUse("mcp__thunk__delegate", { title: "Work" }, opts)).behavior, "allow");
  await (await createCodexDriver(chief, {})).run();
  const start = requests.find((r) => r.method === "thread/start");
  assert.ok(start.params.dynamicTools.some((t) => t.name === "delegate"));
  assert.match(start.params.developerInstructions, /Project chief/);
});
