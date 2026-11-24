/** A Postgres connection: a pool for DATABASE_URL, or the embedded PGlite database. */
export interface Db {
  kind: "postgres" | "pglite";
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** jsonb columns. Values for them are sent as JSON text, so arrays aren't mistaken for Postgres arrays. */
const JSON_COLUMNS = new Set([
  "assumptions", "actions", "anchor", "content_json", "context", "diff_stat", "input", "origin", "stat", "trigger_payload", "trigger_state",
]);

/** Postgres prints `2026-11-19 20:47:19.278123+00`; the app compares and sorts ISO strings (`…T…+00:00`) as before. */
export function isoTimestamp(text: string): string {
  return text.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
}

export function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

function param(column: string, value: unknown): unknown {
  return JSON_COLUMNS.has(column) && value !== null ? JSON.stringify(value) : value;
}

type Row = Record<string, unknown>;
export type Statement = { text: string; params: unknown[] };

/**
 * `insert … values …` for one or more rows. Undefined values use the column default.
 * `onConflict` upserts the given columns (`ignoreDuplicates` skips existing rows instead).
 */
export function insertSql(
  table: string,
  rows: Row | Row[],
  opts: { onConflict?: string; ignoreDuplicates?: boolean; returning?: string } = {},
): Statement {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) throw new Error("insertSql needs at least one row");
  const columns = [...new Set(list.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))];
  const params: unknown[] = [];
  const values = list.map((row) => `(${columns.map((column) => {
    if (row[column] === undefined) return "default";
    params.push(param(column, row[column]));
    return `$${params.length}`;
  }).join(", ")})`);
  let text = `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values ${values.join(", ")}`;
  if (opts.onConflict) {
    const keys = opts.onConflict.split(",").map((key) => key.trim());
    const updates = columns.filter((column) => !keys.includes(column));
    text += ` on conflict (${keys.map(ident).join(", ")}) ` +
      (opts.ignoreDuplicates || !updates.length ? "do nothing" : `do update set ${updates.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`);
  }
  if (opts.returning) text += ` returning ${opts.returning}`;
  return { text, params };
}

/** `update … set …` from a patch (undefined values are left alone); `where` is SQL using $1… after the patch's params. */
export function updateSql(table: string, patch: Row, where: string, whereParams: unknown[], returning?: string): Statement | null {
  const columns = Object.keys(patch).filter((key) => patch[key] !== undefined);
  if (!columns.length) return null;
  const params = columns.map((column) => param(column, patch[column]));
  const offset = params.length;
  const text = `update ${ident(table)} set ${columns.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ")} where ${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`)}` +
    (returning ? ` returning ${returning}` : "");
  return { text, params: [...params, ...whereParams] };
}

export async function run<T = Row>(db: Db, statement: Statement): Promise<T[]> {
  return db.query<T>(statement.text, statement.params);
}

/** A JSON array of related rows, like PostgREST's embedding: `(select json_agg(...) from <from> where <where>)`. */
export function embed(columns: string, from: string, where: string): string {
  return `(select coalesce(json_agg(e), '[]'::json) from (select ${columns} from ${from} where ${where}) e)`;
}
