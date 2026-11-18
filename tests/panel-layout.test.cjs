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

const panelLayout = load("../lib/panel-layout.ts");
const resizable = load("../components/ui/resizable.tsx", { "@/lib/panel-layout": panelLayout });
test("both panel layouts render on the server without a browser", () => {
  assert.equal(typeof window, "undefined");
  const { ShellPanels } = load("../components/layout/shell-panels.tsx", {
    "@/components/ui/resizable": resizable,
    "@/components/mobile/viewport": load("../components/mobile/viewport.tsx"),
    "@/components/mobile/drawer": { MobileDrawer: () => null },
  });
  const { WorkspaceShell } = load("../components/workspace/workspace-shell.tsx", {
    "@/components/ui/resizable": resizable,
    "@/components/mobile/viewport": load("../components/mobile/viewport.tsx"),
    "@/components/mobile/drawer": { MobileDrawer: () => null },
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

test("layouts are kept in cookies, read from the request on the server and document.cookie in the browser", (t) => {
  const key = "react-resizable-panels:thunk-sidebar-layout";
  const name = panelLayout.panelCookieName(key);
  assert.equal(name, "react-resizable-panels_thunk-sidebar-layout");
  assert.ok(name.startsWith(panelLayout.PANEL_COOKIE_PREFIX));
  const saved = '{"sidebar,content":{"layout":[20,80]}}';

  // Server render: only the request's cookies; writing is a no-op.
  const server = resizable.panelLayoutStorage({ [name]: saved });
  assert.equal(server.getItem(key), saved);
  assert.equal(resizable.panelLayoutStorage().getItem(key), null);
  assert.doesNotThrow(() => server.setItem(key, saved));
  assert.deepEqual(panelLayout.panelCookies([{ name, value: saved }, { name: "other", value: "x" }]), { [name]: saved });

  // Browser: a write is a cookie the next request carries; a read finds it again.
  let jar = "theme=dark";
  globalThis.document = { get cookie() { return jar; }, set cookie(c) { const [pair] = c.split(";"); jar = `${jar}; ${pair}`; } };
  t.after(() => { delete globalThis.document; });
  const browser = resizable.panelLayoutStorage();
  assert.equal(browser.getItem(key), null);
  browser.setItem(key, saved);
  assert.match(jar, new RegExp(`${name}=`));
  assert.equal(browser.getItem(key), saved);
  jar = `${name}=%E0%A4%A`;
  assert.equal(browser.getItem(key), null);
});

test("viewport server snapshot mounts only the matching tree", () => {
  const { ViewportProvider, ResponsiveView } = load("../components/mobile/viewport.tsx");
  for (const desktop of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(ViewportProvider, { initialDesktop: desktop },
      React.createElement(ResponsiveView, { mobile: "Mobile list" }, "Desktop map")));
    assert.equal(html, desktop ? "Desktop map" : "Mobile list");
  }
});
