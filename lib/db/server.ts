import "server-only";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/projects/paths";
import { resolveDbConfig, type DbConfig } from "./config";
import { loadMigrations, migrate } from "./migrate";
import { isoTimestamp, type Db } from "./sql";

export type { Db } from "./sql";

// Postgres type OIDs whose text form the app wants converted.
const INT8 = 20, NUMERIC = 1700, TIMESTAMPTZ = 1184, TIMESTAMP = 1114;
const toNumber = (v: string) => Number(v);

/** Runs `fn` on one database session; `begin` is false when that session is already inside a transaction. */
export type DbSession = <T>(fn: (session: { query: Db["query"] }, opts: { begin: boolean }) => Promise<T>) => Promise<T>;
type State = { mode: "memory"; reason: string } | { mode: "invalid"; error: string } | { mode: "ready"; db: Db; session: DbSession };
const g = globalThis as typeof globalThis & { __thunkDb?: State };

function migrationsDir() {
  return process.env.THUNK_MIGRATIONS_DIR ?? path.join(process.cwd(), "db/migrations");
}

/** One process at a time can open the embedded database. Returns false when another live Thunk holds it. */
function lockEmbedded(dir: string): boolean {
  mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "thunk.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      process.once("exit", () => rmSync(lock, { force: true }));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(lock, "utf8"));
      if (pid === process.pid) return true;
      try {
        if (pid > 0) { process.kill(pid, 0); return false; }
      } catch {
        // The holder is gone; take over its stale lock.
      }
      rmSync(lock, { force: true });
    }
  }
  return false;
}

function withMigrations(db: Db, ready: Promise<void>): Db {
  return {
    kind: db.kind,
    query: async (text, params) => { await ready; return db.query(text, params); },
    transaction: async (fn) => { await ready; return db.transaction!(fn); },
  };
}

/** A handle bound to one open transaction; nested `transaction` calls run inside it. */
function inTransaction(kind: Db["kind"], query: Db["query"]): Db {
  const tx: Db = { kind, query, transaction: (fn) => fn(tx) };
  return tx;
}

function openPostgres(url: string): State {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg") as typeof import("pg");
  const types = {
    getTypeParser: (oid: number, format?: string) => {
      if (oid === INT8 || oid === NUMERIC) return toNumber;
      if (oid === TIMESTAMPTZ || oid === TIMESTAMP) return isoTimestamp;
      return pg.types.getTypeParser(oid, format as "text");
    },
  };
  const pool = new pg.Pool({ connectionString: url, types, max: 10, options: "-c timezone=UTC" });
  pool.on("error", (error) => console.error("[thunk] database connection error", error));
  const db: Db = {
    kind: "postgres",
    query: async (text, params) => (await pool.query(text, params as unknown[])).rows,
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(inTransaction("postgres", async (text, params) => (await client.query(text, params as unknown[])).rows));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const ready = (async () => {
    // Migrations need one session for the advisory lock and each transaction.
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock(4815162342)");
      try {
        await migrate((sql) => client.query(sql).then(() => {}), async (sql, params) => (await client.query(sql, params)).rows,
          loadMigrations(migrationsDir()), { baseline: process.env.THUNK_DB_BASELINE, log: (m) => console.log(`[thunk] database: ${m}`) });
      } finally {
        await client.query("select pg_advisory_unlock(4815162342)");
      }
    } finally {
      client.release();
    }
  })();
  ready.catch((error) => console.error("[thunk] database setup failed", error));
  const session: DbSession = async (fn) => {
    await ready;
    const client = await pool.connect();
    try {
      return await fn({ query: async (text, params) => (await client.query(text, params as unknown[])).rows }, { begin: true });
    } finally {
      client.release();
    }
  };
  return { mode: "ready", db: withMigrations(db, ready), session };
}

function openEmbedded(dir: string): State {
  if (!lockEmbedded(dir)) {
    const reason = `another Thunk process is using ${dir}`;
    console.warn(`[thunk] ${reason}; this one keeps projects and sessions in memory. Stop the other process, or delete ${path.join(dir, "thunk.lock")} if none is running.`);
    return { mode: "memory", reason };
  }
  const ready = (async () => {
    const { PGlite, types } = await import("@electric-sql/pglite");
    const pglite = new PGlite(dir, {
      parsers: { [types.INT8]: toNumber, [types.NUMERIC]: toNumber, [types.TIMESTAMPTZ]: isoTimestamp, [types.TIMESTAMP]: isoTimestamp },
    });
    await pglite.exec("set timezone = 'UTC'");
    await migrate((sql) => pglite.exec(sql).then(() => {}), async (sql, params) => (await pglite.query(sql, params)).rows as never,
      loadMigrations(migrationsDir()), { baseline: process.env.THUNK_DB_BASELINE, log: (m) => console.log(`[thunk] database: ${m}`) });
    return pglite;
  })();
  ready.catch((error) => console.error("[thunk] database setup failed", error));
  const db: Db = {
    kind: "pglite",
    query: async (text, params) => (await (await ready).query(text, params as unknown[])).rows as never,
    transaction: async (fn) => (await ready).transaction((tx) => fn(inTransaction("pglite", async (text, params) => (await tx.query(text, params as unknown[])).rows as never))),
  };
  // PGlite has one connection; transaction() holds every other query back until `fn` finishes.
  const session: DbSession = async (fn) => (await ready).transaction((tx) =>
    fn({ query: async (text, params) => (await tx.query(text, params as unknown[])).rows as never }, { begin: false }));
  return { mode: "ready", db, session };
}

function open(config: DbConfig): State {
  switch (config.kind) {
    case "memory": return { mode: "memory", reason: config.reason };
    case "invalid": console.error(`[thunk] ${config.error}`); return { mode: "invalid", error: config.error };
    case "postgres": return openPostgres(config.url);
    case "pglite": return openEmbedded(config.dir);
  }
}

function state(): State {
  return (g.__thunkDb ??= open(resolveDbConfig(process.env, DATA_DIR)));
}

/** The database, or null in memory-only mode. Throws when the database settings are wrong. */
export function db(): Db | null {
  const s = state();
  if (s.mode === "invalid") throw new Error(s.error);
  return s.mode === "ready" ? s.db : null;
}

/** The database's single-session runner, or null in memory-only mode. Throws when the database settings are wrong. */
export function dbSession(): DbSession | null {
  const s = state();
  if (s.mode === "invalid") throw new Error(s.error);
  return s.mode === "ready" ? s.session : null;
}

/** True unless Thunk keeps everything in memory. */
export function hasDatabase(): boolean {
  return state().mode !== "memory";
}

/** For startup logs and `thunk doctor`. */
export function describeDatabase(): string {
  const s = state();
  if (s.mode === "memory") return `memory only (${s.reason})`;
  if (s.mode === "invalid") return `misconfigured: ${s.error}`;
  return s.db.kind === "pglite" ? `embedded (${path.join(DATA_DIR, "db")})` : "Postgres (DATABASE_URL)";
}
