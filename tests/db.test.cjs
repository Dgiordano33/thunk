/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through the installed compiler. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const ts = require("typescript");
const Module = require("node:module");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(__dirname, "..", `${request.slice(2)}.ts`);
  return resolve.call(this, request, ...rest);
};
let current = null;
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "../server" || request === "@/lib/db/server") return { db: () => current, hasDatabase: () => Boolean(current) };
  return load.call(this, request, parent, isMain);
};

const { resolveDbConfig } = require("../lib/db/config.ts");
const { insertSql, updateSql, isoTimestamp } = require("../lib/db/sql.ts");
const { migrate, loadMigrations } = require("../lib/db/migrate.ts");
const { testDb } = require("./helpers/test-db.cjs");
const MIGRATIONS = loadMigrations(path.join(__dirname, "../db/migrations"));

async function rawDb({ supabaseRoles = false } = {}) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  if (supabaseRoles) await pg.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  return { pg, exec: (sql) => pg.exec(sql).then(() => {}), query: async (sql, params) => (await pg.query(sql, params)).rows };
}

test("database config: DATABASE_URL, embedded default, memory, and a loud error for old Supabase settings", () => {
  const dir = "/data";
  assert.deepEqual(resolveDbConfig({}, dir), { kind: "pglite", dir: "/data/db" });
  assert.deepEqual(resolveDbConfig({ DATABASE_URL: "postgres://u:p@h:5432/d" }, dir), { kind: "postgres", url: "postgres://u:p@h:5432/d" });
  assert.deepEqual(resolveDbConfig({ DATABASE_URL: "postgres://x", THUNK_DATABASE: "embedded" }, dir), { kind: "pglite", dir: "/data/db" });
  assert.equal(resolveDbConfig({ THUNK_DATABASE: "memory", DATABASE_URL: "postgres://x" }, dir).kind, "memory");
  assert.equal(resolveDbConfig({ NODE_TEST_CONTEXT: "child", DATABASE_URL: "postgres://x" }, dir).kind, "memory");
  assert.equal(resolveDbConfig({ NODE_TEST_CONTEXT: "child", THUNK_DATABASE: "embedded" }, dir).kind, "pglite");
  assert.match(resolveDbConfig({ SUPABASE_URL: "https://x.supabase.co" }, dir).error, /DATABASE_URL/);
  assert.equal(resolveDbConfig({ SUPABASE_URL: "https://x.supabase.co", DATABASE_URL: "postgresql://x" }, dir).kind, "postgres");
  assert.match(resolveDbConfig({ DATABASE_URL: "https://x" }, dir).error, /postgres:\/\//);
  assert.match(resolveDbConfig({ THUNK_DATABASE: "sqlite" }, dir).error, /THUNK_DATABASE/);
  assert.match(resolveDbConfig({ THUNK_DATABASE: "postgres" }, dir).error, /needs DATABASE_URL/);
});

test("SQL builders quote identifiers, default missing values, upsert, and send jsonb as JSON", () => {
  const insert = insertSql("tasks", [{ id: "a", title: "x", actions: ["y"] }, { id: "b", events: ["e"] }], { onConflict: "id", returning: "id" });
  assert.equal(insert.text, 'insert into "tasks" ("id", "title", "actions", "events") values ($1, $2, $3, default), ($4, default, default, $5) on conflict ("id") do update set "title" = excluded."title", "actions" = excluded."actions", "events" = excluded."events" returning id');
  assert.deepEqual(insert.params, ["a", "x", '["y"]', "b", ["e"]]);
  assert.match(insertSql("t", { id: 1 }, { onConflict: "id" }).text, /do nothing$/);
  assert.match(insertSql("t", { id: 1, a: 2 }, { onConflict: "id", ignoreDuplicates: true }).text, /do nothing$/);
  const update = updateSql("tasks", { title: "t", body: undefined, origin: null }, "id = $1 and project_id = $2", ["i", "p"], "*");
  assert.equal(update.text, 'update "tasks" set "title" = $1, "origin" = $2 where id = $3 and project_id = $4 returning *');
  assert.deepEqual(update.params, ["t", null, "i", "p"]);
  assert.equal(updateSql("tasks", { body: undefined }, "id = $1", ["i"]), null);
  assert.throws(() => insertSql("tasks; drop", { id: 1 }), /Invalid SQL identifier/);
  assert.equal(isoTimestamp("2026-11-19 20:47:19.278123+00"), "2026-11-19T20:47:19.278123+00:00");
  assert.equal(isoTimestamp("2026-11-19 20:47:19+05:30"), "2026-11-19T20:47:19+05:30");
});

test("migrations apply once, in order, on plain Postgres without Supabase's roles", async (t) => {
  const db = await rawDb();
  t.after(() => db.pg.close());
  const logs = [];
  await migrate(db.exec, db.query, MIGRATIONS, { log: (m) => logs.push(m) });
  assert.equal(logs.length, MIGRATIONS.length);
  const applied = await db.query("select name from thunk_migrations order by name");
  assert.deepEqual(applied.map((r) => r.name), MIGRATIONS.map((m) => m.name));
  const [{ context }] = await db.query("select count(*)::int as context from information_schema.columns where table_name = 'routines' and column_name = 'context'");
  assert.equal(context, 1);
  logs.length = 0;
  await migrate(db.exec, db.query, MIGRATIONS, { log: (m) => logs.push(m) });
  assert.deepEqual(logs, []);
});

test("a failing migration rolls back and stops later ones", async (t) => {
  const db = await rawDb();
  t.after(() => db.pg.close());
  const broken = [MIGRATIONS[0], { name: "20990101000000_0098_broken", sql: "create table half (id int); select nope;" }, { name: "20990101000001_0099_after", sql: "create table after_broken (id int);" }];
  await assert.rejects(migrate(db.exec, db.query, broken), /Migration 20990101000000_0098_broken failed/);
  const tables = (await db.query("select to_regclass('public.half') as half, to_regclass('public.after_broken') as after")).at(0);
  assert.deepEqual(tables, { half: null, after: null });
  assert.deepEqual((await db.query("select name from thunk_migrations")).map((r) => r.name), [MIGRATIONS[0].name]);
});

test("an existing Supabase database is picked up from its migration history, and missed migrations are applied", async (t) => {
  const db = await rawDb({ supabaseRoles: true });
  t.after(() => db.pg.close());
  // A database set up by hand: all but the last two migrations, recorded by name (one under a different version, one not at all).
  const upTo = MIGRATIONS.findIndex((m) => m.name.endsWith("0013_routine_context"));
  for (const m of MIGRATIONS.slice(0, upTo)) await db.exec(m.sql);
  await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text);");
  for (const m of MIGRATIONS.slice(0, upTo)) {
    if (m.name.endsWith("0010_worker_reports")) continue;
    const [, version, name] = m.name.match(/^(\d+)_(.+)$/);
    await db.query("insert into supabase_migrations.schema_migrations values ($1, $2)", [name === "0012_repo_folder_files" ? "20261110033009" : version, name]);
  }
  const logs = [];
  await migrate(db.exec, db.query, MIGRATIONS, { log: (m) => logs.push(m) });
  assert.deepEqual(logs, [
    `recorded ${upTo - 1} migrations applied outside Thunk: ${MIGRATIONS.slice(0, upTo).map((m) => m.name.replace(/^\d+_/, "")).filter((n) => n !== "0010_worker_reports").join(", ")}`,
    `applied ${MIGRATIONS.find((m) => m.name.endsWith("0010_worker_reports")).name}`,
    ...MIGRATIONS.slice(upTo).map((m) => `applied ${m.name}`),
  ]);
  const [{ def }] = await db.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notifications_kind_check'");
  assert.match(def, /delegation_plan/);
});

test("migrations applied through Supabase after Thunk started tracking are recorded, not re-run", async (t) => {
  const db = await rawDb({ supabaseRoles: true });
  t.after(() => db.pg.close());
  const later = { name: "20991231000000_0099_later", sql: "create table later_table (id int);" };
  await migrate(db.exec, db.query, MIGRATIONS);
  // Applied by hand in Supabase (dashboard or MCP), which records it under its own version.
  await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text);");
  await db.exec(later.sql);
  await db.query("insert into supabase_migrations.schema_migrations values ('20991231120000', '0099_later')");
  const logs = [];
  await migrate(db.exec, db.query, [...MIGRATIONS, later], { log: (m) => logs.push(m) });
  assert.deepEqual(logs, ["recorded 1 migration applied outside Thunk: 0099_later"]);
  assert.equal((await db.query("select count(*)::int as n from thunk_migrations where name = $1", [later.name]))[0].n, 1);
  logs.length = 0;
  await migrate(db.exec, db.query, [...MIGRATIONS, later], { log: (m) => logs.push(m) });
  assert.deepEqual(logs, []);
});

test("an existing database without history needs THUNK_DB_BASELINE", async (t) => {
  const db = await rawDb({ supabaseRoles: true });
  t.after(() => db.pg.close());
  for (const m of MIGRATIONS) await db.exec(m.sql);
  await assert.rejects(migrate(db.exec, db.query, MIGRATIONS), /THUNK_DB_BASELINE/);
  await assert.rejects(migrate(db.exec, db.query, MIGRATIONS, { baseline: "nope" }), /no migration named nope/);
  await migrate(db.exec, db.query, MIGRATIONS, { baseline: MIGRATIONS.at(-1).name });
  assert.equal((await db.query("select count(*)::int as n from thunk_migrations"))[0].n, MIGRATIONS.length);
});

test("db:pull copies every table exactly, leaves the source alone, and turns routines off", async (t) => {
  const { pullDatabase } = await import("../scripts/db-pull-core.mjs");
  const wrap = (db) => ({ query: db.query, exec: db.exec });
  const source = await testDb();
  const target = await testDb();
  t.after(() => Promise.all([source.close(), target.close()]));
  const [p] = await source.query("insert into projects (name, data_key, slug, updated_at) values ('Prod', 'prod', 'prod', '2026-01-02T03:04:05.123456Z') returning id");
  const [w] = await source.query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'main', 'main', '/src') returning id", [p.id]);
  const sessionId = crypto.randomUUID();
  await source.query("insert into sessions (id, workspace_id, cwd, model, permission_mode, total_cost_usd, origin) values ($1, $2, '/src', 'm', 'default', 1.234567, $3)", [sessionId, w.id, JSON.stringify({ kind: "worker", tags: ["a"] })]);
  const parent = crypto.randomUUID(), child = crypto.randomUUID();
  // The child is inserted first, so a naive in-order copy would break its foreign key.
  await source.query("insert into documents (id, session_id, original_markdown, current_markdown) values ($1, $2, 'p', 'p')", [parent, sessionId]);
  await source.query("insert into documents (id, session_id, parent_document_id, original_markdown, current_markdown) values ($1, $2, $3, 'c', 'c')", [child, sessionId, parent]);
  await source.query("insert into routines (project_id, name, prompt, model, enabled, events) values ($1, 'Nightly', 'go', 'm', true, '{pr_opened}')", [p.id]);
  await target.query("insert into projects (name, data_key, slug) values ('Stale', 'stale', 'stale')");
  const before = await source.query("select to_jsonb(t) as row from projects t");

  const counts = await pullDatabase({ source: wrap(source), target: wrap(target), batch: 1 });
  assert.equal(counts.projects, 1);
  assert.equal(counts.documents, 2);
  const [project] = await target.query("select name, updated_at from projects");
  assert.deepEqual([project.name, project.updated_at], ["Prod", "2026-01-02T03:04:05.123456+00:00"]);
  const [session] = await target.query("select total_cost_usd, origin from sessions");
  assert.deepEqual([session.total_cost_usd, session.origin], [1.234567, { kind: "worker", tags: ["a"] }]);
  const [routine] = await target.query("select enabled, events from routines");
  assert.deepEqual([routine.enabled, routine.events], [false, ["pr_opened"]]);
  assert.deepEqual(await source.query("select to_jsonb(t) as row from projects t"), before);
  assert.equal((await source.query("select enabled from routines"))[0].enabled, true);
  // Triggers and foreign keys work again on the copy afterwards.
  await assert.rejects(target.query("insert into workspaces (project_id, name, slug, cwd) values ($1, 'x', 'x', '/x')", [crypto.randomUUID()]), /foreign key/);

  await source.query("insert into thunk_migrations (name) values ('29990101000000_9999_future')");
  await assert.rejects(pullDatabase({ source: wrap(source), target: wrap(target) }), /9999_future\. Pull the latest main first/);
});

test("the embedded database persists across restarts and is held by one process at a time", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-db-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const script = `
    process.env.THUNK_DATA_DIR = ${JSON.stringify(dataDir)};
    process.env.THUNK_DATABASE = "embedded";
    process.env.THUNK_MIGRATIONS_DIR = ${JSON.stringify(path.join(__dirname, "../db/migrations"))};
    const ts = require("typescript"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
    require.extensions[".ts"] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, f);
    const r = Module._resolveFilename; Module._resolveFilename = function (q, ...rest) { if (q.startsWith("@/")) q = path.join(${JSON.stringify(path.join(__dirname, ".."))}, q.slice(2) + ".ts"); return r.call(this, q, ...rest); };
    const l = Module._load; Module._load = function (q, ...rest) { return q === "server-only" ? {} : l.call(this, q, ...rest); };
    const { db, describeDatabase } = require(${JSON.stringify(path.join(__dirname, "../lib/db/server.ts"))});
    (async () => {
      const client = db();
      if (!client) { console.log(JSON.stringify({ mode: describeDatabase() })); return; }
      if (process.argv[1] === "write") await client.query("insert into projects (name, data_key, slug) values ('Kept', 'kept', 'kept')");
      const rows = await client.query("select name from projects");
      if (process.argv[1] === "hold") { console.log(JSON.stringify({ held: true })); setInterval(() => {}, 1000); return; }
      console.log(JSON.stringify({ names: rows.map((r) => r.name) }));
      process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });`;
  const { execFileSync, spawn } = require("node:child_process");
  const env = { ...process.env, NODE_TEST_CONTEXT: "" };
  const runScript = (arg) => JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "-e", script, arg], { env, encoding: "utf8" }).trim().split("\n").at(-1));
  assert.deepEqual(runScript("write"), { names: ["Kept"] });
  assert.deepEqual(runScript("read"), { names: ["Kept"] });
  const holder = spawn(process.execPath, ["--conditions=react-server", "-e", script, "hold"], { env });
  t.after(() => holder.kill());
  await new Promise((resolve) => holder.stdout.on("data", (d) => d.toString().includes("held") && resolve()));
  assert.match(runScript("read").mode, /memory only \(another Thunk process is using/);
});

test("repositories round-trip through Postgres", async (t) => {
  const db = await testDb();
  t.after(() => db.close());
  current = db;
  t.after(() => { current = null; });
  const projects = require("../lib/db/repo/projects.ts");
  const repos = require("../lib/db/repo/project-repos.ts");
  const folders = require("../lib/db/repo/repo-folders.ts");
  const workspaces = require("../lib/db/repo/workspaces.ts");
  const sessions = require("../lib/db/repo/sessions.ts");
  const messages = require("../lib/db/repo/messages.ts");
  const documents = require("../lib/db/repo/documents.ts");
  const tasks = require("../lib/db/repo/tasks.ts");
  const routines = require("../lib/db/repo/routines.ts");

  // Projects, repos and folders.
  const project = await projects.insertProject({ name: "Thunk", dataKey: "thunk-key", slug: "thunk" });
  await assert.rejects(projects.insertProject({ name: "Again", dataKey: "thunk-key", slug: "other" }), { code: "23505" });
  const repo = await repos.insertProjectRepo({ projectId: project.id, name: "thunk", path: "/src/thunk", kind: "repo", remote: "git@x:y.git", defaultBranch: "main" });
  await assert.rejects(repos.insertProjectRepo({ projectId: project.id, name: "thunk", path: "/src/thunk", kind: "repo", remote: null, defaultBranch: null }), /already in this project/);
  await repos.updateProjectRepo(repo.id, { kind: "repo", remote: null, defaultBranch: "trunk" });
  const folder = await folders.insertRepoFolder({ projectId: project.id, repoId: repo.id, path: "docs", label: "Docs" });
  assert.equal((await folders.insertRepoFolder({ projectId: project.id, repoId: repo.id, path: "docs", label: "Docs" })).id, folder.id);
  assert.deepEqual((await folders.setRepoFolderFiles(project.id, folder.id, ["a.md"])).files, ["a.md"]);
  const loaded = await projects.getProjectBySlug("thunk");
  assert.equal(loaded.repos[0].defaultBranch, "trunk");
  assert.match(loaded.repos[0].createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?\+00:00$/);
  assert.deepEqual(loaded.repoFolders.map((f) => f.files), [["a.md"]]);
  assert.equal((await projects.getProjectByKey("thunk-key")).id, project.id);
  assert.equal(await repos.findProjectIdByRepoPath("/src/thunk"), project.id);

  // Workspaces and sessions.
  const ws = await workspaces.insertWorkspace({ projectId: project.id, name: "main", slug: "main", cwd: "/src/thunk", branch: "main" });
  await repos.insertWorkspaceRepos(ws.id, [{ repoId: repo.id, cwd: "/src/thunk", branch: "main", worktreePath: null, baseRef: null }]);
  assert.deepEqual((await workspaces.getWorkspace(ws.id)).repos.map((r) => r.name), ["thunk"]);
  assert.equal((await workspaces.findWorkspace(project.id, { slug: "main" })).id, ws.id);
  assert.equal((await workspaces.findWorkspaceByCwd("/src/thunk")).id, ws.id);
  const meta = { id: crypto.randomUUID(), workspaceId: ws.id, projectId: project.id, cwd: "/src/thunk", model: "m", permissionMode: "default", status: "idle", title: "First", createdAt: new Date().toISOString(), origin: { kind: "worker" } };
  await sessions.upsertSession(meta);
  await sessions.upsertSession({ ...meta, title: "Renamed" });
  await sessions.addSessionCost(meta.id, 0.25);
  await sessions.addSessionCost(meta.id, 0.5);
  const row = await sessions.getSessionRow(meta.id);
  assert.deepEqual([row.title, row.projectId, row.totalCostUsd, row.origin], ["Renamed", project.id, 0.75, { kind: "worker" }]);
  assert.equal((await sessions.listSessionRows({ projectId: project.id })).length, 1);
  assert.deepEqual([...await sessions.workerWorkspaceIds()], [ws.id]);
  const [summary] = await workspaces.listWorkspaces(project.id);
  assert.equal(summary.sessionCount, 1);
  const [listed] = await projects.listProjects();
  assert.deepEqual([listed.workspaceCount, listed.sessionCount, typeof listed.lastActivityAt], [1, 1, "string"]);

  // Messages and documents.
  const events = [{ type: "user_message", seq: 1, ts: Date.now(), content: "hi" }, { type: "turn_complete", seq: 2, ts: Date.now(), markdown: "Done", documentId: crypto.randomUUID() }];
  const ids = await messages.insertEvents(meta.id, events);
  assert.equal(ids.size, 2);
  await messages.insertEvents(meta.id, [{ ...events[0], content: "hi again" }]);
  assert.deepEqual((await messages.loadEvents(meta.id)).map((e) => e.content ?? e.markdown), ["hi again", "Done"]);
  assert.equal(await messages.maxSeq(meta.id), 2);
  const docId = events[1].documentId;
  await documents.insertDocument({ id: docId, sessionId: meta.id, messageId: ids.get(2), kind: "response", version: 1, markdown: "Done" });
  await documents.insertDocument({ id: docId, sessionId: meta.id, kind: "response", version: 1, markdown: "ignored" });
  await documents.updateDocument(docId, { currentMarkdown: "Edited", contentJson: [{ type: "p" }], status: "sent" });
  const comment = { id: crypto.randomUUID(), documentId: docId, kind: "question", status: "open", body: "Why?", quote: "Done", from: 1, to: 5, createdAt: new Date().toISOString(), replies: [{ id: crypto.randomUUID(), body: "Because", createdAt: new Date().toISOString() }] };
  const other = { ...comment, id: crypto.randomUUID(), body: "Drop me", replies: [] };
  await documents.syncComments(docId, [comment, other]);
  await documents.syncComments(docId, [comment]);
  await documents.insertRevision({ documentId: docId, diff: "-a\n+b", payload: "p", stat: { added: 1 } });
  const [doc] = await documents.loadDocuments(meta.id);
  assert.deepEqual([doc.originalMarkdown, doc.currentMarkdown, doc.status, doc.contentJson], ["Done", "Edited", "sent", [{ type: "p" }]]);
  assert.deepEqual(doc.comments.map((c) => [c.body, c.from, c.replies.map((r) => r.body)]), [["Why?", 1, ["Because"]]]);
  assert.equal((await documents.listDocumentsForSessions([meta.id]))[0].openComments, 1);

  // Tasks.
  const first = await tasks.insertTask({ projectId: project.id, title: "One" });
  const second = await tasks.insertTask({ projectId: project.id, workspaceId: ws.id, title: "Two", sessionId: meta.id });
  assert.deepEqual([first.position, second.position], [1, 1]);
  const done = await tasks.updateTask(first.id, { status: "done" });
  assert.ok(done.completedAt);
  assert.deepEqual((await tasks.listTasks({ projectId: project.id, status: "open" })).map((x) => x.title), ["Two"]);
  assert.deepEqual((await tasks.listTasks({ workspaceId: null })).map((x) => x.title), ["One"]);
  assert.deepEqual(await tasks.countOpenTasks(), { [project.id]: { project: 0, byWorkspace: { [ws.id]: 1 } } });
  await sessions.deleteSessionRow(meta.id);
  assert.equal((await tasks.getTask(second.id)).sessionId, null);
  await tasks.deleteTask(first.id);
  assert.equal(await tasks.getTask(first.id), null);

  // Routines and runs.
  const routine = await routines.insertRoutine({ projectId: project.id, name: "Nightly", prompt: "go", model: "m", permissionMode: "default", targetKind: "ephemeral", targetWorkspaceId: null, scheduleCron: "0 3 * * *", scheduleTz: "UTC", events: ["pr_opened"], context: { notes: [], taskIds: [second.id] }, webhookToken: "tok", enabled: true, catchUp: "skip", maxRunsPerDay: 5, maxRunMinutes: 30, nextRunAt: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual(routine.context.taskIds, [second.id]);
  assert.deepEqual((await routines.listEnabledRoutines({ event: "pr_opened" })).map((r) => r.id), [routine.id]);
  assert.deepEqual(await routines.listEnabledRoutines({ event: "ci_failed" }), []);
  assert.deepEqual((await routines.listDueRoutines(new Date())).map((r) => r.id), [routine.id]);
  assert.equal(await routines.countEnabledRoutines(), 1);
  const runRow = await routines.insertRun({ routineId: routine.id, triggerSource: "cron", status: "running", triggerPayload: { a: [1] } });
  await routines.insertRun({ routineId: routine.id, triggerSource: "cron", status: "cancelled", error: "Skipped: busy" });
  assert.equal(await routines.countRunsSince(routine.id, new Date(Date.now() - 60_000)), 1);
  const finished = await routines.updateRun(runRow.id, { status: "succeeded", finishedAt: new Date().toISOString(), costUsd: 1.5, diffStat: { files: 2 } });
  assert.deepEqual([finished.costUsd, finished.diffStat, finished.triggerPayload], [1.5, { files: 2 }, { a: [1] }]);
  assert.equal((await routines.listRecentRuns(new Date(Date.now() - 60_000))).length, 1);
  const [routineSummary] = await routines.listRoutines({ projectId: project.id });
  assert.deepEqual([routineSummary.projectName, routineSummary.lastRun.id, routineSummary.runsToday], ["Thunk", runRow.id, 1]);
  assert.equal((await routines.updateRoutine(routine.id, { enabled: false })).enabled, false);
  await routines.deleteRoutine(routine.id);
  assert.equal(await routines.getRoutine(routine.id), null);

  // Cascades.
  await repos.deleteWorkspaceRepo(ws.id, repo.id);
  await workspaces.deleteWorkspace(ws.id);
  await folders.deleteRepoFolder(project.id, folder.id);
  await repos.deleteProjectRepo(repo.id);
  await projects.deleteProject(project.id);
  assert.deepEqual(await projects.listProjects(), []);
});

before(() => { delete process.env.DATABASE_URL; });
after(() => { current = null; });
