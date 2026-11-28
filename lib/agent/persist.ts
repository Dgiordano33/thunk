import "server-only";
import { insertDocument, updateDocument } from "@/lib/db/repo/documents";
import { insertEvents } from "@/lib/db/repo/messages";
import { addSessionCost, updateSession, upsertSession } from "@/lib/db/repo/sessions";
import { touchWorkspace } from "@/lib/db/repo/workspaces";
import { db, hasDatabase } from "@/lib/db/server";
import { insertSql, run, updateSql } from "@/lib/db/sql";
import type { Json } from "@/lib/db/types";
import { onSessionCreated, subscribe, type LiveSession } from "./session-registry";
import { sessionPersisted } from "@/lib/context/record";
import type { HarnessEvent } from "./types";

const FLUSH_MS = 300;

/** Tool-call rows are a side record; a failed write shouldn't stop the rest of the batch. */
const toolCalls = (write: Promise<unknown>) => write.catch((err) => console.error("[thunk] persist tool call failed", err));

/**
 * Mirrors a live session's event stream into the database. Writes are batched and
 * serialized per session; streaming deltas merge into one row per text run so
 * the messages table stays small but still replays through the client reducer.
 */
function persistSession(live: LiveSession) {
  if (!hasDatabase()) {
    sessionPersisted(live.id);
    return trackMemoryDocuments(live);
  }

  let queue: HarnessEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const permissionToolUse = new Map<string, string>();

  const ready = (async () => {
    await upsertSession(live.meta);
    sessionPersisted(live.id);
    await touchWorkspace(live.meta.workspaceId);
  })().catch((err) => console.error("[thunk] persist session failed", err));
  chain = ready;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = queue;
    queue = [];
    if (!batch.length) return;
    chain = chain.then(() => writeBatch(batch)).catch((err) => console.error("[thunk] persist failed", err));
  };

  const writeBatch = async (batch: HarnessEvent[]) => {
    const ids = await insertEvents(live.id, batch);
    const client = db()!;
    for (const e of batch) {
      switch (e.type) {
        case "init":
          await updateSession(live.id, {
            sdk_session_id: e.sdkSessionId,
            model: e.model,
            permission_mode: e.permissionMode,
          });
          break;
        case "status":
          await updateSession(live.id, {
            status: e.state,
            title: live.meta.title ?? null,
            ...(e.model ? { model: e.model } : {}),
            ...(e.permissionMode ? { permission_mode: e.permissionMode } : {}),
          });
          break;
        case "tool_use":
          await toolCalls(run(client, insertSql("tool_calls", {
            session_id: live.id,
            tool_use_id: e.toolUseId,
            name: e.name,
            input: e.input as Json,
            status: "running",
          }, { onConflict: "tool_use_id" })));
          break;
        case "tool_result":
          await toolCalls(run(client, updateSql("tool_calls", { output: e.content, is_error: e.isError, status: e.isError ? "error" : "done" }, "tool_use_id = $1", [e.toolUseId])!));
          break;
        case "permission_request":
          permissionToolUse.set(e.requestId, e.toolUseId);
          break;
        case "permission_resolved": {
          const toolUseId = permissionToolUse.get(e.requestId);
          if (toolUseId)
            await toolCalls(run(client, updateSql("tool_calls", { approval: e.decision }, "tool_use_id = $1", [toolUseId])!));
          break;
        }
        case "turn_complete":
          if (e.documentId)
            await insertDocument({
              id: e.documentId,
              sessionId: live.id,
              messageId: ids.get(e.seq),
              kind: "response",
              parentDocumentId: e.parentDocumentId,
              version: e.version,
              markdown: e.markdown,
            });
          break;
        case "plan_proposed":
          await insertDocument({
            id: e.documentId,
            sessionId: live.id,
            messageId: ids.get(e.seq),
            kind: "plan",
            parentDocumentId: e.parentDocumentId,
            version: e.version,
            markdown: e.plan,
          });
          break;
        case "plan_resolved":
          break;
        case "user_message":
          if (e.kind === "revision" && e.documentId) await updateDocument(e.documentId, { status: "sent" });
          break;
        case "result":
          await addSessionCost(live.id, e.costUsd);
          break;
      }
    }
  };

  subscribe(live, (e) => {
    const last = queue[queue.length - 1];
    if (
      (e.type === "text_delta" || e.type === "thinking_delta") &&
      last &&
      last.type === e.type &&
      last.turnId === e.turnId
    ) {
      queue[queue.length - 1] = { ...last, text: last.text + e.text, seq: e.seq, ts: e.ts };
    } else {
      queue.push(e);
    }
    const urgent =
      e.type === "turn_complete" || e.type === "plan_proposed" || e.type === "result" || e.type === "status";
    if (urgent) flush();
    else timer ??= setTimeout(flush, FLUSH_MS);
  });
}

/** Memory-only mode: register documents with the in-process store so edits can be saved and reloaded. */
function trackMemoryDocuments(live: LiveSession) {
  subscribe(live, (e) => {
    const write =
      e.type === "turn_complete" && e.documentId
        ? insertDocument({
            id: e.documentId,
            sessionId: live.id,
            kind: "response",
            parentDocumentId: e.parentDocumentId,
            version: e.version,
            markdown: e.markdown,
          })
        : e.type === "plan_proposed"
          ? insertDocument({
              id: e.documentId,
              sessionId: live.id,
              kind: "plan",
              parentDocumentId: e.parentDocumentId,
              version: e.version,
              markdown: e.plan,
            })
          : e.type === "user_message" && e.kind === "revision" && e.documentId
            ? updateDocument(e.documentId, { status: "sent" })
            : null;
    write?.catch((err) => console.error("[thunk] track document failed", err));
  });
}

onSessionCreated(persistSession);
