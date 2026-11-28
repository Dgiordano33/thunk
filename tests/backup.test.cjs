/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server TypeScript through the installed compiler. */
const { test } = require("node:test");
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
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "@/lib/db/server") return { db: () => null, dbSession: () => null, hasDatabase: () => false, describeDatabase: () => "memory only (test)" };
  if (request === "@/lib/server/info") return { serverInfo: () => ({ revision: null }) };
  return load.call(this, request, parent, isMain);
};

const { testDb } = require("./helpers/test-db.cjs");
const { loadMigrations } = require("../lib/db/migrate.ts");
const MIGRATIONS = loadMigrations(path.join(__dirname, "../db/migrations")).map((m) => m.name);
const core = () => import("../scripts/backup-core.mjs");

function tempDataDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thunk-backup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "thunk");
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true }); fs.writeFileSync(path.join(dataDir, rel), text); };
  write("projects/demo/notes/plan.md", "# Plan\n");
  write("projects/demo/memory/MEMORY.md", "remember\n");
  write("config/integrations.json", '{"token":"secret"}');
  write("homes/demo/scratch.txt", "x");
  return { root, dataDir, write };
}

test("backup → restore round-trips files and every table, and keeps the old data aside", async (t) => {
  const { createBackup, restoreBackup } = await core();
  const { root, dataDir, write } = tempDataDir(t);
  const claudeDir = path.join(root, ".claude");
  fs.mkdirSync(path.join(claudeDir, "projects", "-src"), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "projects", "-src", "s1.jsonl"), "{}\n");

  const source = await testDb();
  t.after(() => source.close());
  const [p] = await source.query("insert into projects (name, data_key, slug, updated_at) values ('Demo', 'demo', 'demo', '2026-01-02T03:04:05.123456Z') returning id");
  await source.query("insert into routines (project_id, name, prompt, model, enabled, events) values ($1, 'Nightly', 'go', 'm', true, '{pr_opened}')", [p.id]);

  const outDir = path.join(dataDir, "backups");
  const backup = await createBackup({ dataDir, outDir, db: source, claudeDir, version: "abc1234", now: new Date("2026-11-27T03:00:00.000Z") });
  assert.equal(backup.name, "thunk-2026-11-27T03-00-00-000Z.tar.gz");
  assert.equal(fs.statSync(backup.file).mode & 0o777, 0o600);
  assert.equal(backup.manifest.version, "abc1234");
  assert.equal(backup.manifest.migration, MIGRATIONS.at(-1));
  assert.equal(backup.manifest.tables.projects.rows, 1);
  assert.deepEqual(backup.manifest.files, { projects: 2, config: 1, homes: 1, ".claude/projects": 1 });
  assert.deepEqual(fs.readdirSync(outDir), [backup.name], "staging files are cleaned up");

  // Things go wrong after the backup.
  fs.rmSync(path.join(dataDir, "projects/demo/notes/plan.md"));
  write("projects/demo/notes/later.md", "new");
  fs.rmSync(path.join(claudeDir, "projects"), { recursive: true });

  const target = await testDb();
  let closed = false;
  const result = await restoreBackup({
    archive: backup.file, dataDir, claudeDir, migrations: MIGRATIONS, now: new Date("2026-11-28T00:00:00.000Z"),
    openDatabase: async () => ({ ...target, close: async () => { closed = true; await target.close(); }, external: false }),
  });
  assert.ok(closed);
  assert.equal(result.counts.projects, 1);
  assert.equal(fs.readFileSync(path.join(dataDir, "projects/demo/notes/plan.md"), "utf8"), "# Plan\n");
  assert.ok(!fs.existsSync(path.join(dataDir, "projects/demo/notes/later.md")));
  assert.equal(fs.readFileSync(path.join(dataDir, "config/integrations.json"), "utf8"), '{"token":"secret"}');
  assert.ok(fs.existsSync(path.join(dataDir, "backups", backup.name)), "the backups folder comes along");
  assert.equal(result.aside, `${dataDir}.before-restore-2026-11-28T00-00-00-000Z`);
  assert.ok(fs.existsSync(path.join(result.aside, "projects/demo/notes/later.md")));
  assert.ok(fs.existsSync(path.join(claudeDir, "projects", "-src", "s1.jsonl")));
  assert.ok(!fs.readdirSync(root).some((name) => name.includes(".restoring-")));
});

test("restored rows keep their values, and routines stay as they were", async (t) => {
  const { createBackup, restoreBackup } = await core();
  const { dataDir } = tempDataDir(t);
  const source = await testDb();
  t.after(() => source.close());
  const [p] = await source.query("insert into projects (name, data_key, slug, updated_at) values ('Demo', 'demo', 'demo', '2026-01-02T03:04:05.123456Z') returning id");
  await source.query("insert into routines (project_id, name, prompt, model, enabled, events) values ($1, 'Nightly', 'go', 'm', true, '{pr_opened}')", [p.id]);
  const backup = await createBackup({ dataDir, outDir: path.join(dataDir, "backups"), db: source });
  const target = await testDb();
  t.after(() => target.close().catch(() => {}));
  await restoreBackup({ archive: backup.file, dataDir, migrations: MIGRATIONS, openDatabase: async () => ({ ...target, close: async () => {}, external: false }) });
  const [project] = await target.query("select name, updated_at from projects");
  assert.deepEqual([project.name, project.updated_at], ["Demo", "2026-01-02T03:04:05.123456+00:00"]);
  const [routine] = await target.query("select enabled, events from routines");
  assert.deepEqual([routine.enabled, routine.events], [true, ["pr_opened"]]);
});

test("restore refuses while a live Thunk holds the lock, and refuses a backup from a newer checkout", async (t) => {
  const { createBackup, restoreBackup } = await core();
  const { dataDir } = tempDataDir(t);
  const backup = await createBackup({ dataDir, outDir: path.join(dataDir, "backups"), db: null });
  const openDatabase = async () => { throw new Error("must not open"); };

  fs.mkdirSync(path.join(dataDir, "db"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "db", "thunk.lock"), String(process.ppid));
  await assert.rejects(restoreBackup({ archive: backup.file, dataDir, migrations: MIGRATIONS, openDatabase }), new RegExp(`pid ${process.ppid}`));
  assert.ok(fs.existsSync(path.join(dataDir, "projects/demo/notes/plan.md")), "nothing moved");
  fs.rmSync(path.join(dataDir, "db", "thunk.lock"));

  const source = await testDb();
  t.after(() => source.close());
  await source.query("insert into thunk_migrations (name) values ('29990101000000_9999_future')");
  const newer = await createBackup({ dataDir, outDir: path.join(dataDir, "backups"), db: source, now: new Date(Date.now() + 1000) });
  await assert.rejects(restoreBackup({ archive: newer.file, dataDir, migrations: MIGRATIONS, openDatabase }), /9999_future/);
  assert.ok(fs.existsSync(path.join(dataDir, "projects/demo/notes/plan.md")), "nothing moved");
  assert.ok(!fs.existsSync(`${dataDir}.before-restore`));
});

test("a failed table load puts the previous data dir back", async (t) => {
  const { createBackup, restoreBackup } = await core();
  const { dataDir } = tempDataDir(t);
  const source = await testDb();
  t.after(() => source.close());
  const backup = await createBackup({ dataDir, outDir: path.join(dataDir, "backups"), db: source });
  fs.writeFileSync(path.join(dataDir, "projects/demo/notes/plan.md"), "edited");
  await assert.rejects(restoreBackup({ archive: backup.file, dataDir, migrations: MIGRATIONS, openDatabase: async () => { throw new Error("db down"); } }), /db down/);
  assert.equal(fs.readFileSync(path.join(dataDir, "projects/demo/notes/plan.md"), "utf8"), "edited");
  assert.ok(fs.existsSync(path.join(dataDir, "backups", backup.name)));
  assert.ok(!fs.readdirSync(path.dirname(dataDir)).some((name) => name.includes("before-restore")));
});

test("the server's backup runs inside PGlite's transaction and holds writes back until it is done", async (t) => {
  const { createBackup } = await core();
  const { dataDir } = tempDataDir(t);
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("create table public.t (id int); insert into public.t values (1), (2);");
  const backup = pg.transaction((tx) => createBackup({ dataDir, outDir: path.join(dataDir, "backups"), db: { query: async (s, p) => (await tx.query(s, p)).rows }, begin: false }));
  const write = pg.query("insert into public.t values (3)");
  assert.equal((await backup).manifest.tables.t.rows, 2);
  await write;
  assert.equal((await pg.query("select count(*)::int as n from t")).rows[0].n, 3);
});

test("pruning keeps the newest archives and ignores other files", async (t) => {
  const { createBackup, listBackups, pruneBackups } = await core();
  const { dataDir } = tempDataDir(t);
  const outDir = path.join(dataDir, "backups");
  for (const day of [1, 2, 3, 4]) await createBackup({ dataDir, outDir, db: null, now: new Date(`2026-11-0${day}T03:00:00.000Z`) });
  fs.writeFileSync(path.join(outDir, "notes.txt"), "mine");
  assert.deepEqual(await pruneBackups(outDir, 2), ["thunk-2026-11-02T03-00-00-000Z.tar.gz", "thunk-2026-11-01T03-00-00-000Z.tar.gz"]);
  assert.deepEqual((await listBackups(outDir)).map((b) => b.createdAt), ["2026-11-04T03:00:00.000Z", "2026-11-03T03:00:00.000Z"]);
  assert.ok(fs.existsSync(path.join(outDir, "notes.txt")));
});

test("the schedule is due once the newest archive predates today's slot", () => {
  const { lastSlot, BackupInput } = require("../lib/backup/service.ts");
  const settings = { time: "03:00", tz: "UTC" };
  assert.equal(lastSlot(settings, new Date("2026-11-27T02:59:00Z")).toISOString(), "2026-11-26T03:00:00.000Z");
  assert.equal(lastSlot(settings, new Date("2026-11-27T03:00:00Z")).toISOString(), "2026-11-27T03:00:00.000Z");
  assert.equal(lastSlot(settings, new Date("2026-11-27T18:00:00Z")).toISOString(), "2026-11-27T03:00:00.000Z");
  assert.equal(BackupInput.safeParse({ enabled: true, time: "25:00", keep: 7 }).success, false);
  assert.equal(BackupInput.safeParse({ enabled: true, time: "03:00", keep: 0 }).success, false);
  assert.equal(BackupInput.safeParse({ enabled: true, time: "03:00", keep: 7, dir: "relative/dir" }).success, false);
  assert.equal(BackupInput.safeParse({ enabled: false, time: "03:00", keep: 14, tz: "Europe/Berlin", dir: "/mnt/backups" }).success, true);
});
