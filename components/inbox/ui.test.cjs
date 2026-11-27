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
let state, query = "", captureRows = [];
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
  if (name === "@/components/capture/use-captures") return { useCaptures: () => ({ rows: captureRows, limit: 8, error: "", rule: null, setRule() {}, refresh: async () => {}, act: async () => true, retry: async () => {} }) };
  if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(query) };
  if (name === "@/components/ai-elements/message") return { MessageResponse: ({ children }) => React.createElement("div", null, children) };
  if (name === "@/components/hint") return { Hint: ({ children }) => children };
  return originalLoad.call(this, name, ...rest);
};
const { Inbox } = require("./inbox.tsx");
const model = require("./model.ts");
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
  assert.doesNotMatch(html, /Earlier<|Decisions</);
});
test("decisions precede quiet history and retain permission controls and full details", () => {
  const html = renderInbox({ items: sample, counts: { total: 2, action: 2, byProject: { thunk: 2 } } });
  assert.ok(html.indexOf(">Decisions<") < html.indexOf(">Earlier<"));
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
test("a ready thought is a Decision in time order; thoughts under way stay in the quiet list above", () => {
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const thought = (id, status, over = {}) => ({ id, text: `Thought ${id}`, status, project_id: "thunk", task_id: `t-${id}`, workspace_id: "inbox", session_id: `s-${id}`, mode: "scout", title: `Look into ${id}`, assumptions: ["Meant Thunk"], next_step: status === "ready" ? "Open a PR" : null, summary: status === "ready" ? "Found the flaky test" : null, diff_stat: null, cost_usd: 0.12, error: null, created_at: at(30), updated_at: at(5), ...over });
  captureRows = [thought("ready1", "ready"), thought("busy", "working")];
  const decisions = sample.filter((n) => n.status === "open").map((n, i) => ({ ...n, createdAt: at(i === 0 ? 1 : 10) }));
  const ready = { ...base, id: "thought", kind: "capture_ready", urgency: "action", status: "open", subjectKey: "capture:ready1", sessionId: "s-ready1", title: "Look into ready1", createdAt: at(5) };
  const html = renderInbox({ items: [...decisions, ready].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), counts: { total: 3, action: 3, byProject: { thunk: 3 } } });
  captureRows = [thought("ready1", "ready", { next_step: null })];
  const completed = renderInbox({ items: [ready], counts: { total: 1, action: 1, byProject: { thunk: 1 } } });
  assert.doesNotMatch(completed, /Go ahead/);
  assert.match(completed, />Keep</);
  assert.match(completed, /Found the flaky test/);
  captureRows = [];
  const card = html.indexOf('aria-label="Thought ready: Look into ready1"');
  assert.ok(card > 0, "the ready thought renders as a row in the feed");
  assert.ok(html.indexOf("Allow the agent") < card && card < html.indexOf("inbox implementation plan"), "newest first, interleaved with other decisions");
  assert.match(html, /Go ahead: Open a PR/); assert.match(html, /You said/); assert.match(html, /Found the flaky test/);
  assert.match(html, /data-action="3"[^>]*>Discard/);
  assert.doesNotMatch(html, /Dismiss “Look into ready1”/, "a thought closes through Keep or Discard, not dismiss");
  assert.match(html, /Thought busy/); assert.match(html, /Working · Thunk/);
  assert.doesNotMatch(html, /<input[^>]*aria-label="Relay a thought"/, "new thoughts come from the Capture bar, not an Inbox field");
  assert.equal((html.match(/Thought ready1/g) || []).length, 1, "the ready thought is not repeated in the quiet list");
  assert.equal((html.match(/data-notification="true"[^>]*tabindex="0"|tabindex="0"[^>]*data-notification="true"/g) || []).length, 1, "one roving tab stop across thoughts and decisions");
});
const ci = (i, projectId = "thunk") => ({ ...base, projectId, id: `ci-${projectId}-${i}`, kind: "ci_failed", urgency: "action", status: "open", subjectKey: `pr:${i}:ci`,
  title: `CI failed · #${850 + i}`, detail: `Fix flaky test ${i}`, href: `https://github.com/acme/thunk/pull/${850 + i}`, createdAt: new Date(Date.now() - 86400000 - i * 1000).toISOString() });
test("many CI failures collapse into one grouped list of one-line rows behind the decisions", () => {
  const many = [...sample, ...Array.from({ length: 13 }, (_, i) => ci(i))];
  const html = renderInbox({ items: many, counts: { total: 15, action: 15, byProject: { thunk: 15 } } });
  assert.ok(html.indexOf(">Decisions<") < html.indexOf(">Follow-ups<"));
  assert.equal((html.match(/border-l-\[var\(--status-attention\)\]/g) || []).length, 2, "only decisions get the card edge");
  assert.match(html, />Dismiss 13</); assert.match(html, /Show 8 more/);
  assert.equal((html.match(/Open PR on GitHub/g) || []).length, 5);
  assert.match(html, /Fix flaky test 0/); assert.match(html, /font-mono">#850</);
  assert.doesNotMatch(html, /CI failed · #850/, "the kind label is not repeated in the lead line");
  assert.match(html, /target="_blank"/); assert.doesNotMatch(html, /Take a look|Mark all read/);
  assert.match(html, /2 decisions · 13 follow-ups/);
  assert.equal((html.match(/tabindex="0"/g) || []).filter(Boolean).length > 0, true);
  assert.equal((html.match(/data-notification="true"[^>]*tabindex="0"|tabindex="0"[^>]*data-notification="true"/g) || []).length, 1, "one roving tab stop among rows");
});
test("dismiss names are distinct, plans lead with review, question options have equal weight", () => {
  const question = { ...base, id: "q", kind: "question", urgency: "action", status: "open", title: "Which database?", actions: ["Postgres", "SQLite", "MySQL", "Mongo", "Redis"].map((label) => ({ label, method: "POST", path: "/a" })) };
  const html = renderInbox({ items: [...sample, question, ci(1), ci(2)] });
  const names = [...html.matchAll(/aria-label="(Dismiss[^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length);
  assert.match(html, />Review plan</); assert.doesNotMatch(html, />Approve plan</);
  assert.match(html, /1 more options in session/); assert.doesNotMatch(html, />Redis</);
  const options = [...html.matchAll(/data-variant="(\w+)"[^>]*>(Postgres|SQLite|MySQL|Mongo)</g)].map((m) => m[1]);
  assert.deepEqual([...new Set(options)], ["outline"]);
});
test("kind filter from the URL scopes the header count and the list", () => {
  const html = renderInbox({ items: [...sample, ci(1)], counts: { total: 3, action: 3, byProject: { thunk: 3 } } }, "kind=ci_failed");
  assert.match(html, /1 follow-up</); assert.doesNotMatch(html, /Allow the agent/); assert.doesNotMatch(html, /\d decisions? ·/);
});
test("focus moves to the row that took the dismissed row's place", () => {
  assert.equal(model.nextFocus(["a", "b", "c"], ["b"], "b"), "c");
  assert.equal(model.nextFocus(["a", "b", "c"], ["c"], "c"), "b");
  assert.equal(model.nextFocus(["a", "b", "c"], ["a", "b"], "a"), "c");
  assert.equal(model.nextFocus(["a", "b", "c"], ["b"], "a"), "a");
  assert.equal(model.nextFocus(["a"], ["a"], "a"), null);
});
test("bulk dismissal scope counts decisions so the inbox can confirm first", () => {
  const scope = model.dismissScope([...sample, ci(1), ci(2)]);
  assert.equal(scope.count, 4); assert.equal(scope.decisions, 2);
  assert.equal(model.dismissScope([ci(1), ci(2)]).decisions, 0);
  const groups = model.groupFollowups([ci(1), ci(2, "docs"), ci(3)]);
  assert.deepEqual(groups.map((g) => [g.projectId, g.items.length]), [["thunk", 2], ["docs", 1]]);
  assert.equal(model.destination(ci(1)), "Open PR on GitHub");
  assert.equal(model.destination({ ...base, kind: "turn_finished", sessionId: "s", href: "/w/s" }), "Open session");
});
test("items from a session can be answered in place; items without one only link out", () => {
  const stuck = { ...base, id: "stuck", kind: "session_stuck", urgency: "action", status: "open", sessionId: "s1", title: "Agent has been quiet for 10 minutes" };
  const ask = { ...base, id: "ask", kind: "question", urgency: "action", status: "open", sessionId: "s2", title: "Runner? · Platforms?" };
  const html = renderInbox({ items: [...sample.map((n) => n.id === "permission" ? { ...n, sessionId: "s3" } : n), stuck, ask, ci(1)] });
  assert.equal((html.match(/data-reply="true"/g) || []).length, 2, "decision cards with a session get a reply button");
  assert.match(html, /data-variant="default"[^>]*data-reply="true"[^>]*>.*?Answer</s, "a question with no inline options leads with Answer");
  assert.equal((html.match(/data-context="true"/g) || []).length, 3, "every session item offers quick context");
  assert.match(html, /aria-label="Quick context for “Agent has been quiet for 10 minutes”"/);
  assert.doesNotMatch(html, /Quick context for “Fix flaky test 1”/);
  assert.doesNotMatch(html, /aria-expanded="true"/, "context stays closed until asked for");
  assert.match(html, /<kbd[^>]*>c<\/kbd> context/); assert.match(html, /<kbd[^>]*>r<\/kbd> reply/);
});
test("the triage loop moves to the next decision the person saw, then the one before, then anything new", () => {
  assert.equal(model.nextDecision(["a", "b", "c"], "b", ["a", "c"]), "c");
  assert.equal(model.nextDecision(["a", "b", "c"], "c", ["a", "b"]), "b");
  assert.equal(model.nextDecision(["a", "b", "c"], "a", ["c"]), "c", "skips decisions that left meanwhile");
  assert.equal(model.nextDecision(["a"], "a", ["z"]), "z", "a decision that arrived since");
  assert.equal(model.nextDecision(["a"], "a", []), null);
});
test("earlier updates from one session fold under the newest, with a count to unfold them", () => {
  const turn = (i, sessionId) => ({ ...base, id: `t${i}`, kind: "turn_finished", urgency: "info", status: "resolved", sessionId, title: `Phone layout · Turn ${i}`, createdAt: new Date(Date.now() - i * 60000).toISOString() });
  const folds = model.foldBySession([turn(1, "s"), turn(2, null), turn(3, "s"), turn(4, "s"), turn(5, null)]);
  assert.deepEqual(folds.map((f) => [f.lead.id, f.rest.map((n) => n.id)]), [["t1", ["t3", "t4"]], ["t2", []], ["t5", []]]);
  const html = renderInbox({ items: [turn(1, "s"), turn(3, "s"), turn(4, "s"), turn(2, null)] });
  assert.match(html, /aria-label="Show 2 earlier updates from this session"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*aria-label="Show 2 earlier updates from this session"/);
  assert.match(html, />\+2<svg/); assert.match(html, /Phone layout · Turn 1/); assert.doesNotMatch(html, /Phone layout · Turn 3/, "folded rows stay hidden");
  assert.match(html, /Phone layout · Turn 2/, "rows from no session stand alone");
});
test("decision options carry number keys, and a permission can be allowed for the session", () => {
  const permission = { ...sample[0], sessionId: "s", actions: ["Allow", "Allow for this session", "Deny"].map((label) => ({ label, method: "POST", path: "/p" })) };
  const html = renderInbox({ items: [permission, sample[1]] });
  assert.deepEqual([...html.matchAll(/data-action="(\d)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]), [["1", "Allow"], ["2", "Allow for this session"], ["3", "Deny"], ["1", "Review plan"]]);
  assert.match(html, /<kbd[^>]*>1<\/kbd>–<kbd[^>]*>4<\/kbd> answer/);
});
module.exports = { renderInbox, sample };
