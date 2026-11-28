/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through Node's CommonJS loader. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { mkdtempSync, realpathSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(require("node:fs").readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
// One shared stub, so the SQL test can point the repos at a real (in-memory) Postgres for a moment.
const server = { db: () => null };
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/agent") return { listLiveSessions: () => [], closeSession: () => {}, getSession: () => null };
  if (request === "@/lib/projects") return require("../lib/projects/index.ts");
  if (request === "../server") return server; // Memory mode: never connect to a configured database.
  return load.call(this, request, parent, isMain);
};

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "thunk-memory-")));
process.env.THUNK_DATA_DIR = path.join(base, "data");
const projects = require("../lib/projects/index.ts");
const paths = require("../lib/projects/paths.ts");
const { memoryTools } = require("../lib/memory/tools.ts");
const service = require("../lib/memory/service.ts");
const { entryKey, memoryHash, readSidecar, sidecarFile } = require("../lib/memory/sidecar.ts");
const notifications = require("../lib/db/repo/notifications.ts");
const proposals = require("../lib/db/repo/memory-proposals.ts");
const { readOnlySession, readOnlyDenial } = require("../lib/workers/prompt.ts");
const { harvestBrief } = require("../lib/memory/harvest.ts");
const { insertTask, updateTask } = require("../lib/db/repo/tasks.ts");

test.after(() => fs.rm(base, { recursive: true, force: true }));

const MEMORY = "# Project memory\n\n- Use pnpm.\n- Tests live in tests/.\n";
async function context(name, memory = MEMORY) {
  const root = path.join(base, name);
  await fs.mkdir(root);
  const project = await projects.addProject(root);
  const workspace = await projects.createWorkspace({ projectId: project.id, name: "farm", worktree: false, setup: "skip" });
  const file = paths.projectMemoryFile(project.dataKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, memory);
  return { project, workspace, file };
}
const tool = (ctx, origin) => memoryTools({ projectId: ctx.project.id, workspaceId: ctx.workspace.id, sessionId: crypto.randomUUID(), origin })[0];
const call = async (t, input) => { const r = await t.handler(input); return { text: r.content[0].text, isError: r.isError }; };
const latest = async (projectId) => (await proposals.listMemoryProposals({ projectId }))[0];
const card = async (id) => (await notifications.listNotifications({ status: "all" })).find((n) => n.subjectKey === `memory-proposal:${id}`);
const acceptAll = (p) => p.items.map((i) => ({ id: i.id, decision: "accepted" }));

const ITEMS = [
  { op: "add", text: "- Retry the flaky upload test once.", kind: "workaround", reason: "It fails on cold caches.", sources: [{ type: "task", id: "t1" }] },
  { op: "replace", target: "- Use pnpm.", text: "- Use npm; pnpm was dropped.", kind: "decision", reason: "The workspace switched package managers.", sources: [{ type: "workspace", id: "w1" }] },
];

test("memory_propose records a proposal and opens a memory_proposal Inbox card", async () => {
  const ctx = await context("propose");
  const { text, isError } = await call(tool(ctx, { kind: "memory", purpose: "harvest" }), { summary: "Package manager and a flaky test", items: ITEMS });
  assert.equal(isError, false, text);
  const proposal = await latest(ctx.project.id);
  assert.equal(proposal.origin, "harvest");
  assert.equal(proposal.status, "open");
  assert.equal(proposal.baseHash, memoryHash(MEMORY));
  assert.deepEqual(proposal.items.map((i) => [i.op, i.kind, i.sources[0].type]), [["add", "workaround", "task"], ["replace", "decision", "workspace"]]);
  const n = await card(proposal.id);
  assert.equal(n.kind, "memory_proposal");
  assert.equal(n.urgency, "action");
  assert.equal(n.status, "open");
  assert.equal(n.href, `/inbox/memory/${proposal.id}`);
  assert.match(n.detail, /Add 1 · Replace 1/);
  assert.equal(await fs.readFile(ctx.file, "utf8"), MEMORY, "proposing writes nothing");
  // Codex registers it as a dynamic tool from its JSON schema.
  const { z } = require("zod");
  assert.ok(z.toJSONSchema(z.strictObject(tool(ctx).schema)).properties.items);
});

test("memory_propose refuses a target that isn't in memory, and records an empty run without a card", async () => {
  const ctx = await context("refuse");
  const bad = await call(tool(ctx), { items: [{ op: "remove", target: "- Use yarn.", reason: "Gone." }] });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /No longer in memory/);
  assert.equal(await latest(ctx.project.id), undefined);
  const missingText = await call(tool(ctx), { items: [{ op: "replace", target: "- Use pnpm.", reason: "x" }] });
  assert.equal(missingText.isError, true);
  const runId = crypto.randomUUID();
  const empty = await call(tool(ctx, { kind: "routine", routineId: "r", runId, routineName: "Memory upkeep" }), { items: [] });
  assert.match(empty.text, /Nothing to propose/);
  const proposal = await latest(ctx.project.id);
  assert.equal(proposal.status, "empty");
  assert.equal(proposal.origin, "upkeep");
  assert.equal(proposal.runId, runId);
  assert.equal(await card(proposal.id), undefined);
  assert.equal(await service.runProposed(runId), true);
});

test("apply with memory unchanged writes MEMORY.md, the sidecar, and resolves the card", async () => {
  const ctx = await context("apply");
  await call(tool(ctx), { items: ITEMS });
  const proposal = await latest(ctx.project.id);
  const review = await service.reviewMemoryProposal(proposal.id);
  const result = await service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: review.memoryHash });
  assert.equal(result.applied, true);
  assert.equal(await fs.readFile(ctx.file, "utf8"), "# Project memory\n\n- Use npm; pnpm was dropped.\n- Tests live in tests/.\n- Retry the flaky upload test once.\n");
  const sidecar = await readSidecar(ctx.project.dataKey);
  const workaround = sidecar[entryKey("- Retry the flaky upload test once.")];
  assert.equal(workaround.kind, "workaround");
  assert.deepEqual(workaround.sources, [{ type: "task", id: "t1" }]);
  assert.match(workaround.reviewAfter, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(new Date(workaround.reviewAfter) > new Date(Date.now() + 80 * 86_400_000), "workarounds default to a review date ~90 days out");
  assert.equal(sidecar[entryKey("- Use npm; pnpm was dropped.")].kind, "decision");
  assert.equal(sidecar[entryKey("- Use npm; pnpm was dropped.")].reviewAfter, null);
  assert.equal(path.basename(sidecarFile(ctx.project.dataKey)), "sources.json");
  assert.equal((await card(proposal.id)).status, "resolved");
  assert.equal((await proposals.getMemoryProposal(proposal.id)).status, "applied");
  await assert.rejects(service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: "x" }), { status: 409 });
});

test("apply after a concurrent memory change re-matches by target, and flags items that no longer match", async () => {
  const ctx = await context("concurrent");
  await call(tool(ctx), { items: ITEMS });
  const proposal = await latest(ctx.project.id);
  const { memoryHash: seen } = await service.reviewMemoryProposal(proposal.id);
  // Someone edits memory but keeps "- Use pnpm.": the replace still matches, so the apply goes through.
  await fs.writeFile(ctx.file, `${MEMORY}- Deploys pull every minute.\n`);
  const ok = await service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: seen });
  assert.equal(ok.applied, true);
  assert.match(await fs.readFile(ctx.file, "utf8"), /- Use npm; pnpm was dropped\.\n- Tests live in tests\/\.\n- Deploys pull every minute\.\n- Retry the flaky upload test once\.\n$/);

  const other = await context("concurrent-flag");
  await call(tool(other), { items: ITEMS });
  const second = await latest(other.project.id);
  const review = await service.reviewMemoryProposal(second.id);
  const changed = "# Project memory\n\n- Use npm.\n- Tests live in tests/.\n";
  await fs.writeFile(other.file, changed);
  const flagged = await service.applyMemoryProposal(second.id, { choices: acceptAll(second), memoryHash: review.memoryHash });
  assert.equal(flagged.applied, false);
  assert.equal(flagged.changed, true);
  assert.equal(await fs.readFile(other.file, "utf8"), changed, "nothing is written while an accepted item is flagged");
  const replace = flagged.review.proposal.items.find((i) => i.op === "replace");
  assert.equal(replace.flag, "No longer in memory");
  assert.equal(flagged.review.proposal.items.find((i) => i.op === "add").flag, null);
  assert.equal(flagged.review.proposal.baseHash, memoryHash(changed));
  assert.equal((await card(second.id)).status, "open");
  // Reject the flagged item and apply the rest.
  const retry = await service.applyMemoryProposal(second.id, { choices: [{ id: replace.id, decision: "rejected" }, ...second.items.filter((i) => i.id !== replace.id).map((i) => ({ id: i.id, decision: "accepted" }))], memoryHash: flagged.review.memoryHash });
  assert.equal(retry.applied, true);
  assert.equal(await fs.readFile(other.file, "utf8"), `${changed}- Retry the flaky upload test once.\n`);
  assert.equal(retry.proposal.items.find((i) => i.id === replace.id).decision, "rejected");
});

test("an edited item lands as edited; replace and remove move and drop sidecar entries", async () => {
  const ctx = await context("sidecar");
  await call(tool(ctx), { items: [{ op: "add", text: "- Cache builds.", kind: "decision", reason: "Speed.", sources: [{ type: "session", id: "s1" }] }] });
  let proposal = await latest(ctx.project.id);
  let review = await service.reviewMemoryProposal(proposal.id);
  await service.applyMemoryProposal(proposal.id, { choices: [{ id: proposal.items[0].id, decision: "accepted", text: "- Cache builds in CI." }], memoryHash: review.memoryHash });
  assert.match(await fs.readFile(ctx.file, "utf8"), /- Cache builds in CI\.\n$/);
  assert.equal((await proposals.getMemoryProposal(proposal.id)).items[0].editedText, "- Cache builds in CI.");
  assert.ok((await readSidecar(ctx.project.dataKey))[entryKey("- Cache builds in CI.")]);

  await call(tool(ctx), { items: [
    { op: "replace", target: "- Cache builds in CI.", text: "- Cache builds in CI and locally.", kind: "decision", reason: "Both.", sources: [{ type: "note", id: "n1" }] },
    { op: "remove", target: "- Tests live in tests/.", reason: "Obvious." },
  ] });
  proposal = await latest(ctx.project.id);
  review = await service.reviewMemoryProposal(proposal.id);
  await service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: review.memoryHash });
  const sidecar = await readSidecar(ctx.project.dataKey);
  assert.equal(sidecar[entryKey("- Cache builds in CI.")], undefined);
  assert.deepEqual(sidecar[entryKey("- Cache builds in CI and locally.")].sources.map((s) => s.type), ["session", "note"], "a replace keeps the old sources");
  assert.doesNotMatch(await fs.readFile(ctx.file, "utf8"), /Tests live/);
});

test("Edit as document writes the edited document, and refuses when memory changed meanwhile", async () => {
  const ctx = await context("document");
  await call(tool(ctx), { items: ITEMS });
  const proposal = await latest(ctx.project.id);
  const review = await service.reviewMemoryProposal(proposal.id);
  await fs.writeFile(ctx.file, `${MEMORY}more\n`);
  await assert.rejects(service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: review.memoryHash, document: "# Mine" }), { status: 409 });
  const fresh = await service.reviewMemoryProposal(proposal.id);
  const document = "# Project memory\n\n- Use npm; pnpm was dropped.\n- Tests live in tests/.\n- more";
  const result = await service.applyMemoryProposal(proposal.id, { choices: acceptAll(proposal), memoryHash: fresh.memoryHash, document });
  assert.equal(result.applied, true);
  assert.equal(await fs.readFile(ctx.file, "utf8"), `${document}\n`);
  const sidecar = await readSidecar(ctx.project.dataKey);
  assert.ok(sidecar[entryKey("- Use npm; pnpm was dropped.")], "items whose text made it into the document are sourced");
  assert.equal(sidecar[entryKey("- Retry the flaky upload test once.")], undefined, "items edited out of the document are not");
});

test("reject resolves the card and leaves memory alone", async () => {
  const ctx = await context("reject");
  await call(tool(ctx), { items: ITEMS });
  const proposal = await latest(ctx.project.id);
  const rejected = await service.rejectMemoryProposal(proposal.id);
  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.items.every((i) => i.decision === "rejected"));
  assert.equal((await card(proposal.id)).status, "resolved");
  assert.equal(await fs.readFile(ctx.file, "utf8"), MEMORY);
});

test("the Harvest proposal session is read-only and its brief carries memory, sources and finished tasks", async () => {
  const origin = { kind: "memory", purpose: "harvest" };
  assert.equal(readOnlySession(origin), true);
  assert.match(readOnlyDenial(origin, "Edit writes files"), /memory_propose/);
  const ctx = await context("brief");
  await fs.writeFile(paths.workspaceMemoryFile(ctx.project.dataKey, ctx.workspace.slug), "# Task log\nLearned: retry uploads.\n");
  const done = await insertTask({ projectId: ctx.project.id, workspaceId: ctx.workspace.id, title: "Fix uploads", body: "They flake." });
  await updateTask(done.id, { status: "done" });
  await insertTask({ projectId: ctx.project.id, workspaceId: ctx.workspace.id, title: "Still open" });
  const brief = await harvestBrief(ctx);
  assert.match(brief, /Learned: retry uploads/);
  assert.match(brief, /- Use pnpm\./);
  assert.match(brief, /<memory_sources/);
  assert.match(brief, new RegExp(`<task id="${done.id}"`));
  assert.doesNotMatch(brief, /Still open/);
  assert.match(brief, /memory_propose/);
});

test("proposals round-trip through Postgres", async (t) => {
  const { testDb } = require("./helpers/test-db.cjs");
  const db = await testDb();
  t.after(() => { server.db = () => null; return db.close(); });
  const [p] = await db.query("insert into projects (name, data_key, slug) values ('P', 'p', 'p') returning id");
  server.db = () => db;
  const created = await proposals.insertMemoryProposal({ projectId: p.id, origin: "harvest", baseHash: "abc", summary: "S", items: [
    { op: "add", target: null, text: "- A", kind: "workaround", sources: [{ type: "task", id: "t" }], reason: "r", reviewAfter: "2027-01-31" },
    { op: "remove", target: "- B", text: null, kind: null, sources: [], reason: "r2", reviewAfter: null },
  ] });
  assert.equal(created.items.length, 2);
  assert.equal(created.items[0].reviewAfter, "2027-01-31");
  assert.deepEqual(created.items[0].sources, [{ type: "task", id: "t" }]);
  const updated = await proposals.updateMemoryProposal(created.id, { status: "applied", baseHash: "def" }, [{ id: created.items[1].id, decision: "rejected", flag: "No longer in memory" }]);
  assert.equal(updated.status, "applied");
  assert.ok(updated.resolvedAt);
  assert.equal(updated.baseHash, "def");
  assert.equal(updated.items[1].decision, "rejected");
  assert.equal(updated.items[1].flag, "No longer in memory");
  assert.equal(updated.items[0].decision, "pending");
  assert.equal((await proposals.listMemoryProposals({ projectId: p.id })).length, 1);
  await db.query("insert into notifications (kind, urgency, project_id, subject_key, title, href) values ('memory_proposal', 'action', $1, 'memory-proposal:x', 'T', '/inbox')", [p.id]);
});
