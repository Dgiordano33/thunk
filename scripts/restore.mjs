#!/usr/bin/env node
// npm run data:restore <archive> — put a backup from `npm run data:backup` back in place.
// Refuses while a Thunk server holds the embedded database. The current data dir is moved to
// <data dir>.before-restore-<iso> first, so nothing is deleted.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDbConfig } from "../lib/db/config.ts";
import { loadMigrations, migrate } from "../lib/db/migrate.ts";
import { backupDirOf, readBackupConfig, restoreBackup, takeLock } from "./backup-core.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = (process.env.THUNK_DATA_DIR ?? path.join(os.homedir(), ".thunk")).replace(/^~(?=$|\/)/, os.homedir());
const claudeDir = (process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")).replace(/^~(?=$|\/)/, os.homedir());
const migrations = loadMigrations(path.join(root, "db/migrations"));

async function openDatabase() {
  const config = resolveDbConfig(process.env, dataDir);
  if (config.kind === "invalid") throw new Error(config.error);
  if (config.kind === "memory") throw new Error("THUNK_DATABASE=memory: there is no database to restore into.");
  if (config.kind === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: config.url, connectionTimeoutMillis: 15000, options: "-c timezone=UTC" });
    await client.connect();
    const query = async (sql, params) => (await client.query(sql, params)).rows;
    const exec = (sql) => client.query(sql).then(() => {});
    await migrate(exec, query, migrations, { baseline: process.env.THUNK_DB_BASELINE });
    return { query, exec, close: () => client.end(), external: true };
  }
  const release = await takeLock(dataDir);
  const { PGlite } = await import("@electric-sql/pglite");
  const local = new PGlite(config.dir);
  await local.exec("set timezone = 'UTC'");
  const query = async (sql, params) => (await local.query(sql, params)).rows;
  const exec = (sql) => local.exec(sql).then(() => {});
  await migrate(exec, query, migrations);
  return { query, exec, close: async () => { await local.close(); await release(); }, external: false };
}

const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!arg) {
  console.error("Usage: npm run data:restore <archive>   (a thunk-<date>.tar.gz from npm run data:backup)");
  process.exit(1);
}
// A bare name is looked up in the backups folder.
const archive = existsSync(arg) ? path.resolve(arg) : path.join(backupDirOf(dataDir, await readBackupConfig(dataDir), os.homedir()), arg);
if (!existsSync(archive)) {
  console.error(`No such archive: ${arg}`);
  process.exit(1);
}

try {
  const { manifest, counts, aside } = await restoreBackup({
    archive, dataDir, openDatabase, claudeDir, migrations: migrations.map((m) => m.name),
    log: (line) => console.log(line),
  });
  console.log(`\nRestored the backup from ${manifest.createdAt}: ${counts.projects ?? 0} projects, ${counts.sessions ?? 0} sessions, ${counts.tasks ?? 0} tasks into ${dataDir}.`);
  if (aside) console.log(`The previous data is at ${aside}; delete it once Thunk looks right.`);
} catch (error) {
  console.error(`\nRestore failed: ${error.message}`);
  console.error("Nothing was changed.");
  process.exitCode = 1;
}
