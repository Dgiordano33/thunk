import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Migration = { name: string; sql: string };

/** Runs one script (several statements, no parameters) in a single session. */
export type Exec = (sql: string) => Promise<void>;
export type Query = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ name: file.slice(0, -4), sql: readFileSync(path.join(dir, file), "utf8") }));
}

/** `20261107133630_0001_init` → `0001_init`, the name Supabase's migration history records. */
const shortName = (name: string) => name.replace(/^\d+_/, "");

/**
 * Applies migrations that haven't run yet, each in its own transaction, recorded in
 * `thunk_migrations`. Databases set up before this runner existed are recognised once:
 * migrations listed in Supabase's history (matched by name) or up to `baseline` are
 * recorded without running.
 */
export async function migrate(exec: Exec, query: Query, migrations: Migration[], opts: { baseline?: string; log?: (message: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  // The migrations grant access to Supabase's API roles. Plain Postgres lacks them, so create stand-ins.
  await exec(`do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select from pg_roles where rolname = r) then
      begin
        execute format('create role %I nologin', r);
      exception when insufficient_privilege then null;
      end;
    end if;
  end loop;
end $$;
create table if not exists public.thunk_migrations (name text primary key, applied_at timestamptz not null default now());`);

  const applied = new Set((await query<{ name: string }>("select name from public.thunk_migrations")).map((row) => row.name));
  if (!applied.size) {
    const [{ existing }] = await query<{ existing: boolean }>("select to_regclass('public.projects') is not null as existing");
    if (existing) {
      const known = new Set<string>();
      if (opts.baseline) {
        if (!migrations.some((m) => m.name === opts.baseline)) throw new Error(`THUNK_DB_BASELINE: no migration named ${opts.baseline}`);
        for (const m of migrations) { known.add(m.name); if (m.name === opts.baseline) break; }
      } else {
        const [{ tracked }] = await query<{ tracked: boolean }>("select to_regclass('supabase_migrations.schema_migrations') is not null as tracked");
        const history = tracked ? new Set((await query<{ name: string | null }>("select name from supabase_migrations.schema_migrations")).map((row) => row.name)) : new Set();
        for (const m of migrations) if (history.has(shortName(m.name))) known.add(m.name);
        if (!known.size) {
          throw new Error(
            "This database already has Thunk tables but no migration history. Set THUNK_DB_BASELINE to the last migration " +
            "you applied (for example 20261111000000_0013_delegation_plans) so Thunk knows where to continue.",
          );
        }
      }
      await query(`insert into public.thunk_migrations (name) select unnest($1::text[]) on conflict do nothing`, [[...known]]);
      for (const name of known) applied.add(name);
      log(`recorded ${known.size} migrations that were applied before Thunk tracked them`);
    }
  }

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    if (!/^[\w.-]+$/.test(m.name)) throw new Error(`Invalid migration name: ${m.name}`);
    try {
      await exec(`begin;\n${m.sql}\n;\ninsert into public.thunk_migrations (name) values ('${m.name}');\ncommit;`);
    } catch (error) {
      await exec("rollback;").catch(() => {});
      throw new Error(`Migration ${m.name} failed: ${(error as Error).message}`, { cause: error });
    }
    log(`applied ${m.name}`);
  }
}
