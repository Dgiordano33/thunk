import "server-only";
import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  SUPABASE_URL: z.url().optional().or(z.literal("").transform(() => undefined)),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DEFAULT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  /** Codex CLI used for Codex models (`codex app-server`). */
  CODEX_BIN: z.string().min(1).optional(),
});

export const env = schema.parse(process.env);

export const hasSupabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
