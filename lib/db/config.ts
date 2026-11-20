import path from "node:path";

/**
 * Where Thunk keeps its database:
 * - `DATABASE_URL`: any Postgres (Supabase, Neon, RDS, a local server).
 * - otherwise an embedded Postgres (PGlite) in `<data dir>/db`, so data survives restarts with no setup.
 * - `THUNK_DATABASE=memory`: nothing persists; for tests and throwaway runs.
 */
export type DbConfig =
  | { kind: "postgres"; url: string }
  | { kind: "pglite"; dir: string }
  | { kind: "memory"; reason: string }
  | { kind: "invalid"; error: string };

type Env = Record<string, string | undefined>;

export function resolveDbConfig(env: Env, dataDir: string): DbConfig {
  const mode = env.THUNK_DATABASE?.trim().toLowerCase();
  const url = env.DATABASE_URL?.trim();
  if (mode === "memory") return { kind: "memory", reason: "THUNK_DATABASE=memory" };
  // `node --test` marks its test processes; never let a test open the real data dir's database.
  if (!mode && env.NODE_TEST_CONTEXT) return { kind: "memory", reason: "running under node --test" };
  if (mode && mode !== "embedded" && mode !== "postgres") {
    return { kind: "invalid", error: `THUNK_DATABASE must be "memory", "embedded" or "postgres", got "${env.THUNK_DATABASE}".` };
  }
  if (url && mode !== "embedded") {
    if (!/^postgres(ql)?:\/\//.test(url)) return { kind: "invalid", error: "DATABASE_URL must start with postgres:// or postgresql://." };
    return { kind: "postgres", url };
  }
  if (mode === "postgres") return { kind: "invalid", error: "THUNK_DATABASE=postgres needs DATABASE_URL." };
  if (!url && env.SUPABASE_URL?.trim()) {
    // Never silently start an empty database for someone whose data lives in Supabase.
    return {
      kind: "invalid",
      error:
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are no longer used. Set DATABASE_URL to the project's Postgres connection string " +
        "(Supabase dashboard → Connect → Session pooler), then remove the SUPABASE_* settings. See README, Database.",
    };
  }
  return { kind: "pglite", dir: path.join(dataDir, "db") };
}
