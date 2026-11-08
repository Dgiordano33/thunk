/* eslint-disable @typescript-eslint/no-require-imports -- The compiler hook exercises server TypeScript through Node’s CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = require("node:fs").readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
};
const fm = require("../lib/notes/frontmatter.ts");
const store = require("../lib/notes/store.ts");

async function dirs(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "thunk-notes-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { scope: { kind: "projects", id: "p1" }, notesDir: path.join(base, "notes"), memoryFile: path.join(base, "memory", "MEMORY.md"), memoryTitle: "Project memory" };
}

test("frontmatter round trip keeps flags, tags and body", () => {
  const body = "# Auth\n\n- [ ] one\n- [x] two\n";
  const raw = fm.serializeNote({ title: "Auth: decisions", pinned: true, inject: false, actionable: true, tags: ["auth", "two words"], created: "2026-11-07T15:00:00.000Z", updated: null }, body);
  const parsed = fm.parseNote(raw);
  assert.equal(parsed.frontmatter.title, "Auth: decisions");
  assert.equal(parsed.frontmatter.pinned, true);
  assert.equal(parsed.frontmatter.actionable, true);
  assert.deepEqual(parsed.frontmatter.tags, ["auth", "two words"]);
  assert.equal(parsed.frontmatter.created, "2026-11-07T15:00:00.000Z");
  assert.equal(parsed.body, body);
});

test("tolerates missing and garbled frontmatter", () => {
  const plain = fm.parseNote("# Heading only\ntext");
  assert.equal(plain.frontmatter.inject, false);
  assert.equal(fm.noteTitle(plain, "abc"), "Heading only");
  assert.equal(fm.noteTitle(fm.parseNote("just text"), "abc"), "abc");
  const garbled = fm.parseNote("---\ntitle: \"Hi\"\npinned: maybe\n: nope\ncreated: not-a-date\ntags:\n  - a\n  - b\ninject: yes # comment\n---\nbody");
  assert.equal(garbled.frontmatter.title, "Hi");
  assert.equal(garbled.frontmatter.pinned, false);
  assert.equal(garbled.frontmatter.inject, true);
  assert.equal(garbled.frontmatter.created, null);
  assert.deepEqual(garbled.frontmatter.tags, ["a", "b"]);
  assert.equal(garbled.body, "body");
  // An unterminated fence is body, not frontmatter.
  assert.equal(fm.parseNote("---\ntitle: x\nno close").body, "---\ntitle: x\nno close");
});

test("task extraction skips code fences and toggles by line", () => {
  const body = "- [ ] open\n  * [X] done nested\n```\n- [ ] in code\n```\n- not a task\n1. [ ] numbered isn't\n";
  const tasks = fm.extractTasks(body);
  assert.deepEqual(tasks.map((t) => [t.line, t.text, t.done]), [[0, "open", false], [1, "done nested", true]]);
  assert.equal(fm.setTaskDone(body, 0, true).split("\n")[0], "- [x] open");
  assert.equal(fm.setTaskDone(body, 1, false).split("\n")[1], "  * [ ] done nested");
  assert.equal(fm.setTaskDone(body, 5, true), body);
  assert.equal(fm.setTaskDone("- [ ]  keep spacing\r\n", 0, true), "- [x]  keep spacing\r\n");
});

test("store creates, lists, patches and deletes notes; memory is a virtual pinned note", async (t) => {
  const d = await dirs(t);
  let notes = await store.listNotes(d);
  assert.deepEqual(notes.map((n) => n.id), ["memory"]);
  assert.equal(notes[0].pinned, true);
  assert.equal(notes[0].inject, true);

  const a = await store.createNote(d, { title: "First", markdown: "hello\n- [ ] do it\n" });
  assert.match(a.id, /^[a-z0-9]{10}$/);
  assert.equal(a.openTasks, 1);
  const raw = await fs.readFile(path.join(d.notesDir, `${a.id}.md`), "utf8");
  assert.match(raw, /^---\ntitle: First\n/);

  const b = await store.writeNote(d, a.id, { actionable: true, pinned: true, markdown: "- [x] do it\n- [ ] next\n" });
  assert.equal(b.actionable, true);
  assert.equal(b.title, "First");
  assert.equal(b.openTasks, 1);
  assert.equal(b.doneTasks, 1);
  assert.deepEqual(store.tasksOf([b]).map((x) => x.text), ["next"]);

  await store.writeNote(d, "memory", { markdown: "# Mem\nfact\n" });
  assert.equal(await fs.readFile(d.memoryFile, "utf8"), "# Mem\nfact\n");

  // An agent drops a hand-written file in the folder.
  await fs.writeFile(path.join(d.notesDir, "handmade.md"), "# By agent\nstuff");
  notes = await store.listNotes(d);
  assert.deepEqual(notes.map((n) => n.id).slice(0, 2), ["memory", a.id]);
  assert.equal(notes.find((n) => n.id === "handmade").title, "By agent");

  await store.deleteNote(d, a.id);
  assert.equal(await store.readNote(d, a.id), null);
  await assert.rejects(store.deleteNote(d, "memory"));
  assert.equal(store.isNoteId("../etc"), false);
  await assert.rejects(store.readNote(d, "../etc"), /Invalid note id/);
});

test("task patches preserve agent edits, follow a moved task and reject missing text", async (t) => {
  const d = await dirs(t);
  const note = await store.createNote(d, { markdown: "- [ ] do it\n", actionable: true });
  const file = path.join(d.notesDir, note.id + ".md");
  await fs.appendFile(file, "\nAgent addition\n");
  const updated = await store.writeNote(d, note.id, { task: { line: 0, text: "do it", done: true } });
  assert.equal(updated.markdown, "- [x] do it\n\nAgent addition\n");
  await store.writeNote(d, note.id, { markdown: "New heading\n- [ ] do it\n" });
  await store.writeNote(d, note.id, { task: { line: 0, text: "do it", done: true } });
  const before = await fs.readFile(file, "utf8");
  await assert.rejects(store.writeNote(d, note.id, { task: { line: 0, text: "missing", done: true } }), store.NoteConflictError);
  assert.equal(await fs.readFile(file, "utf8"), before);
});

test("counts match listings without reading note bodies or double counting memory", async (t) => {
  const d = await dirs(t);
  assert.equal(await store.countNotes([d]), 1);
  await store.createNote(d, { title: "One" });
  await fs.writeFile(path.join(d.notesDir, "memory.md"), "ignored");
  await fs.writeFile(path.join(d.notesDir, "bad name.md"), "ignored");
  await fs.writeFile(path.join(d.notesDir, "scratch.tmp"), "ignored");
  assert.equal(await store.countNotes([d]), (await store.listNotes(d)).length);
});

test("watcher retries with backoff for existing subscribers and cancels on unsubscribe", () => {
  const { EventEmitter } = require("node:events");
  const timers = new Map();
  let timerId = 0;
  let attempts = 0;
  let watcher;
  const fakeFs = {
    existsSync: () => true,
    mkdirSync: () => {},
    watch: () => {
      attempts++;
      if (attempts === 2) throw new Error("temporarily unavailable");
      watcher = new EventEmitter();
      watcher.close = () => {};
      return watcher;
    },
  };
  const source = require("node:fs").readFileSync(path.join(__dirname, "../lib/notes/watch.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const sandboxModule = { exports: {} };
  const load = (id) => {
    if (id === "server-only") return {};
    if (id === "node:fs") return fakeFs;
    if (id === "@/lib/projects/paths") return { DATA_DIR: "/tmp/watch-test", projectSlug: (s) => s };
    if (id === "@/lib/supabase/repo/projects") return { listProjects: async () => [] };
    if (id === "@/lib/supabase/repo/workspaces") return { listAllWorkspaces: async () => [] };
    if (id === "./resolve") return {};
    if (id === "./types") return { MEMORY_NOTE_ID: "memory" };
    return require(id);
  };
  const fakeTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
  new Function("require", "module", "exports", "globalThis", "setTimeout", "clearTimeout", "console", compiled)(
    load, sandboxModule, sandboxModule.exports, {}, fakeTimeout, (id) => timers.delete(id), { error: () => {} },
  );
  const runRetry = (delay) => {
    const [id, timer] = [...timers].find(([, t]) => t.delay === delay);
    timers.delete(id);
    timer.fn();
  };
  const unsubscribe = sandboxModule.exports.subscribeNotes(() => {});
  assert.equal(attempts, 1);
  watcher.emit("error", new Error("watch failed"));
  runRetry(1000);
  assert.equal(attempts, 2);
  runRetry(2000);
  assert.equal(attempts, 3);
  watcher.emit("error", new Error("watch failed again"));
  assert.ok([...timers.values()].some((t) => t.delay === 4000));
  unsubscribe();
  assert.equal(timers.size, 0);
});


test("repo notes preserve plain files and unknown YAML, require filenames and refuse overwrite", async (t) => {
  const base = await dirs(t);
  await fs.mkdir(base.notesDir);
  const d = { scope: { kind: "repos", id: "r1" }, notesDir: base.notesDir };
  assert.equal(await store.readNote(d, "memory"), null);
  assert.equal(await store.writeNote(d, "memory", { markdown: "no" }), null);
  assert.equal(await store.countNotes([d]), 0);
  await assert.rejects(store.createNote(d, { title: "No filename" }), /filename/);
  const note = await store.createNote(d, { id: "plan", title: "Plan" });
  assert.equal(note.source, "repo");
  await assert.rejects(store.createNote(d, { id: "plan", title: "Overwrite" }), /EEXIST/);
  const file = path.join(d.notesDir, "plan.md");
  const plain = "# Plan\n\n- [ ] ship\n";
  await fs.writeFile(file, plain);
  await store.writeNote(d, "plan", { task: { line: 2, text: "ship", done: true } });
  assert.equal(await fs.readFile(file, "utf8"), plain.replace("[ ]", "[x]"));
  const header = "---\r\nowner: Dan\r\ncustom:\r\n  nested: keep\r\n# comment\r\npinned: false\r\n---\r\n";
  await fs.writeFile(file, header + plain);
  await store.writeNote(d, "plan", { markdown: plain + "more\n" });
  assert.equal(await fs.readFile(file, "utf8"), header + plain + "more\n");
  await store.writeNote(d, "plan", { pinned: true });
  assert.equal(await fs.readFile(file, "utf8"), header.replace("pinned: false", "pinned: true") + plain + "more\n");
  assert.equal(await store.countNotes([d]), 1);
  assert.equal((await store.listNotes(d)).length, 1);
  await fs.writeFile(file, plain);
  await store.writeNote(d, "plan", { inject: true });
  assert.equal(await fs.readFile(file, "utf8"), "---\ninject: true\n---\n" + plain);
});

test("repo notes reject symlinks and stale writes", async (t) => {
  const base = await dirs(t);
  await fs.mkdir(base.notesDir);
  const d = { scope: { kind: "repos", id: "r1" }, notesDir: base.notesDir };
  const external = path.join(path.dirname(d.notesDir), "external.md");
  await fs.writeFile(external, "secret");
  await fs.symlink(external, path.join(d.notesDir, "link.md"));
  await assert.rejects(store.readNote(d, "link"), /regular file/);
  await assert.rejects(store.writeNote(d, "link", { markdown: "overwrite" }), /regular file/);
  const note = await store.createNote(d, { id: "safe", title: "Safe" });
  await fs.utimes(note.path, new Date(0), new Date(0));
  await assert.rejects(store.writeNote(d, "safe", { markdown: "stale", expectedUpdatedAt: note.updatedAt }), store.NoteConflictError);
  assert.equal(await fs.readFile(external, "utf8"), "secret");
});
