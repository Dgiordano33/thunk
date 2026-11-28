/* eslint-disable @typescript-eslint/no-require-imports -- Server TypeScript compiler harness. */
const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-limits-"));
process.env.THUNK_DATA_DIR = tmp;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mocks = { "server-only": {}, "@/lib/agent": { getSession: () => null }, "@/lib/home/prompt": { TOP_CHIEF_PROMPT: "top" } };
const cache = new Map();
function load(name, from = path.join(root, "index.ts")) {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
  let filename = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(from), name);
  if (!filename.endsWith(".ts")) filename += ".ts";
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  mod.require = (request) => load(request, filename);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const limits = load("@/lib/setup/limits");
const route = load("@/app/api/settings/limits/route");
const prompt = load("@/lib/workers/prompt");
const file = path.join(tmp, "config", "limits.json");
let bump = 0;
/** Write by hand, as a person editing the file would, with a distinct mtime so the cache notices. */
function writeByHand(value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  const t = new Date(Date.now() + ++bump * 1000);
  fs.utimesSync(file, t, t);
}
const put = (body) => route.PUT(new Request("http://x/api/settings/limits", { method: "PUT", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const defaults = { workersPerProject: 4, routineRunsAtOnce: 3, chiefAnswerMinutes: 10 };

beforeEach(() => fs.rmSync(file, { force: true }));

test("missing file gives the defaults", () => {
  assert.equal(limits.limitsFile(), file);
  assert.deepEqual(limits.readLimits(), defaults);
  assert.deepEqual(limits.DEFAULT_LIMITS, defaults);
  assert.equal(limits.chiefAnswerMs(), 10 * 60_000);
});

test("parsing clamps out-of-range values, rounds, and falls back per field", () => {
  assert.deepEqual(limits.parseLimits({ workersPerProject: 40, routineRunsAtOnce: 0, chiefAnswerMinutes: "soon" }),
    { workersPerProject: 12, routineRunsAtOnce: 1, chiefAnswerMinutes: 10 });
  assert.deepEqual(limits.parseLimits({ workersPerProject: -5, chiefAnswerMinutes: 600, relayGraceMinutes: 3 }), { ...defaults, workersPerProject: 1, chiefAnswerMinutes: 60 });
  assert.deepEqual(limits.parseLimits(null), defaults);
  assert.deepEqual(limits.parseLimits([1, 2]), defaults);
  assert.deepEqual(limits.parseLimits({ workersPerProject: Infinity, extra: true }), defaults);
});

test("a hand edit applies on the next read, and a broken file falls back to defaults", () => {
  writeByHand({ workersPerProject: 2 });
  assert.equal(limits.workersPerProject(), 2);
  writeByHand({ workersPerProject: 7, routineRunsAtOnce: 99 });
  assert.deepEqual(limits.readLimits(), { ...defaults, workersPerProject: 7, routineRunsAtOnce: 10 });
  const error = console.error; console.error = () => {};
  try { writeByHand("{ not json"); assert.deepEqual(limits.readLimits(), defaults); } finally { console.error = error; }
  fs.rmSync(file);
  assert.deepEqual(limits.readLimits(), defaults, "deleting the file goes back to defaults");
});

test("GET and PUT /api/settings/limits", async () => {
  assert.deepEqual(await (await route.GET(new Request("http://x"))).json(), defaults);
  const ok = await put({ workersPerProject: 6, chiefAnswerMinutes: 3 });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ...defaults, workersPerProject: 6, chiefAnswerMinutes: 3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ...defaults, workersPerProject: 6, chiefAnswerMinutes: 3 });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(limits.workersPerProject(), 6);
  const partial = await put({ routineRunsAtOnce: 8 });
  assert.deepEqual(await partial.json(), { ...defaults, workersPerProject: 6, chiefAnswerMinutes: 3, routineRunsAtOnce: 8 }, "a partial PUT keeps the other values");

  for (const [body, pattern] of [
    [{ workersPerProject: 13 }, /at most 12/],
    [{ workersPerProject: 0 }, /at least 1/],
    [{ routineRunsAtOnce: 2.5 }, /whole number/],
    [{ chiefAnswerMinutes: "5" }, /must be a number/],
    [{ relayGraceMinutes: 5 }, /relayGraceMinutes|Unrecognized/i],
    [{ maxWorkers: 3 }, /maxWorkers|Unrecognized/i],
    ["{ nope", /Invalid JSON/],
  ]) {
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, pattern);
  }
  assert.equal(limits.workersPerProject(), 6, "rejected requests change nothing");
});

test("the chief's instructions state the current limits", () => {
  assert.match(prompt.teamPrompt({ kind: "chief" }), /Up to 4 workers run at a time[\s\S]*after 10 minutes\./);
  limits.updateLimits({ workersPerProject: 1, chiefAnswerMinutes: 1 });
  assert.match(prompt.teamPrompt({ kind: "chief" }), /One worker runs at a time[\s\S]*after 1 minute\./);
});
