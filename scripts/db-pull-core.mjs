/**
 * Copies Thunk's tables from one Postgres into another that already has Thunk's schema.
 * The source is only read, inside one read-only snapshot. Rows travel as JSON so every
 * column type round-trips unchanged; triggers and foreign keys are off on the target
 * while it loads, so updated_at keeps the source's values and table order doesn't matter.
 *
 * `source` and `target` are `{ query(sql, params) => rows }`; `target.exec(sql)` runs scripts.
 */
export async function pullDatabase({ source, target, batch = 500, log = () => {} }) {
  await source.query("begin transaction isolation level repeatable read read only");
  try {
    const tablesOf = async (db) =>
      (await db.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'thunk_migrations'"))
        .map((row) => row.table_name);
    const columnsOf = async (db, table) =>
      (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])).map((row) => row.column_name);

    const sourceMigrations = new Set(await source.query("select name from public.thunk_migrations").then((rows) => rows.map((r) => r.name), () => []));
    const targetMigrations = new Set((await target.query("select name from public.thunk_migrations")).map((r) => r.name));
    const ahead = [...sourceMigrations].filter((name) => !targetMigrations.has(name));
    if (ahead.length) throw new Error(`The source has migrations this checkout doesn't: ${ahead.join(", ")}. Pull the latest main first.`);

    const targetTables = new Set(await tablesOf(target));
    const tables = (await tablesOf(source)).filter((table) => targetTables.has(table)).sort();
    const counts = {};
    await target.exec("set session_replication_role = replica;");
    try {
      for (const table of tables) {
        const targetColumns = new Set(await columnsOf(target, table));
        const columns = (await columnsOf(source, table)).filter((column) => targetColumns.has(column));
        const list = columns.map((c) => `"${c}"`).join(", ");
        await target.exec(`delete from public."${table}";`);
        await source.query(`declare pull_cursor no scroll cursor for select to_jsonb(t) as row from public."${table}" t`);
        counts[table] = 0;
        for (;;) {
          const rows = await source.query(`fetch ${batch} from pull_cursor`);
          if (!rows.length) break;
          await target.query(
            `insert into public."${table}" (${list}) select ${list} from jsonb_populate_recordset(null::public."${table}", $1::jsonb)`,
            [JSON.stringify(rows.map((r) => r.row))],
          );
          counts[table] += rows.length;
        }
        await source.query("close pull_cursor");
        log(`${table}: ${counts[table]}`);
      }
    } finally {
      await target.exec("set session_replication_role = origin;");
    }
    // A copy must never act: routines would fire a second time beside the real server.
    if (targetTables.has("routines")) await target.query("update public.routines set enabled = false");
    return counts;
  } finally {
    await source.query("rollback").catch(() => {});
  }
}
