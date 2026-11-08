/* eslint-disable @typescript-eslint/no-require-imports -- Matches the repository's TypeScript compiler test harness. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}

const types = load("../../lib/tasks/types.ts");
test("lists every status in order, sorts positions, and collapses completed tasks", () => {
  const { TaskList } = load("task-list.tsx", {
    "@/lib/tasks/types": types,
    "./task-row": { TaskRow: ({ task }) => React.createElement("li", null, task.title) },
  });
  const tasks = [
    ["done", 0, "finished"], ["blocked", 0, "waiting"], ["open", 2, "second"],
    ["cancelled", 0, "cancelled"], ["in_progress", 0, "working"], ["open", 1, "first"],
  ].map(([status, position, title], id) => ({ id: String(id), status, position, title, createdAt: "2026-01-01" }));
  const html = renderToStaticMarkup(React.createElement(TaskList, { tasks, sessions: [] }));
  const order = ["first", "second", "working", "waiting", "finished", "cancelled"];
  for (let i = 1; i < order.length; i++) assert.ok(html.indexOf(`<li>${order[i - 1]}</li>`) < html.indexOf(`<li>${order[i]}</li>`));
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.match(html, /Done \(1\)/);
  assert.match(renderToStaticMarkup(React.createElement(TaskList, { tasks: [], emptyText: "Nothing here", sessions: [] })), /Nothing here/);
});

test("SSE is shared, refreshes on reconnect, and closes only after the last consumer", (t) => {
  const cleanups = [];
  const sources = [];
  let store;
  const previous = global.EventSource;
  global.EventSource = class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
  };
  t.after(() => { global.EventSource = previous; });
  const hooks = load("use-tasks.ts", {
    react: { useEffect: (effect) => cleanups.push(effect()), useState: () => { throw Error("Unexpected state hook"); } },
    zustand: { create: (initialize) => {
      const useStore = () => store;
      store = initialize((update) => { store = { ...store, ...update(store) }; });
      useStore.getState = () => store;
      return useStore;
    } },
    "@/lib/client/api": { api: {} },
  });
  hooks.useTasksEvents(); hooks.useTasksEvents();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "/api/tasks/events");
  sources[0].onmessage(); sources[0].onopen();
  assert.equal(store.rev, 2);
  cleanups[0](); assert.equal(sources[0].closed, false);
  cleanups[1](); assert.equal(sources[0].closed, true);
  hooks.useTasksEvents(); assert.equal(sources.length, 2);
  cleanups[2]();
});

test("town hall stays clear of farm cells across workspace layouts", () => {
  const terrain = load("../../lib/world/terrain.ts");
  const { layoutTown } = load("../../lib/world/town.ts", { "./terrain.ts": terrain });
  // Read the actual UI offset so moving the building keeps this regression check useful.
  const source = fs.readFileSync(path.resolve(__dirname, "../town/town-view.tsx"), "utf8");
  const match = source.match(/TOWN_HALL_OFFSET = \{ col: (\d+), row: (\d+) \}/);
  assert.ok(match);
  for (const count of [1, 9, 25]) {
    const workspaces = Array.from({ length: count }, (_, i) => ({ id: `w${i}`, slug: i ? `w${i}` : "main", createdAt: String(i).padStart(3, "0") }));
    const sessions = workspaces.flatMap((w) => Array.from({ length: 100 }, (_, i) => ({ id: `${w.id}s${i}`, workspaceId: w.id, createdAt: String(i).padStart(3, "0") })));
    const layout = layoutTown("tasks", workspaces, sessions);
    const hall = { col: layout.centers[0].cell.col + Number(match[1]), row: layout.centers[0].cell.row + Number(match[2]) };
    assert.ok(hall.col < layout.grid.cols && hall.row < layout.grid.rows);
    assert.ok(!Object.values(layout.farms).some((c) => c.col === hall.col && c.row === hall.row));
    assert.ok(!layout.centers.some(({ cell }) => cell.col === hall.col && cell.row === hall.row));
  }
});
