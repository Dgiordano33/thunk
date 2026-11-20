#!/usr/bin/env node
// npm run db:pull — copy a Thunk database (usually production) into the local embedded database.
// The source is read in a read-only snapshot. The previous local database is kept as a backup.
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { loadMigrations, migrate } from "../lib/db/migrate.ts";
import { pullDatabase } from "./db-pull-core.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = (process.env.THUNK_DATA_DIR ?? path.join(os.homedir(), ".thunk")).replace(/^~(?=$|\/)/, os.homedir());
const dbDir = path.join(dataDir, "db");

function holder() {
  try {
    const pid = Number(readFileSync(path.join(dbDir, "thunk.lock"), "utf8"));
    if (pid > 0) { process.kill(pid, 0); return pid; }
  } catch {
    // No lock, or its process is gone.
  }
  return null;
}

/** Reads the connection string without echoing it or putting it in shell history. */
function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(text); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

const pid = holder();
if (pid) {
  console.error(`A Thunk server (pid ${pid}) is using ${dbDir}. Stop it (the Mac app or a dev server), then run this again.`);
  process.exit(1);
}

const url = process.env.THUNK_PULL_URL?.trim() || await ask("Source connection string (Supabase → Connect → Session pooler): ");
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("That doesn't look like a postgres:// connection string.");
  process.exit(1);
}

const source = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, options: "-c timezone=UTC" });
await source.connect();
const backup = existsSync(dbDir) ? `${dbDir}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}` : null;
const work = `${dbDir}.pulling`;
rmSync(work, { recursive: true, force: true });
const local = new PGlite(work);
try {
  await local.exec("set timezone = 'UTC'");
  await migrate((sql) => local.exec(sql).then(() => {}), async (sql, params) => (await local.query(sql, params)).rows, loadMigrations(path.join(root, "db/migrations")));
  console.log("Copying…");
  const counts = await pullDatabase({
    source: { query: async (sql, params) => (await source.query(sql, params)).rows },
    target: { query: async (sql, params) => (await local.query(sql, params)).rows, exec: (sql) => local.exec(sql) },
    log: (line) => console.log(`  ${line}`),
  });
  await local.close();
  if (holder()) throw new Error("A Thunk server started during the copy; nothing was replaced. Stop it and run this again.");
  if (backup) renameSync(dbDir, backup);
  renameSync(work, dbDir);
  console.log(`\nDone: ${counts.projects ?? 0} projects, ${counts.sessions ?? 0} sessions, ${counts.tasks ?? 0} tasks into ${dbDir}.`);
  console.log("Routines are turned off in this copy so nothing fires twice.");
  if (backup) console.log(`The previous local database is at ${backup}; delete it when you no longer need it.`);
} catch (error) {
  await local.close().catch(() => {});
  rmSync(work, { recursive: true, force: true });
  console.error(`\nPull failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await source.end().catch(() => {});
}
