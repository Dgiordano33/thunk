#!/usr/bin/env node
// npm run data:backup [-- --with-transcripts] — write <data dir>/backups/thunk-<iso>.tar.gz:
// projects/, config/, homes/, every table as db/<table>.jsonl, and manifest.json.
// When a Thunk server holds the embedded database, it asks that server to make the backup.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDbConfig } from "../lib/db/config.ts";
import { backupDirOf, createBackup, lockHolder, pruneBackups, readBackupConfig, takeLock } from "./backup-core.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = (process.env.THUNK_DATA_DIR ?? path.join(os.homedir(), ".thunk")).replace(/^~(?=$|\/)/, os.homedir());
const claudeDir = (process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude")).replace(/^~(?=$|\/)/, os.homedir());
const withTranscripts = process.argv.includes("--with-transcripts");
const megabytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function revision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The running server holds the embedded database, so it has to read it. */
async function viaServer(pid) {
  const port = process.env.PORT || process.env.THUNK_PORT || process.env.CONDUCTOR_PORT || "4500";
  const url = `http://127.0.0.1:${port}/api/settings/backup`;
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ withTranscripts }) });
  } catch {
    throw new Error(`A Thunk server (pid ${pid}) is using ${path.join(dataDir, "db")}, but nothing answered at ${url}. Set PORT to its port, use Settings → Automation → Back up now, or stop it and run this again.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body.backup;
}

async function direct() {
  const config = resolveDbConfig(process.env, dataDir);
  if (config.kind === "invalid") throw new Error(config.error);
  const settings = await readBackupConfig(dataDir);
  const outDir = backupDirOf(dataDir, settings, os.homedir());
  const common = { dataDir, outDir, claudeDir: withTranscripts ? claudeDir : null, version: revision() };
  let backup;
  if (config.kind === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: config.url, connectionTimeoutMillis: 15000, options: "-c timezone=UTC" });
    await client.connect();
    try {
      backup = await createBackup({ ...common, db: { query: async (sql, params) => (await client.query(sql, params)).rows } });
    } finally {
      await client.end().catch(() => {});
    }
  } else if (config.kind === "pglite" && existsSync(config.dir)) {
    const release = await takeLock(dataDir);
    const { PGlite } = await import("@electric-sql/pglite");
    const local = new PGlite(config.dir);
    try {
      await local.exec("set timezone = 'UTC'");
      backup = await createBackup({ ...common, db: { query: async (sql, params) => (await local.query(sql, params)).rows } });
    } finally {
      await local.close().catch(() => {});
      await release();
    }
  } else {
    backup = await createBackup({ ...common, db: null });
  }
  const removed = await pruneBackups(outDir, settings.keep);
  return { ...backup, removed };
}

try {
  const pid = resolveDbConfig(process.env, dataDir).kind === "pglite" ? await lockHolder(dataDir) : null;
  const backup = pid ? await viaServer(pid) : await direct();
  console.log(`Backed up to ${backup.file} (${megabytes(backup.size)}).`);
  if (backup.removed?.length) console.log(`Removed ${backup.removed.length} older backup${backup.removed.length === 1 ? "" : "s"}.`);
  console.log("The archive holds config/integrations.json, which has tokens; it is readable only by you (mode 0600).");
} catch (error) {
  console.error(`Backup failed: ${error.message}`);
  process.exitCode = 1;
}
