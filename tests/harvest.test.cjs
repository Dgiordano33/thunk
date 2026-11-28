/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mkdtempSync, realpathSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/agent") return { listLiveSessions: () => [], closeSession: () => {} };
  if (request === "@/lib/projects") return require("../lib/projects/index.ts");
  if (request === "../server") return { db: () => null }; // Memory mode: never connect to a configured database.
  return load.call(this, request, parent, isMain);
};

// realpath: macOS tmpdir is a symlink (/var -> /private/var), and added repos are stored resolved.
const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "thunk-harvest-")));
process.env.THUNK_DATA_DIR = path.join(base, "data");
const projects = require("../lib/projects/index.ts");

test.after(() => fs.rm(base, { recursive: true, force: true }));


const paths = require("../lib/projects/paths.ts");
const { moveToGranary } = require("../lib/projects/granary.ts");
const { harvestWorkspace, readHarvest } = require("../lib/projects/harvest.ts");
const { workspaceNoteDirs, projectNoteDirs } = require("../lib/notes/resolve.ts");
const { createNote, readNote, listNotes, writeNote } = require("../lib/notes/store.ts");
const { insertTask, getTask } = require("../lib/db/repo/tasks.ts");
const { hierarchyPrompt, buildOptions } = require("../lib/agent/options.ts");

async function context(name) {
  const root = path.join(base, name);
  await fs.mkdir(root);
  const project = await projects.addProject(root);
  const workspace = await projects.createWorkspace({ projectId: project.id, name: "farm", worktree: false, setup: "skip" });
  return { project, workspace };
}

test("delete preserves populated memory, notes and topics; trivial logs leave no granary", async () => {
  const ctx = await context("preserve");
  const file = paths.workspaceMemoryFile(ctx.project.dataKey, ctx.workspace.slug);
  await fs.writeFile(file, "# Task log\nA durable lesson\n");
  const note = await createNote(workspaceNoteDirs(ctx.project, ctx.workspace), { title: "Keep", markdown: "facts" });
  await projects.removeWorkspace(ctx.workspace.id);
  const entries = await fs.readdir(paths.projectGranaryDir(ctx.project.dataKey));
  assert.equal(entries.length, 1);
  const saved = path.join(paths.projectGranaryDir(ctx.project.dataKey), entries[0]);
  assert.match(await fs.readFile(path.join(saved, "memory/MEMORY.md"), "utf8"), /durable lesson/);
  assert.equal((await readNote(projectNoteDirs(ctx.project), note.id)).markdown, "facts");
  assert.equal(note.scope.kind, "projects");
  assert.equal(await projects.getWorkspaceContext(ctx.workspace.id), null);
  const empty = await context("empty");
  assert.equal((await readHarvest(empty)).empty, true);
  await projects.removeWorkspace(empty.workspace.id);
  await assert.rejects(fs.stat(paths.projectGranaryDir(empty.project.dataKey)), { code: "ENOENT" });
  const topic = await context("topic");
  await fs.writeFile(path.join(paths.workspaceMemoryDir(topic.project.dataKey, topic.workspace.slug), "topic.md"), "keep me");
  assert.ok(await moveToGranary(topic.project.dataKey, topic.workspace.slug));
});

test("harvest appends dated memory, preserves note IDs and moves task links to project scope", async () => {
  const ctx = await context("harvest");
  const source = workspaceNoteDirs(ctx.project, ctx.workspace), target = projectNoteDirs(ctx.project);
  const note = await createNote(source, { title: "Lesson", markdown: "- [ ] follow up", pinned: true });
  const task = await insertTask({ projectId: ctx.project.id, workspaceId: ctx.workspace.id, title: "follow up", noteId: note.id });
  const result = await harvestWorkspace(ctx, { memory: "Use transactions.", noteIds: [note.id] });
  assert.deepEqual(result.notes, [{ from: note.id, to: note.id }]);
  assert.equal(await readNote(source, note.id), null);
  assert.equal((await readNote(target, note.id)).pinned, true);
  assert.equal((await getTask(task.id)).workspaceId, null);
  assert.equal((await getTask(task.id)).noteId, note.id);
  assert.match(await fs.readFile(target.memoryFile, "utf8"), /## Harvested from farm · \d{4}-\d{2}-\d{2}\n\nUse transactions/);
  await projects.removeWorkspace(ctx.workspace.id);
  assert.ok(await getTask(task.id));
});

test("legacy migration preserves colliding IDs, unknown metadata, and task references", async () => {
  const ctx = await context("collision");
  const source = paths.workspaceNotesDir(ctx.project.dataKey, ctx.workspace.slug), target = projectNoteDirs(ctx.project);
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(target.notesDir, { recursive: true });
  await fs.writeFile(path.join(source, "same.md"), "---\ncustom: keep\n---\nsource");
  await fs.writeFile(path.join(target.notesDir, "same.md"), "destination");
  const task = await insertTask({ projectId: ctx.project.id, workspaceId: ctx.workspace.id, title: "linked", noteId: "same" });
  const other = await insertTask({ projectId: ctx.project.id, title: "existing", noteId: "same" });
  const notes = await listNotes(target);
  const migrated = notes.find((n) => n.markdown === "source");
  assert.ok(migrated);
  assert.notEqual(migrated.id, "same");
  assert.deepEqual(migrated.workspaceIds, [ctx.workspace.id]);
  assert.equal((await readNote(target, "same")).markdown, "destination");
  assert.match(await fs.readFile(migrated.path, "utf8"), /custom: keep/);
  assert.equal((await getTask(task.id)).noteId, migrated.id);
  assert.equal((await getTask(other.id)).noteId, "same");
  assert.equal((await readNote(workspaceNoteDirs(ctx.project, ctx.workspace), "same")).id, migrated.id);
  assert.equal((await listNotes(target)).length, notes.length);
  assert.deepEqual(await fs.readdir(source), []);
  assert.equal((await listNotes(workspaceNoteDirs(ctx.project, ctx.workspace))).length, 1);
});

test("project notes can link to multiple workspaces and survive archive and removal", async () => {
  const ctx = await context("links");
  const second = await projects.createWorkspace({ projectId: ctx.project.id, name: "second", worktree: false, setup: "skip" });
  const target = projectNoteDirs(ctx.project);
  const note = await createNote(target, { title: "Shared plan", workspaceIds: [ctx.workspace.id, second.id] });
  assert.equal((await listNotes(workspaceNoteDirs(ctx.project, ctx.workspace))).length, 1);
  assert.equal((await listNotes(workspaceNoteDirs(ctx.project, second))).length, 1);
  await writeNote(target, note.id, { workspaceIds: [second.id] });
  assert.equal((await listNotes(workspaceNoteDirs(ctx.project, ctx.workspace))).length, 0);
  assert.ok(await readNote(target, note.id));
  await require("../lib/projects/archive.ts").archiveWorkspace(second.id);
  assert.ok(await readNote(target, note.id));
  await projects.removeWorkspace(second.id);
  assert.ok(await readNote(target, note.id));
});


test("Claude uses project auto-memory; Codex still gets injected project memory", async () => {
  const ctx = await context("options");
  const live = { ctx, meta: { model: "claude-sonnet-4-6", permissionMode: "default" }, id: "test" };
  const options = await buildOptions(live, {});
  assert.equal(options.settings.autoMemoryDirectory, paths.projectMemoryDir(ctx.project.dataKey));
  assert.ok(options.additionalDirectories.includes(paths.workspaceMemoryDir(ctx.project.dataKey, ctx.workspace.slug)));
  assert.doesNotMatch(hierarchyPrompt(live, "unique fact", "claude").text, /unique fact/);
  assert.match(hierarchyPrompt(live, "unique fact", "codex").text, /unique fact/);
});

test("a header-only log needs no harvest because notes already belong to the project", async () => {
  const ctx = await context("header-only");
  await createNote(workspaceNoteDirs(ctx.project, ctx.workspace), { title: "Keep", markdown: "facts" });
  const data = await readHarvest(ctx);
  assert.equal(data.empty, true);
  assert.deepEqual(data.notes, []);
  assert.equal(data.suggested, "");
});

test("harvesting again suggests only new lines and never appends the same text twice", async () => {
  const ctx = await context("repeat");
  const log = paths.workspaceMemoryFile(ctx.project.dataKey, ctx.workspace.slug), target = projectNoteDirs(ctx.project).memoryFile;
  await fs.appendFile(log, "\nFirst lesson\n");
  const first = await readHarvest(ctx);
  assert.match(first.suggested, /First lesson/);
  await harvestWorkspace(ctx, { memory: first.suggested, noteIds: [] });
  assert.equal((await readHarvest(ctx)).suggested, "");
  const once = await fs.readFile(target, "utf8");
  await harvestWorkspace(ctx, { memory: first.suggested, noteIds: [] });
  assert.equal(await fs.readFile(target, "utf8"), once);
  await fs.appendFile(log, "\nSecond lesson\n");
  assert.equal((await readHarvest(ctx)).suggested, "Second lesson");
});

test("Claude gets project memory injected once it outgrows the auto-memory limit", async () => {
  const ctx = await context("oversized");
  const live = { ctx, meta: { model: "claude-sonnet-4-6", permissionMode: "default" }, id: "test" };
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  assert.doesNotMatch(hierarchyPrompt(live, lines(200), "claude").text, /line 199/);
  assert.match(hierarchyPrompt(live, lines(201), "claude").text, /line 200/);
  assert.match(hierarchyPrompt(live, `tail fact ${"x".repeat(25_000)}`, "claude").text, /tail fact/);
});

test("note routes reject cross-project links and create canonical notes from workspace views", async () => {
  const ctx = await context("note-routes");
  const other = await context("other-project");
  const { notesCollection, noteItem } = require("../lib/notes/routes.ts");
  const body = (data) => new Request("http://localhost/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const response = await notesCollection("workspaces").POST(body({ title: "Linked" }), { params: Promise.resolve({ id: ctx.workspace.id }) });
  assert.equal(response.status, 200);
  const { note } = await response.json();
  assert.deepEqual(note.scope, { kind: "projects", id: ctx.project.id });
  assert.deepEqual(note.workspaceIds, [ctx.workspace.id]);
  const denied = await noteItem("projects").PATCH(body({ workspaceIds: [other.workspace.id] }), { params: Promise.resolve({ id: ctx.project.id, noteId: note.id }) });
  assert.equal(denied.status, 400);
  assert.deepEqual((await readNote(projectNoteDirs(ctx.project), note.id)).workspaceIds, [ctx.workspace.id]);
});
