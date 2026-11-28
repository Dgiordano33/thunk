/**
 * Reads and writes Thunk's tables as JSON rows, so every column type round-trips unchanged
 * between PGlite and external Postgres. `db:pull` copies one database into another; backups
 * write the same rows to `db/<table>.jsonl` and restore loads them back.
 *
 * A database is `{ query(sql, params) => rows }`; a target also has `exec(sql)` for scripts.
 */

const tablesOf = async (db) =>
  (await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'thunk_migrations'"))
    .map((row) => row.table_name)
    .sort();
const columnsOf = async (db, table) =>
  (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])).map((row) => row.column_name);

/** Applied migration names, oldest first; empty when the database has no history table. */
export async function migrationsOf(db) {
  // Checked first rather than caught: a failed query would abort the snapshot's transaction.
  const [{ tracked }] = await db.query("select to_regclass('public.thunk_migrations') is not null as tracked");
  return tracked ? (await db.query("select name from public.thunk_migrations")).map((r) => r.name).sort() : [];
}

/**
 * Runs `read({ tables, columns, rows })` inside one repeatable-read, read-only snapshot of `source`.
 * `rows(table)` yields batches of row objects through a cursor, so a big table never sits in memory.
 * Pass `begin: false` when the caller has already opened the transaction (PGlite's `transaction()`).
 */
export async function readSnapshot(source, read, { batch = 500, begin = true } = {}) {
  await source.query(begin ? "begin transaction isolation level repeatable read read only" : "set transaction isolation level repeatable read, read only");
  try {
    async function* rows(table) {
      await source.query(`declare pull_cursor no scroll cursor for select to_jsonb(t) as row from public."${table}" t`);
      try {
        for (;;) {
          const page = await source.query(`fetch ${batch} from pull_cursor`);
          if (!page.length) break;
          yield page.map((r) => r.row);
        }
      } finally {
        await source.query("close pull_cursor");
      }
    }
    return await read({ tables: await tablesOf(source), columns: (table) => columnsOf(source, table), rows, migrations: await migrationsOf(source) });
  } finally {
    if (begin) await source.query("rollback").catch(() => {});
  }
}

/**
 * Replaces tables in `target` while triggers and foreign keys are off, so updated_at keeps the
 * source's values and table order doesn't matter. `fill({ tables, replace })`: `replace(table,
 * columns, batches)` empties the table, then inserts each batch of row objects and returns how
 * many; columns the target lacks are dropped.
 */
export async function writeTables(target, fill) {
  const targetTables = new Set(await tablesOf(target));
  const counts = {};
  await target.exec("set session_replication_role = replica;");
  try {
    await fill({
      tables: targetTables,
      async replace(table, columns, batches) {
        const targetColumns = new Set(await columnsOf(target, table));
        const list = columns.filter((column) => targetColumns.has(column)).map((c) => `"${c}"`).join(", ");
        await target.exec(`delete from public."${table}";`);
        counts[table] = 0;
        for await (const rows of batches) {
          if (!rows.length) continue;
          await target.query(
            `insert into public."${table}" (${list}) select ${list} from jsonb_populate_recordset(null::public."${table}", $1::jsonb)`,
            [JSON.stringify(rows)],
          );
          counts[table] += rows.length;
        }
        return counts[table];
      },
    });
  } finally {
    await target.exec("set session_replication_role = origin;");
  }
  return counts;
}

/** Refuses a source that has run migrations this checkout doesn't know. */
export function checkMigrations(sourceMigrations, targetMigrations, hint) {
  const known = new Set(targetMigrations);
  const ahead = sourceMigrations.filter((name) => !known.has(name));
  if (ahead.length) throw new Error(`The source has migrations this checkout doesn't: ${ahead.join(", ")}. ${hint}`);
}

/**
 * Copies Thunk's tables from one Postgres into another that already has Thunk's schema.
 * The source is only read, inside one read-only snapshot.
 */
export async function pullDatabase({ source, target, batch = 500, log = () => {} }) {
  return readSnapshot(source, async ({ tables, columns, rows, migrations }) => {
    checkMigrations(migrations, await migrationsOf(target), "Pull the latest main first.");
    const counts = await writeTables(target, async ({ tables: targetTables, replace }) => {
      for (const table of tables.filter((t) => targetTables.has(t))) {
        log(`${table}: ${await replace(table, await columns(table), rows(table))}`);
      }
    });
    // A copy must never act: routines would fire a second time beside the real server.
    if (counts.routines !== undefined) await target.query("update public.routines set enabled = false");
    return counts;
  }, { batch });
}
