import "server-only";
import { readFile } from "node:fs/promises";
import { getSession, isTerminated, listLiveSessions, pushUserMessage, resumeSession, WorkspaceArchivedError, type LiveSession } from "@/lib/agent";
import { HttpError } from "@/lib/api/errors";
import { contextItemsForPath, getContextItem, listContextItems, markContextItemSent, setContextItemRemoved } from "@/lib/db/repo/context-items";
import { getTask } from "@/lib/db/repo/tasks";
import type { NoteScope } from "@/lib/notes/types";
import { linkedNote, loadNote, renderTask } from "@/lib/routines/context";
import { taskSource } from "@/lib/tasks/prompt";
import { vaultDirOf } from "@/lib/vault/dir";
import { readItem } from "@/lib/vault/store";
import { readText } from "@/lib/vault/tools";
import { buildAttachmentPayload, buildNoteUpdatePayload } from "./payloads";
import { contentHash, recordContextItems, sourceOf } from "./record";
import { sessionContext } from "./service";
import type { ContextItemDraft } from "./types";

export type AttachRef = { kind: "note"; scope: NoteScope; id: string } | { kind: "task"; id: string } | { kind: "vault"; id: string };

/** The running session, resumed if its runtime exited. */
async function running(sessionId: string): Promise<LiveSession> {
  const live = await resumeSession(sessionId).catch((err) => {
    throw err instanceof WorkspaceArchivedError ? new HttpError(409, err.message) : err;
  });
  if (!live) throw new HttpError(404, "Unknown session");
  return live;
}

/** Read what an attachment stands for, in the session's project only. */
async function resolveAttachment(live: LiveSession, ref: AttachRef): Promise<{ text: string; draft: ContextItemDraft }> {
  const { project } = live.ctx;
  if (ref.kind === "note") {
    const note = await loadNote(project, { scope: ref.scope, id: ref.id }).catch(() => null);
    if (!note) throw new HttpError(404, "Note not found in this project");
    return { text: note.markdown.trim() || "_Empty note._", draft: { kind: "note", refId: note.id, title: note.title, path: note.path, mode: "full", chars: note.markdown.length, source: note.markdown, keepContent: true } };
  }
  if (ref.kind === "task") {
    const task = await getTask(ref.id);
    if (!task || task.projectId !== project.id) throw new HttpError(404, "Task not found in this project");
    const text = renderTask(task, "Task", await linkedNote(project, task));
    return { text, draft: { kind: "task", refId: task.id, title: task.title, mode: "full", chars: text.length, source: taskSource(task) } };
  }
  const item = await readItem(vaultDirOf(project), ref.id).catch(() => null);
  if (!item) throw new HttpError(404, "Vault item not found in this project");
  const text = readText(item);
  return { text, draft: { kind: "vault", refId: item.id, title: item.title, path: item.path ?? null, mode: "full", chars: text.length, source: item.summary ?? "" } };
}

/** Push a note, task or Vault item into the running session and record it as attached. */
export async function attachToSession(sessionId: string, ref: AttachRef) {
  const live = await running(sessionId);
  const { text, draft } = await resolveAttachment(live, ref);
  const chars = Math.min(text.length, 40_000);
  pushUserMessage(live, buildAttachmentPayload({ kind: ref.kind, id: draft.refId, title: draft.title, path: draft.path, text }));
  await recordContextItems(sessionId, "attached", [{ ...draft, chars }]);
  return sessionContext(sessionId, live.ctx);
}

/** Send a changed note's diff to the session that holds an older copy, and record the new version. */
export async function sendNoteUpdate(sessionId: string, itemId: string) {
  const item = await getContextItem(sessionId, itemId);
  if (!item) throw new HttpError(404, "Context item not found");
  if (item.kind !== "note" || !item.path) throw new HttpError(400, "Only notes can be sent as an update");
  const raw = await readFile(item.path, "utf8").catch(() => null);
  if (raw === null) throw new HttpError(409, "The note no longer exists");
  const after = sourceOf("note", raw);
  const hash = contentHash(after);
  const live = await running(sessionId);
  if (hash !== item.contentHash) {
    pushUserMessage(live, buildNoteUpdatePayload({ noteId: item.refId, title: item.title, path: item.path, before: item.content, after }));
    // Every copy the session holds (prompt, fetched, attached) is now this version.
    for (const copy of await listContextItems(sessionId))
      if (copy.kind === "note" && copy.path === item.path && copy.contentHash)
        await markContextItemSent(sessionId, copy.id, { contentHash: hash, content: after.length <= 200_000 ? after : null, chars: after.length });
  }
  return sessionContext(sessionId, live.ctx);
}

/** Remove (or keep) a prompt item from the next start or resume; the running prompt can't change. */
export async function setItemRemoved(sessionId: string, itemId: string, removed: boolean) {
  const item = await getContextItem(sessionId, itemId);
  if (!item) throw new HttpError(404, "Context item not found");
  if (item.origin !== "prompt") throw new HttpError(400, "Only prompt items can be removed; attached and fetched ones are already in the conversation");
  await setContextItemRemoved(sessionId, itemId, removed);
  return sessionContext(sessionId);
}

/** Running sessions holding this note, and whether each has the current version (the note editor's state). */
export async function noteHolders(path: string) {
  const items = await contextItemsForPath(path);
  const live = new Map(listLiveSessions().filter((l) => !isTerminated(l)).map((l) => [l.id, l]));
  const raw = await readFile(path, "utf8").catch(() => null);
  const hash = raw === null ? null : contentHash(sourceOf("note", raw));
  const bySession = new Map<string, { sessionId: string; title: string; itemId: string; changed: boolean }>();
  for (const item of items) {
    const session = live.get(item.sessionId) ?? getSession(item.sessionId);
    if (!session || !live.has(item.sessionId) || item.kind !== "note" || !item.contentHash) continue;
    if (item.mode !== "full" && item.mode !== "truncated") continue;
    if (item.origin === "prompt" && item.removedAt) continue;
    const changed = hash !== null && hash !== item.contentHash;
    const seen = bySession.get(item.sessionId);
    // A session can hold a note twice (prompt and fetched); it is current if any copy is.
    if (!seen) bySession.set(item.sessionId, { sessionId: item.sessionId, title: session.meta.title ?? "Untitled session", itemId: item.id, changed });
    else if (seen.changed && !changed) bySession.set(item.sessionId, { ...seen, changed: false });
    else if (seen.changed && changed && item.updatedAt > (items.find((i) => i.id === seen.itemId)?.updatedAt ?? "")) seen.itemId = item.id;
  }
  return [...bySession.values()];
}
