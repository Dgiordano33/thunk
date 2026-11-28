import "server-only";
import { readFile } from "node:fs/promises";
import { getSession } from "@/lib/agent/session-registry";
import { getSessionRow } from "@/lib/db/repo/sessions";
import { getTask } from "@/lib/db/repo/tasks";
import { listContextItems } from "@/lib/db/repo/context-items";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/projects";
import { taskSource } from "@/lib/tasks/prompt";
import { vaultDirOf } from "@/lib/vault/dir";
import { readItem } from "@/lib/vault/store";
import { contentHash, sourceOf } from "./record";
import { REASONS, type ContextViewItem, type SessionContextItem } from "./types";

/** The session's workspace and project, live or from the database. */
export async function sessionWorkspace(sessionId: string): Promise<WorkspaceContext | null> {
  const live = getSession(sessionId);
  if (live) return live.ctx;
  const row = await getSessionRow(sessionId);
  return row ? getWorkspaceContext(row.workspaceId) : null;
}

/** The current text an item stands for, or null when it can't be read (deleted, or nothing to compare). */
export async function currentSource(item: Pick<SessionContextItem, "kind" | "refId" | "path">, ctx: WorkspaceContext | null): Promise<string | null> {
  switch (item.kind) {
    case "note":
    case "memory":
    case "instructions": {
      if (!item.path) return null;
      const raw = await readFile(item.path, "utf8").catch(() => null);
      return raw === null ? null : sourceOf(item.kind, raw);
    }
    case "task": {
      const task = await getTask(item.refId).catch(() => null);
      return task ? taskSource(task) : null;
    }
    case "vault": {
      if (!ctx) return null;
      const v = await readItem(vaultDirOf(ctx.project), item.refId).catch(() => null);
      return v ? (v.summary ?? "") : null;
    }
    default:
      return null;
  }
}

/** Whether the session's copy is out of date: compares the stored hash with the file's current hash. */
async function changedSince(item: SessionContextItem, ctx: WorkspaceContext | null): Promise<boolean | null> {
  if (!item.contentHash || item.mode === "omitted" || item.mode === "index") return null;
  const source = await currentSource(item, ctx);
  // A note or task that no longer exists has changed too.
  if (source === null) return item.kind === "routine" || (item.kind === "vault" && !ctx) ? null : true;
  return contentHash(source) !== item.contentHash;
}

/** Items for the Context view, each with `changedSince` and what the person can do with it. */
export async function sessionContext(sessionId: string, ctx?: WorkspaceContext | null): Promise<ContextViewItem[]> {
  const items = await listContextItems(sessionId);
  const workspace = ctx === undefined ? await sessionWorkspace(sessionId).catch(() => null) : ctx;
  // The newest prompt build: a removal made after it hasn't taken effect yet.
  const builtAt = items.filter((i) => i.origin === "prompt" && !i.removedAt).reduce((max, i) => (i.createdAt > max ? i.createdAt : max), "");
  return Promise.all(items.map(async (item): Promise<ContextViewItem> => {
    const { content, ...rest } = item;
    void content;
    const removalPending = Boolean(item.removedAt && item.removedAt > builtAt);
    const changed = await changedSince(item, workspace).catch(() => null);
    const held = item.mode === "full" || item.mode === "truncated";
    return {
      ...rest,
      changedSince: changed,
      removalPending,
      canUpdate: item.kind === "note" && held && Boolean(changed) && (!item.removedAt || removalPending),
      canRemove: item.origin === "prompt" && item.kind !== "routine" && item.mode !== "omitted" && item.reason !== REASONS.autoMemory,
    };
  }));
}
