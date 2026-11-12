/* eslint-disable @typescript-eslint/no-require-imports */
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

const resizable = load("../components/ui/resizable.tsx");
test("both panel layouts render on the server without localStorage", () => {
  assert.equal(typeof window, "undefined");
  const { ShellPanels } = load("../components/layout/shell-panels.tsx", {
    "@/components/ui/resizable": resizable,
  });
  const { WorkspaceShell } = load("../components/workspace/workspace-shell.tsx", {
    "@/components/ui/resizable": resizable,
    "next/navigation": { useParams: () => ({}) },
    "@/components/comments/comments-panel": { CommentsPanel: () => null },
    "@/lib/store/ui-store": { useUi: () => false },
    "./workspace-console": { WorkspaceConsole: () => null },
    "./workspace-panel": { WorkspacePanel: () => null },
    "./route-context": { WorkspaceBaseProvider: ({ children }) => children },
  });
  for (const component of [ShellPanels, WorkspaceShell]) {
    assert.match(renderToStaticMarkup(React.createElement(component, { children: "Panel content" })), /Panel content/);
  }
});

test("layout storage preserves browser values and tolerates unavailable reads", (t) => {
  const storage = resizable.panelLayoutStorage;
  assert.equal(storage.getItem("layout"), null);
  assert.doesNotThrow(() => storage.setItem("layout", "server"));
  const values = new Map();
  t.after(() => { delete globalThis.window; });
  globalThis.window = {
    localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
  };
  storage.setItem("layout", '{"sidebar":20,"content":80}');
  assert.equal(storage.getItem("layout"), '{"sidebar":20,"content":80}');
  Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  assert.equal(storage.getItem("layout"), null);
});
