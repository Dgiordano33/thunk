/**
 * Backups of everything Thunk keeps: the files under the data dir (projects/, config/, homes/)
 * and every database table as `db/<table>.jsonl`, in one `thunk-<iso>.tar.gz` with a
 * `manifest.json`. Shared by `npm run data:backup`, `npm run data:restore` and the server's
 * daily schedule, so no server-only imports here. Archives are packed with the system `tar`.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { checkMigrations, migrationsOf, readSnapshot, writeTables } from "./db-pull-core.mjs";

export const FORMAT = 1;
/** The data dir's folders that go into every archive. */
export const FOLDERS = ["projects", "config", "homes"];
const NAME = /^thunk-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.tar\.gz$/;

const stampOf = (date) => date.toISOString().replace(/[:.]/g, "-");
export const archiveName = (date) => `thunk-${stampOf(date)}.tar.gz`;

/** The pid of a live Thunk holding the embedded database in `<dataDir>/db`, else null. */
export async function lockHolder(dataDir) {
  try {
    const pid = Number(await readFile(path.join(dataDir, "db", "thunk.lock"), "utf8"));
    if (pid > 0 && pid !== process.pid) { process.kill(pid, 0); return pid; }
  } catch {
    // No lock, or its process is gone.
  }
  return null;
}

/**
 * Takes `<dataDir>/db/thunk.lock` for this process, so a Thunk server can't open the embedded
 * database while a script has it. Returns a function that releases it.
 */
export async function takeLock(dataDir) {
  const dir = path.join(dataDir, "db");
  const lock = path.join(dir, "thunk.lock");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => rm(lock, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = await lockHolder(dataDir);
      if (pid) throw new Error(`A Thunk server (pid ${pid}) is using ${dir}. Stop it (the Mac app, a dev server or \`thunk stop\`), then run this again.`);
      await rm(lock, { force: true });
    }
  }
  throw new Error(`Could not lock ${dir}.`);
}

/** `config/backup.json`, with defaults for anything missing. */
export const BACKUP_DEFAULTS = { enabled: true, time: "03:00", tz: null, keep: 7, dir: null };
export async function readBackupConfig(dataDir) {
  const text = await readFile(path.join(dataDir, "config", "backup.json"), "utf8").catch(() => null);
  return { ...BACKUP_DEFAULTS, ...(text ? JSON.parse(text) : {}) };
}
/** Where archives go: `dir` from the config (`~` allowed), else `<dataDir>/backups`. */
export function backupDirOf(dataDir, config, home) {
  const dir = config.dir?.trim();
  return dir ? path.resolve(home ? dir.replace(/^~(?=$|\/)/, home) : dir) : path.join(dataDir, "backups");
}

function run(command, args, { stdout, cwd } = {}) {
  return new Promise((resolve, reject) => {
    // COPYFILE_DISABLE: macOS tar would otherwise add a `._` file beside each file with extended attributes.
    const child = spawn(command, args, { cwd, env: { ...process.env, COPYFILE_DISABLE: "1" }, stdio: ["ignore", stdout ? "pipe" : "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (stdout) child.stdout.pipe(stdout);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    n += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

async function writeLines(file, write) {
  const out = createWriteStream(file, { mode: 0o600 });
  const done = new Promise((resolve, reject) => { out.on("finish", resolve); out.on("error", reject); });
  await write(async (line) => { if (!out.write(`${line}\n`)) await new Promise((r) => out.once("drain", r)); });
  out.end();
  await done;
}

/** Writes every table of `db` to `<dir>/<table>.jsonl` from one snapshot. Returns rows and columns per table. */
export async function dumpTables(db, dir, { begin = true, batch = 500 } = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return readSnapshot(db, async ({ tables, columns, rows, migrations }) => {
    const counts = {};
    for (const table of tables) {
      counts[table] = { rows: 0, columns: await columns(table) };
      await writeLines(path.join(dir, `${table}.jsonl`), async (line) => {
        for await (const page of rows(table)) {
          for (const row of page) await line(JSON.stringify(row));
          counts[table].rows += page.length;
        }
      });
    }
    return { tables: counts, migrations };
  }, { begin, batch });
}

/**
 * Writes `<outDir>/thunk-<iso>.tar.gz`, mode 0600 because config/ holds integration tokens.
 * `db` is `{ query }`, or null when Thunk keeps no database; `begin: false` when the caller
 * already holds a transaction. `claudeDir` (usually ~/.claude) adds its `projects/` transcripts.
 *
 * @param {{ dataDir: string, outDir: string, db: { query: (sql: string, params?: unknown[]) => Promise<any[]> } | null,
 *   begin?: boolean, claudeDir?: string | null, version?: string | null, now?: Date }} options
 */
export async function createBackup({ dataDir, outDir, db, begin = true, claudeDir = null, version = null, now = new Date() }) {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const name = archiveName(now);
  const file = path.join(outDir, name);
  const partial = `${file}.partial`;
  const staging = await mkdtemp(path.join(outDir, ".staging-"));
  try {
    const dumped = db ? await dumpTables(db, path.join(staging, "db"), { begin }) : { tables: {}, migrations: [] };
    const folders = FOLDERS.filter((f) => existsSync(path.join(dataDir, f)));
    const files = {};
    for (const f of folders) files[f] = await countFiles(path.join(dataDir, f));
    const transcripts = claudeDir && existsSync(path.join(claudeDir, "projects")) ? `${path.basename(claudeDir)}/projects` : null;
    if (transcripts) files[transcripts] = await countFiles(path.join(claudeDir, "projects"));
    const manifest = {
      format: FORMAT,
      createdAt: now.toISOString(),
      version,
      migration: dumped.migrations.at(-1) ?? null,
      migrations: dumped.migrations,
      database: Boolean(db),
      tables: dumped.tables,
      files,
      transcripts,
    };
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    const args = ["-czf", "-", "-C", staging, "manifest.json", ...(db ? ["db"] : [])];
    if (folders.length) args.push("-C", dataDir, ...folders);
    if (transcripts) args.push("-C", path.dirname(claudeDir), transcripts);
    const out = createWriteStream(partial, { mode: 0o600 });
    const written = new Promise((resolve, reject) => { out.on("close", resolve); out.on("error", reject); });
    const { code, stderr } = await run("tar", args, { stdout: out });
    await written;
    // GNU tar exits 1 when a file changed while it was read (a note being saved); the archive is still whole.
    if (code !== 0 && !(code === 1 && /changed as we read it/.test(stderr))) throw new Error(`tar failed (${code}): ${stderr || "no output"}`);
    await chmod(partial, 0o600);
    await rename(partial, file);
    return { file, name, size: (await stat(file)).size, manifest };
  } finally {
    await rm(partial, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

/** Archives in `dir`, newest first. */
export async function listBackups(dir) {
  const names = await readdir(dir).catch(() => []);
  const backups = [];
  for (const name of names) {
    const m = NAME.exec(name);
    if (!m) continue;
    const [date, time] = m[1].split("T");
    const createdAt = new Date(`${date}T${time.replace(/^(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z")}`).toISOString();
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info?.isFile()) backups.push({ name, file: path.join(dir, name), size: info.size, createdAt });
  }
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes all but the newest `keep` archives. Returns the names removed. */
export async function pruneBackups(dir, keep) {
  const removed = [];
  for (const backup of (await listBackups(dir)).slice(Math.max(1, keep))) {
    await unlink(backup.file).catch(() => {});
    removed.push(backup.name);
  }
  return removed;
}

async function* jsonlBatches(file, batch = 500) {
  const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let rows = [];
  for await (const line of lines) {
    if (!line) continue;
    rows.push(JSON.parse(line));
    if (rows.length >= batch) { yield rows; rows = []; }
  }
  if (rows.length) yield rows;
}

/** Loads `<dir>/<table>.jsonl` files into `target` in one transaction. Tables the target lacks are skipped. */
export async function loadTables(target, dir, tables) {
  await target.exec("begin;");
  try {
    const counts = await writeTables(target, async ({ tables: targetTables, replace }) => {
      for (const [table, { columns }] of Object.entries(tables)) {
        if (targetTables.has(table) && existsSync(path.join(dir, `${table}.jsonl`))) await replace(table, columns, jsonlBatches(path.join(dir, `${table}.jsonl`)));
      }
    });
    await target.exec("commit;");
    return counts;
  } catch (error) {
    await target.exec("rollback;").catch(() => {});
    throw error;
  }
}

/**
 * Restores an archive into `dataDir`. Refuses while a live Thunk holds `<dataDir>/db/thunk.lock`.
 * The current data dir moves to `<dataDir>.before-restore-<iso>` (its backups/ folder comes along
 * to the new one), then the files are unpacked and the tables loaded.
 *
 * `openDatabase()` is called once the new data dir is in place and returns a migrated
 * `{ query, exec, close, external }`; `external` is true for DATABASE_URL, whose current rows are
 * first written to `<aside>/db/` since there is no folder to move aside.
 */
export async function restoreBackup({ archive, dataDir, openDatabase, migrations, claudeDir = null, now = new Date(), log = () => {} }) {
  const pid = await lockHolder(dataDir);
  if (pid) throw new Error(`A Thunk server (pid ${pid}) is using ${path.join(dataDir, "db")}. Stop it (the Mac app, a dev server or \`thunk stop\`), then run this again.`);
  const stamp = stampOf(now);
  const work = `${dataDir}.restoring-${stamp}`;
  const aside = `${dataDir}.before-restore-${stamp}`;
  await mkdir(work, { recursive: true, mode: 0o700 });
  let moved = false;
  try {
    const { code, stderr } = await run("tar", ["-xzf", path.resolve(archive), "-C", work]);
    if (code !== 0) throw new Error(`Could not unpack ${archive}: ${stderr || `tar exited ${code}`}`);
    const manifest = JSON.parse(await readFile(path.join(work, "manifest.json"), "utf8").catch(() => { throw new Error(`${archive} has no manifest.json; is it a Thunk backup?`); }));
    if (manifest.format !== FORMAT) throw new Error(`${archive} is backup format ${manifest.format}; this checkout reads format ${FORMAT}.`);
    checkMigrations(manifest.migrations ?? [], migrations, "Update this checkout to a version at least as new as the backup, then run this again.");

    if (existsSync(dataDir)) { await rename(dataDir, aside); moved = true; log(`Moved the current data to ${aside}`); }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    for (const folder of FOLDERS) if (existsSync(path.join(work, folder))) await rename(path.join(work, folder), path.join(dataDir, folder));
    if (moved && existsSync(path.join(aside, "backups"))) await rename(path.join(aside, "backups"), path.join(dataDir, "backups"));

    let counts = {};
    if (manifest.database) {
      const db = await openDatabase();
      try {
        if (db.external) {
          await mkdir(aside, { recursive: true, mode: 0o700 });
          await dumpTables(db, path.join(aside, "db"));
          log(`Saved the database's current rows to ${path.join(aside, "db")}`);
        }
        checkMigrations(manifest.migrations ?? [], await migrationsOf(db), "Update this checkout first.");
        counts = await loadTables(db, path.join(work, "db"), manifest.tables);
      } finally {
        await db.close();
      }
    }
    if (manifest.transcripts && claudeDir && existsSync(path.join(work, manifest.transcripts))) {
      // Merged, never overwritten: a transcript on this machine is at least as new as the archived one.
      await cp(path.join(work, manifest.transcripts), path.join(claudeDir, "projects"), { recursive: true, force: false, errorOnExist: false });
      log(`Merged Claude transcripts into ${path.join(claudeDir, "projects")}`);
    }
    return { manifest, counts, aside: moved || existsSync(aside) ? aside : null };
  } catch (error) {
    if (moved) {
      // Put the previous data back exactly as it was.
      if (existsSync(path.join(dataDir, "backups")) && !existsSync(path.join(aside, "backups"))) await rename(path.join(dataDir, "backups"), path.join(aside, "backups")).catch(() => {});
      await rm(dataDir, { recursive: true, force: true });
      await rename(aside, dataDir);
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
