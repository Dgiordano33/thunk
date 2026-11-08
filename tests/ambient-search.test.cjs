/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the route without a database or agent. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

test("incremental searches share a snapshot, filter independently, and refresh after expiry", async (t) => {
  let reads = 0;
  let now = 10000;
  const clock = Date.now;
  Date.now = () => now;
  t.after(() => { Date.now = clock; });
  const stubs = {
    listLiveSessions: () => [], handle: (fn) => fn, db: () => null,
    listDocumentsForSessions: async () => [], listTasks: async () => [],
    listProjects: async () => [{ id: "p", name: "Project" }], listAllWorkspaces: async () => [],
    projectNoteDirs: () => ({}), scopeKey: () => "projects/p",
    listNotes: async () => { reads++; return [{ id: "n", title: "Alpha", markdown: "Beta", excerpt: "Beta", scope: {} }]; },
  };
  const source = fs.readFileSync(require("node:path").join(__dirname, "../app/api/ambient/search/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(() => stubs, exports);
  const search = async (q) => (await exports.GET(new Request(`http://localhost/api/ambient/search?q=${q}`))).json();
  const [alpha, none] = await Promise.all([search("alpha"), search("missing")]);
  assert.equal(alpha.results.length, 1);
  assert.equal(none.results.length, 0);
  assert.equal(reads, 1);
  now += 2001;
  assert.equal((await search("beta")).results.length, 1);
  assert.equal(reads, 2);
});
