/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-evidence-"));
process.env.THUNK_DATA_DIR = tmp;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const base = path.join(__dirname, "..", request.slice(2));
    request = fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, "index.ts");
  }
  return resolve.call(this, request, ...rest);
};
const project = { id: crypto.randomUUID(), dataKey: "evidence", repos: [] };
const sessions = [];
let current = null;
const execs = [];
let testExit = 0;
const { promisify } = require("node:util");
const fakeExec = () => {};
fakeExec[promisify.custom] = async (file, args, opts) => { execs.push({ file, args, cwd: opts.cwd }); if (testExit) throw Object.assign(new Error("failed"), { code: testExit }); return { stdout: "ok", stderr: "" }; };
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  // Never connect to configured local or remote databases: memory mode, or a migrated PGlite for one test.
  if (request === "../server") return { db: () => current, hasDatabase: () => Boolean(current) };
  if (request === "@/lib/agent") return { listSessions: async ({ workspaceId }) => sessions.filter((s) => s.workspaceId === workspaceId) };
  if (request === "@/lib/db/repo/projects") return { getProject: async (id) => id === project.id ? project : null };
  if (request === "@/lib/projects/git") return { tryGit: async () => "head-2" };
  if (request === "@/lib/projects/runtime") return { processEnvironment: () => ({}) };
  if (request === "node:child_process" && parent?.filename.endsWith(path.join("evidence", "service.ts"))) return { execFile: fakeExec };
  return load.call(this, request, parent, isMain);
};
const tasks = require("../lib/db/repo/tasks.ts");
const workspaces = globalThis.__thunkMemWorkspacesV2 ?? (require("../lib/db/repo/workspaces.ts"), globalThis.__thunkMemWorkspacesV2);
const evidence = require("../lib/evidence/service.ts");
const { listEvidence } = require("../lib/db/repo/task-evidence.ts");
const { patchTask, reviseCriteria } = require("../lib/tasks/service.ts");

async function setup() {
  const projectId = project.id;
  const task = await tasks.insertTask({ projectId, title: "Fix login", criteria: [{ id: "c1", text: "Tests pass", kind: "test" }] });
  const workspace = { id: crypto.randomUUID(), projectId, name: "w", slug: "w", cwd: tmp, branch: `thunk/${task.id.slice(0, 6)}`, repos: [], status: "active", visibility: "project", createdAt: "", updatedAt: "" };
  workspaces.set(workspace.id, workspace);
  sessions.push({ id: crypto.randomUUID(), workspaceId: workspace.id, origin: { kind: "worker", taskId: task.id } });
  return { task, workspace, sessionId: sessions.at(-1).id };
}

test("criteria changes bump the version and older evidence is marked as covering an older revision", async () => {
  const { task, sessionId } = await setup();
  assert.equal(task.criteriaVersion, 1);
  await evidence.recordClaimed(task, sessionId, "```worker-summary\noutcome: done\nevidence:\n- c1 | pass | test | npm test | none\n```", "head-1");
  let [row] = await evidence.reviewEvidence(await tasks.getTask(task.id), ["head-1"]);
  assert.equal(row.stale, null);
  assert.equal(row.commitSha, "head-1");
  [row] = await evidence.reviewEvidence(await tasks.getTask(task.id), ["head-2"]);
  assert.equal(row.stale, "commit", "the branch moved past the commit the claim covers");
  const same = await reviseCriteria(task.id, [{ id: "c1", text: "Tests pass", kind: "test" }]);
  assert.equal(same.criteriaVersion, 1, "saving identical criteria is not a revision");
  const revised = await reviseCriteria(task.id, [{ id: "c1", text: "Tests pass on CI", kind: "test" }]);
  assert.equal(revised.criteriaVersion, 2);
  [row] = await evidence.reviewEvidence(revised, ["head-1"]);
  assert.equal(row.stale, "criteria");
  const cleared = await patchTask(task.id, { criteria: [] });
  assert.equal(cleared.criteria, null);
  assert.equal(cleared.criteriaVersion, 3);
});

test("trial merges and the delivery poller write observed rows for the task on that branch", async () => {
  const { task, workspace } = await setup();
  await evidence.recordIntegration({ workspaceId: "iw", branch: "integration", merged: [{ taskId: task.id, title: "Fix", repo: "r", branch: workspace.branch, uncommitted: false }], conflicts: [],
    tests: { command: "npm test", exitCode: 1, output: "boom" } }, [{ taskId: task.id, repo: "r", branch: workspace.branch, sha: "head-1" }]);
  const pr = { number: 4, url: "https://github.com/o/r/pull/4", title: "Fix", head: "head-2" };
  await evidence.recordDelivery(project.id, [
    { id: "e1", seq: 1, type: "ci_failed", at: "", branch: workspace.branch, pr, checks: [{ name: "build", state: "fail", url: "https://ci/1" }], previewUrl: null },
    { id: "e2", seq: 2, type: "deploy_ready", at: "", branch: workspace.branch, pr, checks: [], previewUrl: "https://preview.example/" },
    { id: "e3", seq: 3, type: "ci_passed", at: "", branch: "someone-else", pr, checks: [], previewUrl: null },
  ]);
  const rows = (await listEvidence(task.id)).reverse();
  assert.deepEqual(rows.map((r) => [r.origin, r.type, r.status, r.commitSha]), [
    ["observed", "merge", "pass", "head-1"], ["observed", "test", "fail", "head-1"], ["observed", "ci", "fail", "head-2"], ["observed", "preview", "pass", "head-2"],
  ]);
  assert.equal(rows[2].ref, "https://ci/1");
  assert.equal(rows[3].ref, "https://preview.example/");
  assert.ok(rows.every((r) => r.criteriaVersion === 1));
});

test("Thunk runs scripts.test on finish only when the project turned it on", async () => {
  const { task, workspace, sessionId } = await setup();
  fs.writeFileSync(path.join(tmp, "thunk.json"), JSON.stringify({ scripts: { test: "npm test" } }));
  const ctx = { project, workspace };
  assert.equal(await evidence.runTestsOnFinish(ctx, task, sessionId), null, "off by default");
  assert.equal(execs.length, 0);
  assert.deepEqual(await evidence.writeReviewSettings(project, { testOnFinish: true }), { testOnFinish: true });
  testExit = 2;
  const row = await evidence.runTestsOnFinish(ctx, task, sessionId);
  assert.equal(execs.length, 1);
  assert.equal(execs[0].cwd, tmp);
  assert.deepEqual([row.origin, row.type, row.status, row.commitSha], ["observed", "test", "fail", null]);
  assert.match(row.detail, /npm test exited 2/);
});

test("criteria and evidence round-trip through Postgres", async () => {
  const { testDb } = require("./helpers/test-db.cjs");
  current = await testDb();
  try {
    const [{ id: projectId }] = await current.query("insert into projects (name, data_key, slug) values ('Ev', 'ev', 'ev') returning id");
    const task = await tasks.insertTask({ projectId, title: "Ship", criteria: [{ id: "c1", text: "Tests pass", kind: "test" }] });
    assert.deepEqual([task.criteria, task.criteriaVersion], [[{ id: "c1", text: "Tests pass", kind: "test" }], 1]);
    const updated = await tasks.updateTask(task.id, { criteria: [{ id: "c1", text: "CI passes", kind: "test" }], criteriaVersion: 2 });
    assert.equal(updated.criteria[0].text, "CI passes");
    await evidence.recordClaimed(updated, crypto.randomUUID(), "```worker-summary\nevidence:\n- c1 | pass | test | ok | none\n```", "abc");
    const [row] = await listEvidence(task.id);
    assert.deepEqual([row.criterionId, row.origin, row.status, row.commitSha, row.criteriaVersion], ["c1", "claimed", "pass", "abc", 2]);
    await current.query("delete from tasks where id = $1", [task.id]);
    assert.deepEqual(await listEvidence(task.id), [], "evidence goes with its task");
  } finally { await current.close(); current = null; }
});
