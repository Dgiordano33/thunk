/* eslint-disable @typescript-eslint/no-require-imports -- Test helper loaded through the callers' TypeScript hook. */
const path = require("node:path");

/**
 * A migrated in-memory Postgres (PGlite) shaped like lib/db/server.ts's `Db`.
 * Callers must have installed the `.ts` require hook first.
 */
async function testDb() {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { migrate, loadMigrations } = require("../../lib/db/migrate.ts");
  const { isoTimestamp } = require("../../lib/db/sql.ts");
  const toNumber = (v) => Number(v);
  const pg = new PGlite({ parsers: { [types.INT8]: toNumber, [types.NUMERIC]: toNumber, [types.TIMESTAMPTZ]: isoTimestamp, [types.TIMESTAMP]: isoTimestamp } });
  await pg.exec("set timezone = 'UTC'");
  const exec = (sql) => pg.exec(sql).then(() => {});
  const query = async (sql, params) => (await pg.query(sql, params)).rows;
  await migrate(exec, query, loadMigrations(path.join(__dirname, "../../db/migrations")));
  const transaction = (fn) => pg.transaction((t) => {
    const tx = { kind: "pglite", query: async (sql, params) => (await t.query(sql, params)).rows, transaction: (inner) => inner(tx) };
    return fn(tx);
  });
  return { kind: "pglite", query, exec, transaction, close: () => pg.close() };
}

module.exports = { testDb };
