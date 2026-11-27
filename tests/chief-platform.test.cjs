/* eslint-disable @typescript-eslint/no-require-imports -- Load the TypeScript sources with the installed compiler. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-chief-platform-"));
process.env.THUNK_DATA_DIR = tmp;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { fileName: f, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (r, ...args) { if (r.startsWith("@/")) { const base = path.join(__dirname, "..", r.slice(2)); r = [base + ".ts", base + ".tsx"].find(fs.existsSync) || base; } return resolve.call(this, r, ...args); };

// Notes and canvases use their real file stores under a temporary data directory; the database and sessions are faked.
const project = { id: "p1", dataKey: "platform-test", name: "Test", repos: [{ id: "r1", kind: "repo" }] };
const workspaces = new Map([["w1", { id: "w1", projectId: "p1", name: "Io", slug: "io", branch: "thunk/io", status: "active", visibility: "workspace" }], ["other", { id: "other", projectId: "p2", name: "Elsewhere", slug: "elsewhere", status: "active" }]]);
const calls = [];
const emitted = [];
const boardSessions = new Map();
let queued = false;
const load = Module._load;
Module._load = function (r, parent, main) {
  if (r === "server-only") return {};
  if (r === "@/lib/notes/resolve") return { projectNoteDirs: (p) => ({ scope: { kind: "projects", id: p.id }, notesDir: path.join(tmp, "notes"), memoryFile: path.join(tmp, "MEMORY.md"), memoryTitle: "Project memory" }) };
  if (r === "@/lib/db/repo/workspaces") return { getWorkspace: async (id) => workspaces.get(id) ?? null, listWorkspaces: async (projectId) => [...workspaces.values()].filter((w) => w.projectId === projectId) };
  if (r === "@/lib/projects") return { createWorkspace: async (input) => { calls.push(["workspace", input]); return { id: "w2", name: input.name ?? "Europa", branch: "thunk/europa" }; } };
  if (r === "./service" && parent?.filename.endsWith("platform-tools.ts")) return { delegate: async (projectId, chiefId, input) => { calls.push(["delegate", projectId, chiefId, input]); return queued ? { taskId: "t1", queued: true } : { taskId: "t1", sessionId: "s1", workspaceId: input.workspaceId }; } };
  if (r === "@/lib/agent") return { getSession: (id) => boardSessions.get(id), emit: (live, event) => { emitted.push([live.id, event]); } };
  if (r === "@/lib/routes.server") return { hrefForSession: async (w, s) => `/w/${w}/s/${s}` };
  if (r === "@/lib/routines/service") return { createRoutine: async (input) => { calls.push(["routine", input]); return { id: "rt1", name: input.name, enabled: input.enabled }; } };
  return load.call(this, r, parent, main);
};
const { chiefTools } = require("../lib/workers/tools.ts");
const { CHIEF_TOOL_NAMES, PLATFORM_TOOL_NAMES, teamPrompt } = require("../lib/workers/prompt.ts");
const chief = { id: "chief", meta: { origin: { kind: "chief" }, projectId: "p1", model: "claude-sonnet-5-5" }, ctx: { project, workspace: { slug: "main" } } };
const tools = chiefTools(chief);
const call = async (name, input = {}) => {
  const result = await tools.find((t) => t.name === name).handler(input);
  if (result.isError) throw new Error(result.content[0].text);
  return JSON.parse(result.content[0].text);
};

test("every platform tool is mounted for the chief only, auto-allowed and named in its prompt", () => {
  for (const name of PLATFORM_TOOL_NAMES) {
    assert.ok(tools.some((t) => t.name === name), name);
    assert.ok(CHIEF_TOOL_NAMES.includes(name), name);
    assert.ok(teamPrompt({ kind: "chief" }).includes(name), name);
  }
  assert.deepEqual(chiefTools({ ...chief, meta: { ...chief.meta, origin: { kind: "worker" } } }), []);
});

test("the chief writes and updates project notes without file tools", async () => {
  const made = await call("notes_create", { title: "Launch plan", markdown: "- [ ] Draft the email", tags: ["launch"], workspaceIds: ["w1"] });
  const file = fs.readFileSync(made.path, "utf8");
  assert.match(file, /title: Launch plan/);
  assert.match(file, /- \[ \] Draft the email/);
  assert.match(file, /w1/);
  await call("notes_update", { noteId: made.noteId, markdown: "- [x] Draft the email" });
  const updated = fs.readFileSync(made.path, "utf8");
  assert.match(updated, /- \[x\] Draft the email/);
  assert.match(updated, /title: Launch plan/);
  await assert.rejects(call("notes_update", { noteId: "missing00", markdown: "x" }), /No project note/);
  await assert.rejects(call("notes_update", { noteId: "MEMORY", markdown: "x" }), /chief_log/);
  await assert.rejects(call("notes_create", { title: "x", markdown: "y", workspaceIds: ["other"] }), /No workspace with that id/);
});

test("the chief has the canvas agent's whole toolset on any canvas: text, images, charts and edits", async () => {
  assert.deepEqual(await call("canvases_list"), [{ boardId: "main", name: "Canvas" }]);
  const canvas = await call("canvases_create", { name: "Onboarding ideas" });
  const board_id = canvas.boardId;
  const { snapshot, readBoard, saveBoard } = require("../lib/board/store.ts");
  const { projectBoardsDir } = require("../lib/projects/paths.ts");
  const dir = projectBoardsDir(project.dataKey, board_id);
  const text = await call("canvas_add_card", { board_id, title: "First idea", markdown: "A star chart." });
  assert.equal(emitted.length, 0, "no canvas agent session is live yet");
  // Once the canvas has a live agent session, saved cards are broadcast to whoever has it open.
  const board = await readBoard(dir); board.agent = { sessionId: "board-session", sdkSessionId: null }; await saveBoard(dir, board);
  boardSessions.set("board-session", { id: "board-session" });
  const image = await call("canvas_add_image", { board_id, title: "Diagram", svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"/></svg>' });
  assert.equal(image.kind, "image");
  assert.deepEqual(emitted.at(-1), ["board-session", { type: "board_op", boardId: board_id, op: { card: image } }]);
  const chart = await call("canvas_add_chart", { board_id, title: "Signups", type: "bar", x: "week", series: [{ key: "n", label: "Signups" }], rows: [{ week: "W1", n: 3 }, { week: "W2", n: 5 }] });
  assert.equal(chart.kind, "chart");
  await call("canvas_edit_card", { board_id, card_id: text.id, edits: [{ old_string: "star chart", new_string: "solar system" }] });
  const cards = (await snapshot(dir)).cards;
  assert.deepEqual(cards.map((c) => c.kind).sort(), ["chart", "doc", "image"]);
  assert.equal(cards.find((c) => c.id === text.id).markdown, "A solar system.");
  assert.equal((await call("canvas_read", { board_id })).length, 3);
  assert.equal((await call("canvas_add_card", { title: "On main", markdown: "Hello" })).title, "On main");
  assert.equal((await snapshot(projectBoardsDir(project.dataKey, "main"))).cards.length, 1);
  await assert.rejects(call("canvas_add_card", { board_id: "nope", title: "x", markdown: "y" }), /No canvas with that id/);
  await assert.rejects(call("canvas_add_image", { board_id, svg: "not svg" }), /SVG markup/);
});

test("the chief opens workspaces, sessions and routines inside its own project", async () => {
  assert.deepEqual((await call("workspaces_list")).map((w) => w.workspaceId), ["w1"]);
  const workspace = await call("workspaces_create", { name: "Relay polish" });
  assert.deepEqual(calls.at(-1), ["workspace", { projectId: "p1", visibility: "workspace", name: "Relay polish" }]);
  assert.equal(workspace.workspaceId, "w2");
  await assert.rejects(call("workspaces_create", { repoIds: ["bogus"] }), /Unknown repoIds/);
  // A session the chief starts is a worker in a visible workspace: it has a task and reports back.
  const session = await call("sessions_start", { prompt: "Explain the router\nIn detail", workspaceId: "w1" });
  assert.equal(session.href, "/w/w1/s/s1");
  assert.deepEqual(calls.at(-1), ["delegate", "p1", "chief", { title: "Explain the router", brief: "Explain the router\nIn detail", workspaceId: "w1" }]);
  const fresh = await call("sessions_start", { prompt: "Start fresh", title: "Fresh start", model: "claude-opus-5-5" });
  assert.deepEqual(calls.at(-2), ["workspace", { projectId: "p1", visibility: "workspace", setup: "await" }]);
  assert.deepEqual(calls.at(-1)[3], { title: "Fresh start", brief: "Start fresh", workspaceId: "w2", model: "claude-opus-5-5" });
  assert.equal(fresh.workspaceId, "w2");
  queued = true;
  assert.match((await call("sessions_start", { prompt: "Later", workspaceId: "w1" })).note, /Queued/);
  queued = false;
  await assert.rejects(call("sessions_start", { prompt: "x", workspaceId: "other" }), /No workspace with that id/);
  await assert.rejects(call("sessions_start", { prompt: "x", permissionMode: "bypassPermissions" }));
  const routine = await call("routines_create", { name: "Weekly review", prompt: "Review open PRs", scheduleCron: "0 9 * * 1" });
  assert.equal(routine.routineId, "rt1");
  const input = calls.at(-1)[1];
  assert.equal(input.projectId, "p1");assert.equal(input.targetKind, "ephemeral");assert.equal(input.model, "claude-sonnet-5-5");assert.equal(input.enabled, true);
  await assert.rejects(call("routines_create", { name: "Bad", prompt: "x", scheduleCron: "not a cron" }), /Schedule/);
});
