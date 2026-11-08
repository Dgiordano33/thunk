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
