/* eslint-disable @typescript-eslint/no-require-imports -- Exercise TypeScript with the existing test loader pattern. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const { matchesNoteView, savedNoteViewsSchema } = require("../lib/notes/views.ts");
const { memoryHeadingDecorations } = require("../lib/editor/memory-heading.ts");
const { Schema } = require("@tiptap/pm/model");

const note = { id: "n1", title: "Release plan", excerpt: "Ship on Friday", tags: ["launch"], pinned: true, inject: false, actionable: true, openTasks: 2 };
test("filters combine search and flags, including tags and actionable tasks", () => {
  assert.equal(matchesNoteView(note, " LAUNCH ", "pinned"), true);
  assert.equal(matchesNoteView(note, "Friday", "tasks"), true);
  assert.equal(matchesNoteView(note, "missing", "pinned"), false);
  assert.equal(matchesNoteView(note, "", "inject"), false);
  assert.equal(matchesNoteView({ ...note, actionable: false }, "", "tasks"), false);
  assert.equal(matchesNoteView({ ...note, openTasks: 0 }, "", "tasks"), false);
  assert.equal(matchesNoteView({ ...note, id: "memory" }, "", "memory"), true);
  assert.equal(matchesNoteView(note, "", "memory"), false);
});
test("saved views round-trip and reject malformed browser data", () => {
  const views = [{ name: "Launch tasks", query: "launch", filter: "tasks" }];
  assert.deepEqual(savedNoteViewsSchema.parse(JSON.parse(JSON.stringify(views))), views);
  for (const value of [null, {}, [{ name: "", query: "", filter: "all" }], [{ name: "Bad", query: "", filter: "unknown" }]]) {
    assert.equal(savedNoteViewsSchema.safeParse(value).success, false);
  }
});
test("memory headings separate context and title without mutating document content", () => {
  const schema = new Schema({ nodes: { doc: { content: "block+" }, text: {}, heading: { content: "text*", group: "block", attrs: { level: { default: 1 } } } } });
  for (const text of ["checkly-marketing-website/main — workspace memory", "Project — project memory"]) {
    const doc = schema.node("doc", null, [schema.node("heading", null, [schema.text(text)])]);
    const before = doc.toJSON();
    const decorations = memoryHeadingDecorations(doc).find();
    assert.equal(decorations.length, 3);
    assert.equal(doc.textBetween(decorations[1].from, decorations[1].to), " — ");
    assert.match(doc.textBetween(decorations[2].from, decorations[2].to), /^(workspace|project) memory$/);
    assert.deepEqual(doc.toJSON(), before);
  }
  const custom = schema.node("doc", null, [schema.node("heading", null, [schema.text("My custom memory heading")])]);
  assert.equal(memoryHeadingDecorations(custom).find().length, 0);
});
