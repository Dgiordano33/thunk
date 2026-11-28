/* eslint-disable @typescript-eslint/no-require-imports -- Compile server modules with the installed TypeScript compiler. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
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
const lives = new Map();
const pushed = [];
const tasks = {};
let wsCtx = null;
const mocks = {
  "../server": { db: () => current, hasDatabase: () => Boolean(current) },
  "@/lib/db/server": { db: () => current, hasDatabase: () => Boolean(current) },
  "@/lib/agent/session-registry": { getSession: (id) => lives.get(id) },
  "@/lib/agent": {
    getSession: (id) => lives.get(id), listLiveSessions: () => [...lives.values()], isTerminated: () => false, WorkspaceArchivedError: class extends Error {},
    resumeSession: async (id) => lives.get(id) ?? null, pushUserMessage: (live, content) => { pushed.push({ id: live.id, content }); return "m1"; },
  },
  "@/lib/projects": { getWorkspaceContext: async () => wsCtx },
  "@/lib/db/repo/sessions": { getSessionRow: async (id) => ({ id, workspaceId: "w" }) },
  "@/lib/db/repo/tasks": { getTask: async (id) => tasks[id] ?? null },
  "@/lib/db/repo/projects": { getProject: async () => wsCtx?.project ?? null },
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "server-only") return {};
  if (mocks[request]) return mocks[request];
  // notes/prompt's loaders touch the real note dirs; the builders under test are pure.
  if (parent?.filename?.endsWith(path.join("lib", "notes", "prompt.ts")) && (request === "./resolve" || request === "./store")) return {};
  return load.call(this, request, parent, ...rest);
};

const { testDb } = require("./helpers/test-db.cjs");
const { notesPrompt, INJECT_LIMIT } = require("../lib/notes/prompt.ts");
const { tasksPrompt } = require("../lib/tasks/prompt.ts");
const { vaultPrompt } = require("../lib/vault/tools.ts");
const { recordContextItems, recordRead, sessionPersisted } = require("../lib/context/record.ts");
const repo = require("../lib/db/repo/context-items.ts");
const { contextGroup, REASONS } = require("../lib/context/types.ts");
const route = require("../app/api/sessions/[id]/context/route.ts");
const itemRoute = require("../app/api/sessions/[id]/context/[itemId]/route.ts");
const holdersRoute = require("../app/api/context/note-sessions/route.ts");
const { buildNoteUpdatePayload, buildAttachmentPayload } = require("../lib/context/payloads.ts");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-context-"));
const note = (id, markdown, flags = {}) => ({ id, title: id, path: path.join(tmp, "notes", `${id}.md`), updatedAt: "2026-11-27T00:00:00Z", markdown, pinned: false, inject: false, actionable: false, openTasks: 0, ...flags });
const sessionNotes = (project) => ({ projectDir: path.join(tmp, "notes"), workspaceDir: path.join(tmp, "notes"), project, workspace: [], repos: [] });
const byRef = (items) => Object.fromEntries(items.map((i) => [i.refId, i]));
const ctx = (id) => ({ params: Promise.resolve({ id }) });

let sessionId;
before(async () => {
  current = await testDb();
  const [p] = await current.query("insert into projects (name, data_key, slug) values ('Ctx', 'ctx', 'ctx') returning id");
  const [w] = await current.query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'main', 'main', $2) returning id", [p.id, tmp]);
  sessionId = crypto.randomUUID();
  await current.query("insert into sessions (id, workspace_id, cwd, model, permission_mode) values ($1, $2, $3, 'claude-sonnet', 'default')", [sessionId, w.id, tmp]);
  wsCtx = { project: { id: p.id, dataKey: "ctx", name: "Ctx" }, workspace: { id: w.id, slug: "main" } };
  fs.mkdirSync(path.join(tmp, "notes"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "memory"), { recursive: true });
});
after(async () => { await current?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test("prompt builders record what went in and why the rest was left out", () => {
  const big = "b".repeat(INJECT_LIMIT);
  const { items } = notesPrompt(sessionNotes([note("small", "hello", { inject: true }), note("big", big, { inject: true }), note("late", "never", { inject: true }), note("plain", "listed only")]));
  const notes = byRef(items);
  assert.equal(notes.small.mode, "full");
  assert.equal(notes.small.chars, 5);
  assert.equal(notes.big.mode, "truncated");
  assert.equal(notes.big.reason, REASONS.overLimit(INJECT_LIMIT));
  assert.equal(notes.late.mode, "omitted");
  assert.match(notes.late.reason, /24,000-character limit/);
  assert.equal(notes.plain.mode, "index");
  assert.equal(notes.plain.reason, REASONS.notInjected);
  assert.equal(contextGroup({ ...notes.plain, origin: "prompt", removedAt: null }), "left_out");
  assert.equal(contextGroup({ ...notes.small, origin: "prompt", removedAt: null }), "prompt");

  const vault = byRef(vaultPrompt([
    { id: "pinnedaaaa", title: "Spec", kind: "pdf", filename: "s.pdf", status: "ready", pinned: true, summary: "The spec." },
    { id: "loosebbbbb", title: "Deck", kind: "office", filename: "d.pptx", status: "ready", summary: "A deck." },
  ], "/vault").items);
  assert.equal(vault.pinnedaaaa.mode, "full");
  assert.equal(vault.loosebbbbb.mode, "index");
  assert.equal(vault.loosebbbbb.reason, REASONS.notPinned);

  const task = { id: "t-1", title: "Ship", status: "open", body: "", workspaceId: null, sessionId: null };
  assert.deepEqual(tasksPrompt([task]).items.map((i) => [i.kind, i.refId, i.mode]), [["task", "t-1", "index"]]);
  assert.equal(tasksPrompt([task], { exclude: new Set(["task:t-1"]) }).items.length, 0);
  assert.doesNotMatch(notesPrompt(sessionNotes([note("small", "hello", { inject: true })]), { exclude: new Set(["note:small"]) }).text, /hello/);
});

test("the context route reports changedSince by hash; resume rewrites the prompt set and keeps fetched and removed items", async () => {
  const notePath = path.join(tmp, "notes", "spec.md");
  fs.writeFileSync(notePath, "---\ntitle: Spec\ninject: true\n---\nThe plan.");
  const memoryPath = path.join(tmp, "memory", "MEMORY.md");
  fs.writeFileSync(memoryPath, "fact one");
  sessionPersisted(sessionId);
  const spec = note("spec", "The plan.", { inject: true, title: "Spec", path: notePath });
  await recordContextItems(sessionId, "prompt", notesPrompt(sessionNotes([spec, note("other", "x", { inject: true })])).items);
  await recordRead(sessionId, { notes: [path.join(tmp, "notes")], memory: [{ dir: path.join(tmp, "memory"), refId: "project", title: "Project memory" }], vault: path.join(tmp, "vault") }, memoryPath);
  await recordRead(sessionId, { notes: [], memory: [], vault: path.join(tmp, "vault") }, "/etc/hosts");

  let items = (await (await route.GET(new Request("http://x"), ctx(sessionId))).json()).items;
  const get = (ref, origin) => items.find((i) => i.refId === ref && i.origin === origin);
  assert.equal(items.length, 3);
  assert.equal(get("spec", "prompt").changedSince, false);
  assert.equal(get("project", "fetched").kind, "memory");
  assert.equal(get("project", "fetched").changedSince, false);

  fs.writeFileSync(notePath, "---\ntitle: Spec\ninject: true\nupdated: 2026-11-28\n---\nThe plan, revised.");
  fs.writeFileSync(memoryPath, "fact one\nfact two");
  items = (await (await route.GET(new Request("http://x"), ctx(sessionId))).json()).items;
  assert.equal(get("spec", "prompt").changedSince, true);
  assert.equal(get("spec", "prompt").canUpdate, true);
  assert.equal(get("project", "fetched").changedSince, true);
  // A frontmatter-only change is not a content change.
  fs.writeFileSync(notePath, "---\ntitle: Spec\ninject: false\n---\nThe plan.");
  items = (await (await route.GET(new Request("http://x"), ctx(sessionId))).json()).items;
  assert.equal(get("spec", "prompt").changedSince, false);

  await repo.setContextItemRemoved(sessionId, get("other", "prompt").id, true);
  items = (await (await route.GET(new Request("http://x"), ctx(sessionId))).json()).items;
  assert.equal(get("other", "prompt").removalPending, true, "a removal waits for the next start");

  // Resume: the builders leave the removed note out and the prompt set is rebuilt.
  const removed = await repo.removedContextKeys(sessionId);
  await new Promise((r) => setTimeout(r, 5));
  await recordContextItems(sessionId, "prompt", notesPrompt(sessionNotes([spec, note("other", "x", { inject: true })]), { exclude: removed }).items);
  items = (await (await route.GET(new Request("http://x"), ctx(sessionId))).json()).items;
  assert.equal(items.filter((i) => i.origin === "prompt").length, 2);
  assert.equal(get("other", "prompt").removalPending, false);
  assert.equal(contextGroup(get("other", "prompt")), "left_out");
  assert.ok(get("project", "fetched"), "fetched items survive a resume");

  assert.equal((await route.GET(new Request("http://x"), ctx(crypto.randomUUID()))).status, 200);
  wsCtx = null;
  assert.equal((await route.GET(new Request("http://x"), ctx(crypto.randomUUID()))).status, 404);
});

const post = (body) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("attach pushes a context_attachment and records it; Send update pushes a note_update diff and records the new hash", async () => {
  const [w] = await current.query("select id from workspaces limit 1");
  wsCtx = { project: { id: (await current.query("select id from projects limit 1"))[0].id, dataKey: "ctx", name: "Ctx" }, workspace: { id: w.id, slug: "main" } };
  const id = crypto.randomUUID();
  await current.query("insert into sessions (id, workspace_id, cwd, model, permission_mode) values ($1, $2, $3, 'claude-sonnet', 'default')", [id, w.id, tmp]);
  lives.set(id, { id, ctx: wsCtx, meta: { title: "Worker" } });
  sessionPersisted(id);
  tasks["t-9"] = { id: "t-9", projectId: wsCtx.project.id, workspaceId: null, title: "Ship the view", body: "Details", status: "open", priority: 1, noteId: null };
  pushed.length = 0;

  let res = await route.POST(post({ kind: "task", id: "t-9" }), ctx(id));
  assert.equal(res.status, 200);
  assert.match(pushed[0].content, /^<context_attachment kind="task" id="t-9" title="Ship the view">/);
  assert.match(pushed[0].content, /Details/);
  let items = (await res.json()).items;
  assert.equal(items.find((i) => i.refId === "t-9").origin, "attached");
  assert.equal((await route.POST(post({ kind: "task", id: "nope" }), ctx(id))).status, 404);
  tasks["t-x"] = { ...tasks["t-9"], id: "t-x", projectId: "elsewhere" };
  assert.equal((await route.POST(post({ kind: "task", id: "t-x" }), ctx(id))).status, 404, "tasks from another project can't be attached");

  const file = path.join(tmp, "notes", "brief.md");
  fs.writeFileSync(file, "---\ntitle: Brief\n---\nShip on Monday.\n");
  await recordContextItems(id, "prompt", notesPrompt(sessionNotes([note("brief", "Ship on Monday.\n", { inject: true, title: "Brief", path: file })])).items);
  fs.writeFileSync(file, "---\ntitle: Brief\n---\nShip on Tuesday.\n");
  items = (await (await route.GET(new Request("http://x"), ctx(id))).json()).items;
  const brief = items.find((i) => i.refId === "brief");
  assert.equal(brief.changedSince, true);
  let holders = (await (await holdersRoute.GET(new Request(`http://x/?path=${encodeURIComponent(file)}`))).json()).sessions;
  assert.deepEqual(holders.map((h) => [h.sessionId, h.changed]), [[id, true]]);

  pushed.length = 0;
  res = await itemRoute.POST(post({ action: "update" }), { params: Promise.resolve({ id, itemId: brief.id }) });
  assert.equal(res.status, 200);
  assert.match(pushed[0].content, /^<note_update note_id="brief" title="Brief"/);
  assert.match(pushed[0].content, /-Ship on Monday\.\n\+Ship on Tuesday\./);
  assert.equal((await res.json()).items.find((i) => i.refId === "brief").changedSince, false);
  holders = (await (await holdersRoute.GET(new Request(`http://x/?path=${encodeURIComponent(file)}`))).json()).sessions;
  assert.equal(holders[0].changed, false);
  // Nothing new to send: no second message.
  await itemRoute.POST(post({ action: "update" }), { params: Promise.resolve({ id, itemId: brief.id }) });
  assert.equal(pushed.length, 1);

  // Remove is for prompt items only; attached ones are already in the conversation.
  const attached = items.find((i) => i.refId === "t-9");
  assert.equal((await itemRoute.POST(post({ action: "remove" }), { params: Promise.resolve({ id, itemId: attached.id }) })).status, 400);
  const removed = (await (await itemRoute.POST(post({ action: "remove" }), { params: Promise.resolve({ id, itemId: brief.id }) })).json()).items.find((i) => i.refId === "brief");
  assert.ok(removed.removedAt);
  assert.equal(removed.removalPending, true);
  assert.equal((await (await itemRoute.POST(post({ action: "keep" }), { params: Promise.resolve({ id, itemId: brief.id }) })).json()).items.find((i) => i.refId === "brief").removedAt, null);
});

test("update and attachment payloads", () => {
  const update = buildNoteUpdatePayload({ noteId: "n", title: "A <b>", path: "/n.md", before: null, after: "x" });
  assert.match(update, /title="A &lt;b&gt;"/);
  assert.doesNotMatch(update, /<edits/);
  assert.match(update, /<current_note>\nx\n<\/current_note>/);
  assert.match(buildAttachmentPayload({ kind: "note", id: "n", title: "N", path: "/n.md", text: "y".repeat(50_000) }), /cut at 40,000 characters/);
});
