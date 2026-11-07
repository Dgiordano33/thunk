import "server-only";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { maxSeq } from "@/lib/supabase/repo/messages";
import { getSessionRow, listSessionRows } from "@/lib/supabase/repo/sessions";
import "./persist";
import { createSession, getSession, listLiveSessions } from "./session-registry";
import { PERMISSION_MODES, type SessionMeta } from "./types";

export * from "./session-registry";

export async function resolveCwd(input: string): Promise<string> {
  const expanded = input.trim().replace(/^~(?=$|\/)/, os.homedir());
  const abs = path.resolve(expanded);
  const s = await stat(abs).catch(() => null);
  if (!s?.isDirectory()) throw new Error(`Not a directory: ${abs}`);
  return abs;
}

export async function startSession(input: { cwd: string; model?: string; permissionMode?: string }) {
  const cwd = await resolveCwd(input.cwd);
  const permissionMode = PERMISSION_MODES.includes(input.permissionMode as never)
    ? input.permissionMode!
    : "default";
  return createSession({ cwd, model: input.model || env.DEFAULT_MODEL, permissionMode });
}

/** Return the live session, recreating it from Supabase (SDK `resume`) if needed. */
export async function resumeSession(id: string) {
  const live = getSession(id);
  if (live) return live;
  const row = await getSessionRow(id);
  if (!row) return null;
  return createSession({
    id: row.id,
    cwd: row.cwd,
    model: row.model,
    permissionMode: row.permissionMode,
    title: row.title,
    createdAt: row.createdAt,
    resume: row.sdkSessionId ?? undefined,
    seqStart: await maxSeq(id),
  });
}

export function liveMeta(id: string): SessionMeta | null {
  const live = getSession(id);
  return live ? { ...live.meta, live: true } : null;
}

/** Live sessions merged over persisted ones, newest first. */
export async function listSessions(opts: { cwd?: string; limit?: number } = {}): Promise<SessionMeta[]> {
  const rows = await listSessionRows(opts).catch((err) => {
    console.error("[thunk] list sessions failed", err);
    return [];
  });
  const byId = new Map<string, SessionMeta>();
  for (const r of rows) byId.set(r.id, { ...r, live: false });
  for (const live of listLiveSessions()) {
    if (opts.cwd && live.meta.cwd !== opts.cwd) continue;
    byId.set(live.id, { ...live.meta, live: true });
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.limit ?? 50);
}
