import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "@/lib/env";
import type { Database } from "./types";

export type Db = SupabaseClient<Database>;

const g = globalThis as typeof globalThis & { __thunkDb?: Db };

/** Service-role client, or null when Supabase isn't configured (memory-only mode). */
export function db(): Db | null {
  if (!hasSupabase) return null;
  g.__thunkDb ??= createClient<Database>(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return g.__thunkDb;
}
