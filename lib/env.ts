import "server-only";
import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Postgres for projects and sessions; without it Thunk uses an embedded database (lib/db/config.ts). */
  DATABASE_URL: z.string().optional(),
  DEFAULT_MODEL: z.string().min(1).default("claude-opus-5-5"),
  /** Codex CLI used for Codex models (`codex app-server`). */
  CODEX_BIN: z.string().min(1).optional(),
  /** Remote access over Tailscale Serve (docs/remote.md); read by proxy.ts via lib/access.ts. */
  THUNK_TRUSTED_HOSTS: z.string().optional(),
  THUNK_TRUSTED_USER: z.string().optional(),
});

export const env = schema.parse(process.env);
