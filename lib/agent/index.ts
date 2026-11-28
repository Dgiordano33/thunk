import "server-only";
import { env } from "@/lib/env";
import { projectForDirectory, getWorkspaceContext, createWorkspace } from "@/lib/projects";
import { loadEvents, maxSeq } from "@/lib/db/repo/messages";
import { deleteSessionRow, getSessionRow, listSessionRows, type SessionRow } from "@/lib/db/repo/sessions";
import { hasDatabase } from "@/lib/db/server";
import "./persist";
import { closeSession, createSession, evictIdleSessions, evictSession, getSession, isTerminated, listLiveSessions } from "./session-registry";
import { restoreCheckouts } from "@/lib/projects/checkouts";
import { deleteTranscripts, ensureTranscriptAt } from "./transcripts";
import type { SessionOrigin } from "@/lib/agent/types";
import { permissionModesFor, providerOf, type SessionMeta } from "./types";

export * from "./session-registry";
export { deleteTranscripts } from "./transcripts";

export class WorkspaceArchivedError extends Error {
  constructor() {
    super("Workspace is archived. Unarchive it to resume this session.");
  }
}

export type StartSessionInput = {
  /** A standalone project effort gets its own worktree. */
  projectId?: string;
  /** Start inside an existing workspace... */
  workspaceId?: string;
  /** ...or quick-start from a directory: its project and isolated effort workspace are created on demand. */
  cwd?: string;
  model?: string;
  permissionMode?: string;
  /** Continue an existing Claude Code transcript (e.g. one started from the terminal). */
  resumeSdkSessionId?: string;
  title?: string;
  origin?: SessionOrigin | null;
};

export async function startSession(input: StartSessionInput) {
  const ctx = input.workspaceId
    ? await getWorkspaceContext(input.workspaceId)
    : input.projectId
      ? await getWorkspaceContext((await createWorkspace({ projectId: input.projectId, visibility: "project" })).id)
    : input.cwd
      ? await getWorkspaceContext((await createWorkspace({ projectId: (await projectForDirectory(input.cwd)).id, visibility: "project" })).id)
      : null;
  if (!ctx) throw new Error(input.workspaceId ? "Workspace not found" : "projectId, workspaceId or cwd is required");
  if (input.projectId && ctx.project.id !== input.projectId) throw new Error("Workspace does not belong to this project");
  if (ctx.workspace.status === "archived") throw new Error("Workspace is archived");
  if (input.workspaceId) await restoreCheckouts(ctx);
  const model = input.model || env.DEFAULT_MODEL;
  if (input.resumeSdkSessionId && providerOf(model) === "claude") await ensureTranscriptAt(ctx.workspace.cwd, input.resumeSdkSessionId);
  const permissionMode = permissionModesFor(providerOf(model)).includes(input.permissionMode as never)
    ? input.permissionMode!
    : "default";
  return createSession({
    ctx,
    model,
    permissionMode,
    resume: input.resumeSdkSessionId,
    title: input.title ?? null,
    origin: input.origin ?? null,
  });
}

/** Return the live session, recreating it from the database (SDK `resume` / Codex `thread/resume`) if needed. */
export async function resumeSession(id: string) {
  const live = getSession(id);
  if (live && !isTerminated(live)) return live;
  if (live) {
    // live.ctx is a snapshot from when the session started, so read the workspace's current status.
    const current = await getWorkspaceContext(live.meta.workspaceId);
    if (current?.workspace.status === "archived") throw new WorkspaceArchivedError();
    if (current) await restoreCheckouts(current);
    // The runtime exited or crashed: start a new one on the same SDK session / thread, keeping history.
    evictSession(live);
    return createSession({
      id,
      ctx: live.ctx,
      model: live.meta.model,
      permissionMode: live.meta.permissionMode,
      title: live.meta.title,
      createdAt: live.meta.createdAt,
      resume: live.meta.sdkSessionId ?? undefined,
      cwd: live.meta.cwd,
      seqStart: live.seq,
      events: live.events,
      origin: live.meta.origin,
    });
  }
  const row = await getSessionRow(id);
  if (!row) return null;
  const ctx = await getWorkspaceContext(row.workspaceId);
  if (!ctx) throw new Error("This session's workspace no longer exists");
  if (ctx.workspace.status === "archived") throw new WorkspaceArchivedError();
  await restoreCheckouts(ctx);
  return createSession({
    id: row.id,
    ctx,
    model: row.model,
    permissionMode: row.permissionMode,
    title: row.title,
    createdAt: row.createdAt,
    resume: row.sdkSessionId ?? undefined,
    cwd: row.cwd,
    seqStart: await maxSeq(id),
    events: await loadEvents(id),
    origin: row.origin,
  });
}

/**
 * Free the memory of sessions that ended on their own and sat unwatched for 30 minutes. Opening one reads its
 * history from the database and Resume rebuilds it there. Memory-only mode keeps them: the registry is their only copy.
 */
export function sweepIdleSessions(now = Date.now()): string[] {
  return hasDatabase() ? evictIdleSessions(now) : [];
}

export function liveMeta(id: string): SessionMeta | null {
  const live = getSession(id);
  return live ? { ...live.meta, live: true } : null;
}

/** Live sessions merged over persisted ones, newest first. */
export async function listSessions(
  opts: { workspaceId?: string; projectId?: string; limit?: number; includeHidden?: boolean } = {},
  persisted?: SessionRow[],
): Promise<SessionMeta[]> {
  const rows = persisted ?? await listSessionRows(opts).catch((err) => {
    console.error("[thunk] list sessions failed", err);
    return [];
  });
  const byId = new Map<string, SessionMeta>();
  for (const r of rows) byId.set(r.id, { ...r, live: false });
  for (const live of listLiveSessions()) {
    if (opts.workspaceId && live.meta.workspaceId !== opts.workspaceId) continue;
    if (opts.projectId && live.meta.projectId !== opts.projectId) continue;
    byId.set(live.id, { ...byId.get(live.id), ...live.meta, live: true });
  }
  return [...byId.values()].filter(s => opts.includeHidden || s.origin?.kind !== "board").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.limit ?? 50);
}

/** Every session (live or persisted) in a workspace or project, so callers can clean up after deleting it. */
export function allSessions(opts: { workspaceId?: string; projectId?: string }) {
  return listSessions({ ...opts, includeHidden: true, limit: 10_000 });
}

/** Stop a session, drop its history and delete its SDK transcript. */
export async function deleteSession(id: string): Promise<boolean> {
  const live = getSession(id);
  const meta = live?.meta ?? (await getSessionRow(id));
  if (!meta) return false;
  closeSession(id);
  await deleteSessionRow(id);
  await deleteTranscripts([meta]);
  return true;
}
