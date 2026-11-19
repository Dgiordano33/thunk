/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");


const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = `${path.join(__dirname, "..", request.slice(2))}.ts`;
  return resolve.call(this, request, ...rest);
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return load.call(this, request, parent, isMain);
};
const { summarizeActivity } = require("../lib/server/activity.ts");

const idle = { sessions: [], routineRuns: 0, processes: [], workspaceLocks: 0 };

test("an idle server can restart", () => {
  const activity = summarizeActivity({
    ...idle,
    sessions: [{ status: "idle" }, { status: "closed" }, { status: "error" }],
    processes: [{ kind: "setup", running: false }, { kind: "archive", running: false }],
  });
  assert.equal(activity.busy, false);
  assert.deepEqual(activity.reasons, []);
});

test("working agents, routine runs and workspace tasks block a restart", () => {
  const activity = summarizeActivity({
    sessions: [{ status: "running" }, { status: "starting" }, { status: "idle" }],
    routineRuns: 1,
    processes: [{ kind: "setup", running: true }],
    workspaceLocks: 1,
  });
  assert.equal(activity.busy, true);
  assert.deepEqual(activity.reasons, ["2 agents working", "1 routine run in progress", "1 workspace task running"]);
  assert.equal(activity.workspaceTasks, 1);
});

test("waiting agents, terminals and previews are counted but do not block", () => {
  const activity = summarizeActivity({
    ...idle,
    sessions: [{ status: "awaiting" }],
    processes: [{ kind: "shell", running: true }, { kind: "run", running: true }, { kind: "shell", running: false }],
  });
  assert.equal(activity.busy, false);
  assert.equal(activity.agentsAwaiting, 1);
  assert.equal(activity.terminals, 1);
  assert.equal(activity.previews, 1);
});
