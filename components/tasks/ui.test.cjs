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
    "@/lib/agent/types": load("../../lib/agent/types.ts", { "@/lib/prompts/schema": {} }),
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

test("send menu offers live sessions in scope while the owner label still resolves past sessions", () => {
  let offered;
  const { TaskRow } = load("task-row.tsx", {
    "next/link": { __esModule: true, default: ({ children }) => React.createElement("a", null, children) },
    "lucide-react": { Trash2Icon: () => null },
    "@/components/ui/button": { Button: () => null },
    "@/lib/tasks/types": types,
    "./send-menu": { SendMenu: ({ sessions }) => { offered = sessions.map((s) => s.id); return null; } },
  });
  const sessions = [
    { id: "live-here", workspaceId: "w1", live: true, title: "Live" },
    { id: "live-elsewhere", workspaceId: "w2", live: true, title: "Other" },
    { id: "past-owner", workspaceId: "w1", live: false, title: "Finished owner" },
  ];
  const task = { id: "t", title: "Task", status: "open", priority: 0, workspaceId: "w1", sessionId: "past-owner" };
  const html = renderToStaticMarkup(React.createElement(TaskRow, { task, sessions }));
  assert.deepEqual(offered, ["live-here"]);
  assert.match(html, /Finished owner/);
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
  sources[0].onmessage({ data: JSON.stringify({ projectId: "p1" }) }); sources[0].onopen();
  assert.equal(store.rev, 2);
  // Only project p1 refetches for its event; a reconnect refetches everyone.
  assert.deepEqual(store.projects, { p1: 1 });
  assert.equal(store.all, 1);
  cleanups[0](); assert.equal(sources[0].closed, false);
  cleanups[1](); assert.equal(sources[0].closed, true);
  hooks.useTasksEvents(); assert.equal(sources.length, 2);
  cleanups[2]();
});

test("town hall stays clear of farm cells across workspace layouts", () => {
  const terrain = load("../../lib/world/terrain.ts");
  const { layoutTown } = load("../../lib/world/town.ts", { "./terrain.ts": terrain });
  for (const count of [1, 9, 25]) {
    const workspaces = Array.from({ length: count }, (_, i) => ({ id: `w${i}`, slug: i ? `w${i}` : "main", createdAt: String(i).padStart(3, "0") }));
    const sessions = workspaces.flatMap((w) => Array.from({ length: 100 }, (_, i) => ({ id: `${w.id}s${i}`, workspaceId: w.id, createdAt: String(i).padStart(3, "0") })));
    const layout = layoutTown("tasks", workspaces, sessions);
    const hall = layout.townHall;
    assert.ok(hall.col < layout.grid.cols && hall.row < layout.grid.rows);
    assert.ok(!Object.values(layout.fields).some((c) => c.col === hall.col && c.row === hall.row));
    assert.ok(!layout.farmhouses.some(({ cell }) => cell.col === hall.col && cell.row === hall.row));
  }
});

test("fallow fields keep soil and fences but have no crop pixels", () => {
  const sprites = load("../town/sprites.tsx", {
    "@/lib/world/terrain": load("../../lib/world/terrain.ts"),
    "@/components/world/pixel-parts": load("../world/pixel-parts.tsx"),
  });
  const render = (fallow) => renderToStaticMarkup(React.createElement(sprites.FarmField, { stage: 4, hue: 120, selected: false, fallow }));
  assert.match(render(false), /<rect/);
  assert.doesNotMatch(render(true), /<rect/);
  assert.match(render(true), /var\(--w-soil\)/);
  assert.match(render(true), /oklch\(0.62 0.12 120\)/);
});
