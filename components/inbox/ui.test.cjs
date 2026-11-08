/* eslint-disable @typescript-eslint/no-require-imports -- Render UI states with the installed TypeScript compiler. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "../..");
let state, query = "";
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (name, ...rest) {
  if (name.startsWith("@/")) {
    const base = path.join(root, name.slice(2));
    name = [base + ".ts", base + ".tsx", base + "/index.ts"].find(fs.existsSync) || base;
  }
  return originalResolve.call(this, name, ...rest);
};
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
Module._load = function (name, ...rest) {
  if (name === "@/lib/store/notifications-store") return { useNotifications: (select) => select(state), useNotificationsEvents() {}, refreshNotifications() {} };
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(query) };
  return originalLoad.call(this, name, ...rest);
};
const { Inbox } = require("./inbox.tsx");
Module._load = originalLoad;
const projects = [{ id: "thunk", name: "Thunk", workspaces: [{ id: "inbox", name: "notifications" }] }, { id: "docs", name: "Documentation", workspaces: [{ id: "main", name: "main" }] }];
const base = { projectId: "thunk", workspaceId: "inbox", sessionId: null, runId: null, subjectKey: "preview", href: "/", detail: null, actions: [], readAt: null, resolvedAt: null, createdAt: new Date(Date.now() - 180000).toISOString(), updatedAt: new Date().toISOString() };
const sample = [
  { ...base, id: "permission", kind: "permission", urgency: "action", status: "open", title: "Allow the agent to run the test suite?", detail: "npm run test:notifications — the agent is waiting for permission to continue.", actions: [{ label: "Allow", method: "POST", path: "/preview" }, { label: "Deny", method: "POST", path: "/preview" }] },
  { ...base, id: "plan", kind: "plan", urgency: "action", status: "open", title: "The inbox implementation plan is ready for review", detail: "Review the proposed changes to notification grouping, request actions, and desktop alerts.", actions: [{ label: "Approve plan", method: "POST", path: "/preview" }] },
  { ...base, id: "run", kind: "run_succeeded", urgency: "info", status: "resolved", title: "Nightly checks completed", detail: "All tests passed. No changes needed.", projectId: "docs", workspaceId: "main" },
  { ...base, id: "deploy", kind: "deploy_ready", urgency: "info", status: "resolved", title: "Your preview deployment is ready" },
];
function renderInbox(overrides = {}, search = "") {
  state = { items: [], counts: { total: 0, action: 0, byProject: {} }, loaded: true, error: null, before: null, ...overrides };
  query = search;
  return renderToStaticMarkup(React.createElement(Inbox, { projects }));
}
test("empty inbox uses the shared frame and shows one useful empty state", () => {
  const html = renderInbox();
  assert.match(html, /civ-panel/); assert.match(html, /Nothing needs you right now/);
  assert.doesNotMatch(html, /Earlier<|Needs your attention</);
});
test("attention precedes quiet history and retains permission controls and full details", () => {
  const html = renderInbox({ items: sample, counts: { total: 2, action: 2, byProject: { thunk: 2 } } });
  assert.ok(html.indexOf("Needs your attention") < html.indexOf("Earlier"));
  assert.match(html, />Allow<\/button>/); assert.match(html, />Deny<\/button>/);
  assert.match(html, /<details/); assert.match(html, /npm run test:notifications/);
  assert.equal((html.match(/data-notification="true"/g) || []).length, 4);
});
test("project filter excludes other projects and failure does not look like loading or success", () => {
  const filtered = renderInbox({ items: sample }, "projectId=docs");
  assert.match(filtered, /Nightly checks completed/); assert.doesNotMatch(filtered, /Allow the agent/);
  const failed = renderInbox({ loaded: false, error: "Connection lost" });
  assert.match(failed, /Your inbox couldn’t load/); assert.doesNotMatch(failed, /Loading inbox|All caught up/);
});
module.exports = { renderInbox, sample };
