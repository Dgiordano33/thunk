/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's loader. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");
const base = syncFs.mkdtempSync(path.join(os.tmpdir(), "thunk-repo-notebooks-"));
process.env.THUNK_DATA_DIR = path.join(base, "data");
after(() => fs.rm(base, { recursive: true, force: true }));
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(syncFs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/agent") return { getSession: () => null };
  if (request === "server-only") return {};
  if (request === "../server") return { db: () => null };
  if (request === "@/lib/projects") return { getWorkspaceContext: async () => null };
  return load.call(this, request, parent, isMain);
};
const projects = require("../lib/supabase/repo/projects.ts");
const repos = require("../lib/supabase/repo/project-repos.ts");
const folders = require("../lib/supabase/repo/repo-folders.ts");
const resolution = require("../lib/notes/resolve.ts");
const discovery = require("../lib/notes/folders.ts");
const store = require("../lib/notes/store.ts");
const service = require("../lib/tasks/service.ts");
const tasks = require("../lib/supabase/repo/tasks.ts");
const routes = require("../lib/notes/routes.ts");
const registration = require("../app/api/projects/[id]/repo-folders/route.ts");
const removal = require("../app/api/projects/[id]/repo-folders/[folderId]/route.ts");
const watcher = require("../lib/notes/watch.ts");
const prompts = require("../lib/notes/prompt.ts");
const req = (method, body) => new Request("http://localhost/api/notes", { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
const ctx = (params) => ({ params: Promise.resolve(params) });
async function fixture() {
  const root = await fs.mkdtemp(path.join(base, "repo-"));
  await fs.mkdir(path.join(root, "docs"));
  await fs.writeFile(path.join(root, "docs", "board.md"), "# Board\n- [ ] ship\n- [ ] ship\n");
  const project = await projects.upsertProject({ root, name: "Repo", kind: "repo", remote: null, defaultBranch: "main" });
  return { root, project };
}

test("registration, discovery, path containment, note routes and unregister preserve files", async () => {
  const { root, project } = await fixture();
  assert.equal((await discovery.suggestRepoFolders(project))[0].count, 1);
  for (const p of ["../escape", "/tmp", "docs/../docs", ".git", "docs//sub", "docs\\sub"]) {
    assert.equal((await registration.POST(req("POST", { path: p }), ctx({ id: project.id }))).status, 400);
  }
  await fs.symlink(base, path.join(root, "escape"));
  assert.equal((await registration.POST(req("POST", { path: "escape" }), ctx({ id: project.id }))).status, 400);
  assert.equal((await registration.POST(req("POST", { path: "missing" }), ctx({ id: project.id }))).status, 404);
  assert.equal((await registration.POST(req("POST", { path: "docs", repoId: crypto.randomUUID() }), ctx({ id: project.id }))).status, 404);
  const response = await registration.POST(req("POST", { path: "docs" }), ctx({ id: project.id }));
  assert.equal(response.status, 200);
  const { folder } = await response.json();
  const collection = routes.notesCollection("repos");
  const item = routes.noteItem("repos");
  const listing = await (await collection.GET(req("GET"), ctx({ id: folder.id }))).json();
  assert.deepEqual(listing.notes.map((n) => n.title), ["Board"]);
  const note = listing.notes[0];
  assert.equal((await item.PATCH(req("PATCH", { markdown: "# Edited\n", expectedUpdatedAt: note.updatedAt }), ctx({ id: folder.id, noteId: "board" }))).status, 200);
  assert.equal(await fs.readFile(note.path, "utf8"), "# Edited\n");
  assert.equal((await collection.POST(req("POST", { id: "board", title: "collision" }), ctx({ id: folder.id }))).status, 409);
  assert.equal((await removal.DELETE(req("DELETE"), ctx({ id: project.id, folderId: folder.id }))).status, 200);
  assert.equal(await fs.readFile(note.path, "utf8"), "# Edited\n");
  await assert.rejects(resolution.dirsForScope({ kind: "repos", id: folder.id }), /not found/);
});

test("declared notebooks, extra repo notebooks and session prompts use main checkouts", async () => {
  const { root, project } = await fixture();
  await fs.writeFile(path.join(root, "thunk.json"), JSON.stringify({ notebooks: ["docs"] }));
  const extra = await fixture();
  const repo = await repos.insertProjectRepo({ projectId: project.id, name: "extra", path: extra.root, remote: null, defaultBranch: "main" });
  await folders.insertRepoFolder({ projectId: project.id, repoId: repo.id, path: "docs", label: "Extra plans" });
  // Getters are pure: thunk.json is only read when the project is reconciled.
  assert.equal((await projects.getProject(project.id)).repoFolders.length, 1);
  const before = await projects.getProject(project.id);
  const [loaded, concurrent] = await Promise.all([discovery.reconcileDeclaredFolders(before), discovery.reconcileDeclaredFolders(before)]);
  assert.equal(concurrent.repoFolders.length, 2);
  assert.equal(loaded.repoFolders.length, 2);
  assert.equal((await projects.getProject(project.id)).repoFolders.length, 2);
  const notes = await prompts.loadSessionNotes(loaded, { id: "workspace", slug: "feature", cwd: "/unused-worktree" });
  assert.equal(notes.repos.length, 2);
  assert.equal(notes.repos.filter((r) => r.extra).length, 1);
  assert.match(prompts.notesPrompt(notes), /main checkout/);
  assert.match(prompts.notesPrompt(notes), /Board/);
  const extraFolder = loaded.repoFolders.find((f) => f.repoId === repo.id);
  assert.equal((await resolution.dirsForScope({ kind: "repos", id: extraFolder.id })).scope.id, extraFolder.id);
  await repos.deleteProjectRepo(repo.id);
  assert.equal((await projects.getProject(project.id)).repoFolders.length, 1);
  // The lookup goes straight to the folder row, but a folder whose repo left the project is still gone.
  await assert.rejects(resolution.dirsForScope({ kind: "repos", id: extraFolder.id }), { status: 404 });
  await assert.rejects(resolution.dirsForScope({ kind: "repos", id: crypto.randomUUID() }), { status: 404 });
});

test("imports distinguish identical filenames and duplicate items; completion and reopen only change checkboxes", async (t) => {
  const { root, project } = await fixture();
  await fs.mkdir(path.join(root, "plans"));
  await fs.writeFile(path.join(root, "plans", "board.md"), "# Second\n- [ ] ship\n");
  for (const p of ["docs", "plans"]) await folders.insertRepoFolder({ projectId: project.id, repoId: null, path: p, label: p });
  assert.equal(await service.importNoteTasks({ projectId: project.id }), 3);
  assert.equal(await service.importNoteTasks({ projectId: project.id }), 0);
  const imported = await tasks.listTasks({ projectId: project.id });
  const task = imported[0];
  const loaded = await projects.getProject(project.id);
  const folder = loaded.repoFolders.find((f) => task.noteId.includes(f.id));
  const file = path.join(root, folder.path, "board.md");
  const before = await fs.readFile(file, "utf8");
  await fs.writeFile(file, "Moved heading\n" + before);
  await service.patchTask(task.id, { status: "done" });
  assert.equal(await fs.readFile(file, "utf8"), "Moved heading\n" + before.replace("[ ]", "[x]"));
  assert.equal(await service.importNoteTasks({ projectId: project.id }), 0);
  await service.patchTask(task.id, { status: "open" });
  assert.equal(await fs.readFile(file, "utf8"), "Moved heading\n" + before);
  const logs = t.mock.method(console, "error", () => {});
  await fs.writeFile(file, "# Board removed\n");
  await service.patchTask(task.id, { status: "done" });
  assert.equal(logs.mock.callCount(), 1);
  assert.equal((await tasks.getTask(task.id)).status, "done");
  assert.equal(await fs.readFile(file, "utf8"), "# Board removed\n");
});

test("repo watcher debounces a folder burst and reports external edits", async (t) => {
  const { root, project } = await fixture();
  const folder = await folders.insertRepoFolder({ projectId: project.id, repoId: null, path: "docs", label: "Docs" });
  const events = [];
  const waitForEvents = async (count) => {
    const deadline = Date.now() + 5000;
    while (events.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => setTimeout(resolve, 350));
  };
  const unsubscribe = watcher.subscribeNotes((e) => { if (e.scope.id === folder.id) events.push(e); });
  t.after(unsubscribe);
  await watcher.refreshFolders();
  events.length = 0;
  const file = path.join(root, "docs", "board.md");
  await fs.appendFile(file, "first\n");
  await fs.appendFile(file, "second\n");
  await waitForEvents(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].noteId, "*");
  assert.equal(events[0].kind, "changed");
  await fs.rm(file);
  await waitForEvents(2);
  assert.equal(events.length, 2);
  assert.deepEqual(await store.listNotes(await resolution.repoNoteDirs(project, folder)), []);
});
