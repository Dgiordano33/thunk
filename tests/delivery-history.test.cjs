/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript with the installed compiler. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "thunk-delivery-history-"));
process.env.THUNK_DATA_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { advanceDeliveryHistory: advance, emptyDeliveryHistory: empty, readDeliveryHistory: read, writeDeliveryHistory: write } = require("../lib/projects/delivery-history.ts");
const snapshot = (patch = {}) => ({
  id: "PR_1", branch: "topic", pr: { number: 1, url: "https://github.com/a/b/pull/1", title: "Change", head: "abc" },
  state: "OPEN", checks: [{ name: "build", state: "pending", url: null }], reviews: [], requests: [], deployments: [], ...patch,
});
const failed = () => snapshot({ checks: [{ name: "build", state: "fail", url: null }] });
const passed = () => snapshot({ checks: [{ name: "build", state: "pass", url: null }] });

test("first observations are silent; CI transitions and new heads emit once", () => {
  let history = advance(empty(), [failed()]);
  assert.equal(history.seq, 0);
  history = advance(history, [passed()]);
  assert.deepEqual(history.events.map((e) => e.type), ["ci_passed"]);
  const changed = { ...passed(), pr: { ...passed().pr, head: "def" } };
  history = advance(history, [changed]);
  assert.equal(history.seq, 2);
  assert.equal(advance(history, [changed]).seq, 2);
  history = advance(history, [failed()]);
  assert.equal(history.events.at(-1).type, "ci_failed");
  assert.equal(new Set(history.events.map((e) => e.id)).size, history.events.length);
});

test("all-skipped, empty and pending checks never report a successful CI event", () => {
  const baseline = advance(empty(), [snapshot()]);
  for (const checks of [[], [{ name: "build", state: "skipped", url: null }], snapshot().checks]) {
    assert.equal(advance(baseline, [snapshot({ checks })]).seq, 0);
  }
});

test("reviews, requests and successful deployments emit on change, not every poll", () => {
  const baseline = advance(empty(), [snapshot()]);
  const current = snapshot({ reviews: ["review1"], requests: ["person1"], deployments: [{ id: "d1", state: "SUCCESS", url: "https://preview.example/" }] });
  const next = advance(baseline, [current]);
  assert.deepEqual(next.events.map((e) => e.type), ["review_posted", "review_requested", "deploy_ready"]);
  assert.equal(advance(next, [current]).seq, 3);
  assert.equal(advance(next, [snapshot({ deployments: [{ id: "d2", state: "FAILURE", url: "https://preview.example/" }] })]).seq, 3);
  const cleared = advance(next, [snapshot()]);
  assert.equal(advance(cleared, [current]).seq, 6);
});

test("closed or missing PRs are not merges; confirmed merges emit once", () => {
  const baseline = advance(empty(), [snapshot()]);
  assert.equal(advance(baseline, []).seq, 0);
  assert.equal(advance(baseline, [snapshot({ state: "CLOSED" })]).seq, 0);
  const merged = advance(baseline, [snapshot({ state: "MERGED" })]);
  assert.equal(merged.events[0].type, "pr_merged");
  assert.equal(merged.snapshots.length, 0);
  assert.equal(advance(merged, []).seq, 1);
});

test("atomic history persists cursors across restart and refuses corrupt data", async () => {
  const root = "/fixture/repo";
  const initial = await read(root);
  const history = advance(advance(initial, [snapshot()]), [failed()]);
  await write(root, history);
  const restored = await read(root);
  assert.deepEqual(restored, history);
  assert.equal(advance(restored, [failed()]).seq, 1);
  const invalid = { ...history, events: [{ ...history.events[0], previewUrl: "javascript:alert(1)" }] };
  await assert.rejects(write(root, invalid));
  assert.deepEqual(await read(root), history, "invalid writes do not damage existing history");
  const { projectDir } = require("../lib/projects/paths.ts");
  const file = path.join(projectDir(root), "delivery.json");
  fs.writeFileSync(file, "broken");
  await assert.rejects(read(root));
  assert.equal(fs.readFileSync(file, "utf8"), "broken", "corruption is not silently overwritten");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["delivery.json"]);
});

test("history stays bounded while event sequence remains monotonic", () => {
  let history = advance(empty(), [snapshot()]);
  for (let i = 0; i < 220; i++) history = advance(history, [i % 2 ? passed() : failed()]);
  assert.equal(history.events.length, 200);
  assert.equal(history.seq, 220);
  assert.equal(history.events[0].seq, 21);
});

const Module = require("node:module");
const originalLoad = Module._load;
let routines = [];
let histories = [];
let deliveries = [];
const fired = [];
Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith("/routines/delivery-poll.ts")) {
    if (request === "@/lib/projects/delivery") return { deliveryHistories: () => histories, workspaceDeliveries: () => deliveries };
    if (request === "@/lib/supabase/repo/routines") return {
      listEnabledRoutines: async () => routines,
      updateRoutine: async (id, patch) => { const routine = routines.find((r) => r.id === id); Object.assign(routine, patch); return routine; },
    };
    if (request === "./runner") return { fire: async (...args) => { fired.push(args); } };
  }
  return originalLoad.call(this, request, parent, ...rest);
};
const { pendingDeliveryEvents: pending, pollDeliveryRoutines: poll } = require("../lib/routines/delivery-poll.ts");
Module._load = originalLoad;
const routine = (patch = {}) => ({ id: "r", projectId: "p", events: ["ci_failed", "review_requested", "deploy_ready"], targetKind: "workspace", targetWorkspaceId: "w", triggerState: {}, ...patch });
const workspace = { workspaceId: "w", projectId: "p", error: null, status: { branch: "topic" } };

test("trigger baselines, subscription changes and history reset never replay old events", () => {
  const history = advance(advance(empty(), [snapshot()]), [failed()]);
  const r = routine();
  const baseline = pending(r, history, [workspace]);
  assert.deepEqual(baseline.events, []);
  r.triggerState.delivery = baseline.cursor;
  assert.deepEqual(pending(r, history, [workspace]).events, []);
  const next = advance(advance(history, [passed()]), [failed()]);
  assert.equal(pending(r, next, [workspace]).events.length, 1);
  assert.equal(pending({ ...r, events: ["ci_failed"] }, next, [workspace]).events.length, 0);
  assert.equal(pending(r, { ...next, epoch: "new-history" }, [workspace]).events.length, 0);
});

test("delivery triggers respect workspace branch, current head, recovery and loop protection", () => {
  const baseline = advance(empty(), [snapshot()]);
  const r = routine();
  r.triggerState.delivery = pending(r, baseline, [workspace]).cursor;
  const history = advance(baseline, [failed()]);
  assert.equal(pending(r, history, [workspace]).events.length, 1);
  assert.equal(pending(r, history, [{ ...workspace, projectId: "other" }]).events.length, 0);
  assert.equal(pending(r, history, [{ ...workspace, status: { branch: "other" } }]).events.length, 0);
  assert.equal(pending(r, history, [{ ...workspace, error: "unavailable" }]).events.length, 0);
  assert.equal(pending(r, advance(history, [passed()]), [workspace]).events.length, 0);
  assert.equal(pending(r, advance(history, [{ ...snapshot(), pr: { ...snapshot().pr, head: "new" } }]), [workspace]).events.length, 0);
  const ephemeral = routine({ targetKind: "ephemeral", targetWorkspaceId: null });
  ephemeral.triggerState.delivery = pending(ephemeral, baseline, []).cursor;
  assert.equal(pending(ephemeral, history, []).events.length, 1);
  assert.equal(pending(ephemeral, { ...history, events: history.events.map((e) => ({ ...e, branch: "thunk/auto" })) }, []).events.length, 0);
});

test("routine dispatch persists the cursor and routes event payloads through fire once", async () => {
  const initial = advance(empty(), [snapshot()]);
  routines = [routine()]; deliveries = [workspace]; histories = [{ projectId: "p", history: initial }];
  await poll();
  histories[0].history = advance(initial, [failed()]);
  await poll();
  assert.equal(fired.length, 1);
  assert.equal(fired[0][1], "ci_failed");
  assert.equal(fired[0][2].pr.branch, "topic");
  assert.equal(fired[0][2].checks[0].state, "fail");
  await poll();
  assert.equal(fired.length, 1);
  routines = JSON.parse(JSON.stringify(routines));
  await poll();
  assert.equal(fired.length, 1, "persisted routine cursor survives process restart");
});
