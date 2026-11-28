/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through the installed compiler. */
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    const base = path.join(__dirname, "..", request.slice(2));
    request = fs.existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, "index.ts");
  }
  return resolve.call(this, request, ...rest);
};

let current = null;
let workspaceContext = null;
const drivers = [];
const stubs = {
  "server-only": {},
  "@/lib/db/server": { db: () => current, hasDatabase: () => Boolean(current) },
  "../server": { db: () => current, hasDatabase: () => Boolean(current) },
  "@/lib/env": { env: { DEFAULT_MODEL: "claude-test" } },
  "@/lib/projects": { getWorkspaceContext: async () => workspaceContext },
  "@/lib/projects/checkouts": { restoreCheckouts: async () => false },
  "@/lib/projects/checkpoints": {},
  "@/lib/projects/repo-targets": { workspaceRepoTargets: () => [] },
  "@/lib/projects/repos": { sessionConfigRoot: () => "/tmp" },
  "@/lib/projects/runtime": {},
  "@/lib/prompts/context": { expandCommand: async (text) => text },
  "./transcripts": { deleteTranscripts: async () => {}, ensureTranscriptAt: async () => {} },
  "./codex/driver": {},
  // A runtime that answers each message with one turn result and exits when told to.
  "./claude-driver": {
    createClaudeDriver: async (live) => {
      let end;
      const done = new Promise((r) => { end = r; });
      const driver = {
        isClosed: false,
        run: () => done,
        send: () => {
          const registry = require("../lib/agent/session-registry.ts");
          registry.emit(live, { type: "result", subtype: "success", isError: false, costUsd: 0.25, numTurns: 1, durationMs: 5, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3, cacheCreationTokens: 4 } });
          registry.setState(live, "idle");
        },
        interrupt: async () => {}, setModel: async () => {}, setPermissionMode: async () => {},
        close() { this.isClosed = true; end(); },
        end: () => end(),
      };
      drivers.push(driver);
      return driver;
    },
  },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
  return Object.hasOwn(stubs, request) ? stubs[request] : load.call(this, request, parent, isMain);
};

const agent = require("../lib/agent/index.ts");
const { insertEvents } = require("../lib/db/repo/messages.ts");
const { summarizeUsage } = require("../lib/ambient/summary.ts");
const stream = require("../app/api/sessions/[id]/stream/route.ts");
const sessionRoute = require("../app/api/sessions/[id]/route.ts");
const usage = require("../app/api/ambient/usage/route.ts");
const { testDb } = require("./helpers/test-db.cjs");
const { migrate, loadMigrations } = require("../lib/db/migrate.ts");
const MIGRATIONS = loadMigrations(path.join(__dirname, "../db/migrations"));

const registry = () => globalThis.__thunkRegistry;
after(() => registry().clear());

async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("Timed out");
}
const params = (id) => ({ params: Promise.resolve({ id }) });
const streamRequest = (id, since) => ({ nextUrl: new URL(`http://x/api/sessions/${id}/stream?since=${since}`), headers: new Headers(), signal: new AbortController().signal });
function parseSse(text) {
  return text.split("\n\n").filter(Boolean).map((block) => {
    const fields = Object.fromEntries(block.split("\n").filter((l) => !l.startsWith(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    return fields;
  }).filter((f) => Object.keys(f).length);
}

async function seedWorkspace(db) {
  const [p] = await db.query("insert into projects (name, data_key, slug) values ('Town', 'town', 'town') returning id");
  const [w] = await db.query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'main', 'main', '/tmp') returning id", [p.id]);
  return { projectId: p.id, workspaceId: w.id };
}

test("an ended session leaves memory after 30 idle minutes, replays from the database and resumes", async (t) => {
  current = await testDb();
  t.after(() => { current.close(); current = null; });
  const { projectId, workspaceId } = await seedWorkspace(current);
  workspaceContext = { project: { id: projectId, kind: "folder", repos: [] }, workspace: { id: workspaceId, cwd: "/tmp", status: "active", repos: [] } };

  const live = await agent.startSession({ workspaceId, model: "claude-test" });
  agent.pushUserMessage(live, "hello");
  // The runtime exits on its own: the session parks as closed and stays registered.
  drivers.at(-1).end();
  await eventually(() => live.meta.status === "closed");
  const lastSeq = live.seq;
  await eventually(async () => (await current.query("select max(seq)::int as seq from messages where session_id = $1", [live.id]))[0].seq === lastSeq);
  const [row] = await current.query("select * from usage_results where session_id = $1", [live.id]);
  assert.deepEqual([row.workspace_id, row.project_id, Number(row.cost_usd), Number(row.input_tokens), Number(row.output_tokens), Number(row.cache_read_tokens), Number(row.cache_creation_tokens)], [workspaceId, projectId, 0.25, 10, 20, 3, 4]);
  // Replaying the stored batch doesn't add a second usage row.
  await insertEvents(live.id, live.events.filter((e) => e.type === "result"));
  assert.equal((await current.query("select count(*)::int as n from usage_results")).at(0).n, 1);

  // Too recent, or watched: the sweep keeps it.
  assert.deepEqual(agent.sweepIdleSessions(Date.now()), []);
  const unsubscribe = agent.subscribe(live, () => {}, { viewer: true });
  assert.deepEqual(agent.sweepIdleSessions(Date.now() + 31 * 60_000), []);
  unsubscribe();
  // Memory-only mode never sweeps: the registry is the only copy.
  const db = current; current = null;
  assert.deepEqual(agent.sweepIdleSessions(Date.now() + 31 * 60_000), []);
  current = db;
  assert.deepEqual(agent.sweepIdleSessions(Date.now() + 31 * 60_000), [live.id]);
  assert.equal(agent.getSession(live.id), undefined);
  // Sweeping an ended session doesn't announce it again.
  assert.equal(live.seq, lastSeq);

  // Opening it: metadata says not live, and the stream replays the tail from the database, then stops.
  const meta = await (await sessionRoute.GET(new Request("http://x"), params(live.id))).json();
  assert.equal(meta.session.live, false);
  assert.equal(meta.session.status, "closed");
  const res = await stream.GET(streamRequest(live.id, 2), params(live.id));
  assert.equal(res.status, 200);
  const blocks = parseSse(await res.text());
  const replayed = blocks.filter((b) => b.data && !b.event).map((b) => JSON.parse(b.data));
  assert.deepEqual(replayed.map((e) => e.seq), live.events.filter((e) => e.seq > 2).map((e) => e.seq));
  assert.equal(blocks.at(-1).event, "not_live");
  assert.equal((await stream.GET(streamRequest(crypto.randomUUID(), 0), params(crypto.randomUUID()))).status, 404);

  // Resume rebuilds the entry from the database and keeps numbering.
  const resumed = await agent.resumeSession(live.id);
  assert.notEqual(resumed, live);
  assert.deepEqual(resumed.events.slice(0, live.events.length).map((e) => e.seq), live.events.map((e) => e.seq));
  assert.ok(resumed.seq > lastSeq);
  agent.pushUserMessage(resumed, "again");
  assert.equal(resumed.events.findLast((e) => e.type === "result").seq > lastSeq, true);
  await eventually(async () => (await current.query("select count(*)::int as n from usage_results where session_id = $1", [live.id]))[0].n === 2);
  agent.closeSession(resumed.id);
});

/** The endpoint's previous computation: every stored result message, plus every live result. */
async function oldUsage(db, live, timeZone) {
  const entries = [];
  const workspaceBySession = new Map();
  const rows = await db.query("select m.session_id, m.seq, m.content_json, s.workspace_id from messages m left join sessions s on s.id = m.session_id where m.type = 'result'");
  for (const row of rows) {
    entries.push({ sessionId: row.session_id, seq: row.seq, ts: row.content_json.ts, costUsd: row.content_json.costUsd });
    if (row.workspace_id) workspaceBySession.set(row.session_id, row.workspace_id);
  }
  for (const l of live) {
    workspaceBySession.set(l.id, l.meta.workspaceId);
    for (const e of l.events) if (e.type === "result") entries.push({ sessionId: l.id, seq: e.seq, ts: e.ts, costUsd: e.costUsd });
  }
  return summarizeUsage(entries, workspaceBySession, timeZone);
}

function assertClose(actual, expected) {
  assert.equal(actual.days.length, expected.days.length, JSON.stringify({ actual, expected }));
  assert.ok(Math.abs(actual.total - expected.total) < 1e-9, `total ${actual.total} vs ${expected.total}`);
  for (const [i, day] of expected.days.entries()) {
    assert.equal(actual.days[i].name, day.name);
    assert.ok(Math.abs(actual.days[i].cost - day.cost) < 1e-9);
  }
  assert.deepEqual(actual.workspaces.map((w) => w.id).sort(), expected.workspaces.map((w) => w.id).sort());
  for (const w of expected.workspaces) assert.ok(Math.abs(actual.workspaces.find((a) => a.id === w.id).cost - w.cost) < 1e-9);
}

test("usage backfills from stored results and matches the old computation, including unflushed live results", async (t) => {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { isoTimestamp } = require("../lib/db/sql.ts");
  const pg = new PGlite({ parsers: { [types.INT8]: Number, [types.NUMERIC]: Number, [types.TIMESTAMPTZ]: isoTimestamp, [types.TIMESTAMP]: isoTimestamp } });
  t.after(() => pg.close());
  await pg.exec("set timezone = 'UTC'");
  const exec = (sql) => pg.exec(sql).then(() => {});
  const query = async (sql, p) => (await pg.query(sql, p)).rows;
  const usageMigration = MIGRATIONS.findIndex((m) => m.name.endsWith("_usage_results"));
  assert.ok(usageMigration > 0);
  await migrate(exec, query, MIGRATIONS.slice(0, usageMigration));

  const a = await seedWorkspace({ query });
  const [w2] = await query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'b', 'b', '/b') returning id", [a.projectId]);
  const s1 = crypto.randomUUID(), s2 = crypto.randomUUID(), s3 = crypto.randomUUID();
  for (const [id, ws] of [[s1, a.workspaceId], [s2, w2.id], [s3, w2.id]])
    await query("insert into sessions (id, workspace_id, cwd, model, permission_mode) values ($1, $2, '/tmp', 'm', 'default')", [id, ws]);
  const result = (seq, ts, costUsd, extra = {}) => ({ type: "result", subtype: "success", isError: false, numTurns: 1, durationMs: 1, seq, ts, costUsd, ...extra });
  const stored = [
    [s1, result(1, Date.parse("2026-11-20T02:30:00Z"), 0.1)], // the 19th in New York
    [s1, result(2, Date.parse("2026-11-20T12:00:00Z"), 0.2, { usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 8 } })],
    [s1, result(3, Date.parse("2026-11-20T23:45:00Z"), 1 / 3)], // the 21st in Kolkata
    [s2, result(1, Date.parse("2026-11-21T09:00:00Z"), 1.5)],
    [s2, result(2, Date.parse("2026-11-21T10:00:00Z"), -1)], // skipped
    [s2, result(3, Date.parse("2026-11-21T11:00:00Z"), "7")], // skipped: not a number
    [s3, result(1, Date.parse("2026-11-22T08:00:00Z"), 0)],
    [s3, result(2, Date.parse("2026-11-22T09:00:00Z"), 0.05)], // also still in a live session's memory
  ];
  for (const [sessionId, e] of stored)
    await query("insert into messages (session_id, seq, type, role, content_json, created_at) values ($1, $2, 'result', 'system', $3, $4)", [sessionId, e.seq, JSON.stringify(e), new Date(e.ts).toISOString()]);
  // An event missing its time and cost still backfills (the old computation would have thrown on it).
  const broken = crypto.randomUUID();
  await query("insert into sessions (id, workspace_id, cwd, model, permission_mode) values ($1, $2, '/tmp', 'm', 'default')", [broken, a.workspaceId]);
  await query("insert into messages (session_id, seq, type, role, content_json, created_at) values ($1, 1, 'result', 'system', $2, '2026-11-23T05:00:00Z')", [broken, JSON.stringify({ type: "result", seq: 1 })]);

  await migrate(exec, query, MIGRATIONS);
  const rows = await query("select session_id, seq, workspace_id, project_id, day::text as day, ts, cost_usd, input_tokens from usage_results order by ts");
  assert.equal(rows.length, stored.length + 1);
  const backfilled = rows.find((r) => r.session_id === broken);
  assert.equal(Date.parse(backfilled.ts), Date.parse("2026-11-23T05:00:00Z"));
  assert.deepEqual({ ...backfilled, ts: undefined }, { session_id: broken, seq: 1, workspace_id: a.workspaceId, project_id: a.projectId, day: "2026-11-23", ts: undefined, cost_usd: null, input_tokens: null });
  assert.equal(rows.find((r) => r.session_id === s1 && r.seq === 2).input_tokens, 5);
  assert.equal(rows.filter((r) => r.cost_usd === null).length, 3);
  await query("delete from messages where session_id = $1", [broken]);
  await query("delete from usage_results where session_id = $1", [broken]);

  // Live: s3 has one stored result and one not yet flushed; an unpersisted session has only memory.
  const liveSessions = [
    { id: s3, meta: { workspaceId: w2.id }, events: [{ ...result(2, Date.parse("2026-11-22T09:00:00Z"), 0.05), sessionId: s3 }, { ...result(4, Date.parse("2026-11-23T01:00:00Z"), 0.4), sessionId: s3 }] },
    { id: "memory-only", meta: { workspaceId: a.workspaceId }, events: [{ ...result(1, Date.parse("2026-11-23T03:00:00Z"), 0.7), sessionId: "memory-only" }] },
  ];
  for (const l of liveSessions) registry().set(l.id, l);
  t.after(() => { for (const l of liveSessions) registry().delete(l.id); });

  current = { kind: "pglite", query };
  t.after(() => { current = null; });
  for (const timeZone of ["UTC", "America/New_York", "Asia/Kolkata"]) {
    const res = await usage.GET(new Request(`http://x/api/ambient/usage?timeZone=${encodeURIComponent(timeZone)}`));
    const body = await res.json();
    assert.equal(body.persistent, true);
    assertClose(body, await oldUsage({ query }, liveSessions, timeZone));
  }
  const ny = await (await usage.GET(new Request("http://x/api/ambient/usage?timeZone=America/New_York"))).json();
  assert.deepEqual(ny.days.map((d) => d.name), ["2026-11-22", "2026-11-21", "2026-11-20", "2026-11-19"]);
  assert.ok(Math.abs(ny.total - (0.1 + 0.2 + 1 / 3 + 1.5 + 0 + 0.05 + 0.4 + 0.7)) < 1e-9);
  assert.equal((await usage.GET(new Request("http://x/api/ambient/usage?timeZone=Nowhere/Land"))).status, 400);
});
