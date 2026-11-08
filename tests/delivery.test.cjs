/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript with the installed compiler. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const fs = require("node:fs");
const dataDir = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "thunk-delivery-"));
process.env.THUNK_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const Module = require("node:module");
const { promisify } = require("node:util");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};
const project = { id: "p", root: "/repo", kind: "repo", remote: "git@github.com:owner/repo.git", defaultBranch: "main" };
let workspaces = ["a", "b"].map((id) => ({ id, projectId: "p", cwd: "/repo/" + id, branch: "old", status: "active", baseRef: "origin/main" }));
let projects = [project];
let fail = false;
let calls = 0;
let prMissing = false;
let confirmedState = "CLOSED";
const raw = () => ({
  id: "PR_42", reviews: { nodes: [] }, reviewRequests: { nodes: [] },
  number: 42, url: "https://github.com/owner/repo/pull/42", state: "OPEN", title: "Test", isDraft: false,
  headRefName: "topic", baseRefName: "main", isCrossRepository: false, reviewDecision: "", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
  commits: { nodes: [{ commit: { oid: "head1",
    statusCheckRollup: { contexts: { totalCount: 2, nodes: [
      { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null, detailsUrl: null },
      { __typename: "StatusContext", context: "hosting", state: "SUCCESS", targetUrl: null },
    ] } }, deployments: { nodes: [
      { id: "deployment", environment: "Preview", latestStatus: { state: "SUCCESS", environmentUrl: "https://preview.example/" } },
      { id: "failed-deployment", environment: "Preview", latestStatus: { state: "FAILURE", environmentUrl: "https://failed.example/" } },
      { id: "unsafe-deployment", environment: "Preview", latestStatus: { state: "SUCCESS", environmentUrl: "javascript:alert(1)" } },
    ] },
  } }] },
});
const page = (nodes) => ({ data: { repository: { pullRequests: { nodes } } } });
const fakeExec = () => {};
fakeExec[promisify.custom] = async (cmd, args) => {
  if (cmd === "gh") {
    calls++;
    await new Promise((resolve) => setImmediate(resolve));
    if (fail) throw new Error("not logged in; gh auth login");
    if (args.some((arg) => arg.startsWith("ids[]="))) return { stdout: JSON.stringify({ data: { nodes: [{ id: "PR_42", state: confirmedState }] } }) };
    return { stdout: JSON.stringify([page(prMissing ? [] : [raw()])]) };
  }
  return { stdout: args[0] === "status" ? "# branch.head topic\n1 M. modified\n" : "2\t3" };
};
const load = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith("/projects/delivery.ts")) {
    if (request === "node:child_process") return { execFile: fakeExec };
    if (request === "@/lib/notifications/delivery") return { deliveryNotifications: async () => {} };
    if (request === "../supabase/repo/projects") return { listProjects: async () => projects };
    if (request === "../supabase/repo/workspaces") return { listAllWorkspaces: async () => workspaces };
    if (request === "./runtime") return { runtimeSnapshot: async () => ({ processes: [{ kind: "run", running: true }], previewUrl: "http://127.0.0.1:3000", setupError: null }) };
  }
  return load.call(this, request, parent, ...rest);
};
const { parseDeliveries, workspaceDeliveries } = require("../lib/projects/delivery.ts");
const { deliveryCue, httpUrl } = require("../lib/projects/delivery-types.ts");
Module._load = load;

test("maps checks, successful safe previews, PR pages, and excludes fork branch collisions", () => {
  const fork = { ...raw(), isCrossRepository: true };
  const rows = parseDeliveries([page([raw(), fork]), page([{ ...raw(), number: 43 }])]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].branch, "topic");
  assert.deepEqual(rows[0].pr.checks.map((c) => c.state), ["pending", "pass"]);
  assert.equal(rows[0].previewUrl, "https://preview.example/");
  assert.equal(rows[0].pr.reviewDecision, null);
  assert.equal(rows[1].pr.number, 43);
});

test("partial GraphQL errors are failures; truncated checks cannot turn green", () => {
  assert.throws(() => parseDeliveries([{ errors: [{ message: "Forbidden" }] }]), /Forbidden/);
  assert.throws(() => parseDeliveries([{ data: { repository: null } }]), /unavailable/);
  const pr = raw();
  pr.commits.nodes[0].commit.statusCheckRollup.contexts = { totalCount: 101, nodes: [] };
  assert.equal(deliveryCue(parseDeliveries([page([pr])])[0].pr).kind, "pending");
});

test("status symbols distinguish failures, drafts, pending, passed and absent checks", () => {
  const pr = parseDeliveries([page([raw()])])[0].pr;
  assert.equal(deliveryCue(null), null);
  assert.equal(deliveryCue(pr).kind, "pending");
  assert.equal(deliveryCue({ ...pr, isDraft: true }).kind, "draft");
  assert.equal(deliveryCue({ ...pr, isDraft: true, mergeable: "CONFLICTING" }).kind, "fail");
  assert.equal(deliveryCue({ ...pr, checks: [{ state: "fail" }] }).kind, "fail");
  assert.equal(deliveryCue({ ...pr, checks: [{ state: "pass" }] }).kind, "pass");
  assert.equal(deliveryCue({ ...pr, checks: [] }).kind, "unknown");
  assert.equal(deliveryCue({ ...pr, checks: [{ state: "skipped" }] }).kind, "unknown");
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/x", "//example.com", "invalid"]) assert.equal(httpUrl(value), null);
});

test("shared polling deduplicates, caches, preserves stale data on auth failure, recovers and prunes", async (t) => {
  workspaceDeliveries(true);
  const state = globalThis.__thunkDelivery;
  t.after(() => clearInterval(state.timer));
  while (state.ticking) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "one project request for two workspaces");
  let deliveries = workspaceDeliveries();
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0].git, { ahead: 3, behind: 2, dirty: true });
  assert.equal(deliveries[0].status.branch, "topic", "use actual checkout branch");
  assert.equal(deliveries[0].running, true);
  assert.equal(deliveries[0].localPreviewUrl, "http://127.0.0.1:3000");
  assert.ok(state.projects.get("p").nextPoll - Date.now() <= 10_000);
  await state.tick();
  assert.equal(calls, 1, "cache hit");
  fail = true;
  state.projects.get("p").nextPoll = 0;
  await Promise.all([state.tick(), state.tick()]);
  assert.equal(calls, 2, "overlapping ticks deduplicated");
  deliveries = workspaceDeliveries();
  assert.equal(deliveries[0].status.pr.number, 42);
  assert.match(deliveries[0].error, /auth login/);
  assert.equal(deliveries[0].status.canCreate, false);
  assert.ok(state.projects.get("p").nextPoll - Date.now() > 50_000, "back off errors even with pending cached checks");
  fail = false;
  state.projects.get("p").nextPoll = 0;
  await state.tick();
  assert.equal(workspaceDeliveries()[0].error, null);
  prMissing = true;
  state.projects.get("p").nextPoll = 0;
  await state.tick();
  assert.equal(workspaceDeliveries()[0].activity.length, 0, "closed PR is not a merge");
  prMissing = false;
  state.projects.get("p").nextPoll = 0;
  await state.tick();
  prMissing = true;
  confirmedState = "MERGED";
  state.projects.get("p").nextPoll = 0;
  await state.tick();
  assert.equal(workspaceDeliveries()[0].activity[0].type, "pr_merged");
  assert.equal(workspaceDeliveries()[0].status.pr, null);
  state.projects.get("p").nextPoll = 0;
  await state.tick();
  assert.equal(workspaceDeliveries()[0].activity.length, 1, "confirmed merge is not emitted twice");
  workspaces = workspaces.map((w) => ({ ...w, status: "archived" }));
  projects = [];
  await state.tick();
  assert.deepEqual(workspaceDeliveries(), []);
  assert.equal(state.projects.size, 0);
});

test("delivery polling does no git or GitHub work without viewers or subscriptions", async () => {
  const state = globalThis.__thunkDelivery;
  state.viewedUntil = 0;
  state.backgroundAt = 0;
  const before = calls;
  await state.tick();
  assert.equal(calls, before);
});
