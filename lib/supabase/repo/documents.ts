import "server-only";
import type { DocComment, DocumentKind, DocumentStatus, PersistedDocument } from "@/lib/documents/types";
import type { Json, TablesUpdate } from "../types";
import { db } from "../server";

// Memory-only mode (no Supabase): keep documents for the server's lifetime so
// edits and comments survive a page reload. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & {
  __thunkMemDocs?: Map<string, { sessionId: string; doc: PersistedDocument }>;
};
const memDocs = (g.__thunkMemDocs ??= new Map());

export async function insertDocument(doc: {
  id: string;
  sessionId: string;
  messageId?: string | null;
  kind: DocumentKind;
  parentDocumentId?: string | null;
  version: number;
  markdown: string;
}) {
  const client = db();
  if (!client) {
    if (!memDocs.has(doc.id))
      memDocs.set(doc.id, {
        sessionId: doc.sessionId,
        doc: {
          id: doc.id,
          kind: doc.kind,
          parentDocumentId: doc.parentDocumentId ?? null,
          version: doc.version,
          originalMarkdown: doc.markdown,
          baselineMarkdown: null,
          currentMarkdown: doc.markdown,
          contentJson: null,
          status: "draft",
          comments: [],
        },
      });
    return;
  }
  const { error } = await client.from("documents").upsert(
    {
      id: doc.id,
      session_id: doc.sessionId,
      message_id: doc.messageId ?? null,
      kind: doc.kind,
      parent_document_id: doc.parentDocumentId ?? null,
      version: doc.version,
      original_markdown: doc.markdown,
      current_markdown: doc.markdown,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function updateDocument(
  id: string,
  patch: { currentMarkdown?: string; baselineMarkdown?: string; contentJson?: unknown; status?: DocumentStatus },
) {
  const client = db();
  if (!client) {
    const d = memDocs.get(id)?.doc;
    if (!d) return;
    if (patch.currentMarkdown !== undefined) d.currentMarkdown = patch.currentMarkdown;
    if (patch.baselineMarkdown !== undefined) d.baselineMarkdown = patch.baselineMarkdown;
    if (patch.contentJson !== undefined) d.contentJson = patch.contentJson;
    if (patch.status !== undefined) d.status = patch.status;
    return;
  }
  const update: TablesUpdate<"documents"> = {};
  if (patch.currentMarkdown !== undefined) update.current_markdown = patch.currentMarkdown;
  if (patch.baselineMarkdown !== undefined) update.baseline_markdown = patch.baselineMarkdown;
  if (patch.contentJson !== undefined) update.content_json = patch.contentJson as Json;
  if (patch.status !== undefined) update.status = patch.status;
  const { error } = await client.from("documents").update(update).eq("id", id);
  if (error) throw error;
}

/** Replace a document's comment set with the client's current list. */
export async function syncComments(documentId: string, comments: DocComment[]) {
  const client = db();
  if (!client) {
    const d = memDocs.get(documentId)?.doc;
    if (d) d.comments = structuredClone(comments);
    return;
  }
  const rows = comments.flatMap((c) => [
    {
      id: c.id,
      document_id: documentId,
      thread_id: c.id,
      anchor: { quote: c.quote, from: c.from ?? null, to: c.to ?? null } as Json,
      body: c.body,
      kind: c.kind,
      status: c.status,
      created_at: c.createdAt,
    },
    ...c.replies.map((r) => ({
      id: r.id,
      document_id: documentId,
      thread_id: c.id,
      anchor: null,
      body: r.body,
      kind: c.kind,
      status: c.status,
      created_at: r.createdAt,
    })),
  ]);
  const keep = rows.map((r) => r.id);
  let del = client.from("comments").delete().eq("document_id", documentId);
  if (keep.length) del = del.not("id", "in", `(${keep.join(",")})`);
  const { error: delError } = await del;
  if (delError) throw delError;
  if (rows.length) {
    const { error } = await client.from("comments").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function insertRevision(rev: { documentId: string; diff: string; payload: string; stat: unknown }) {
  const client = db();
  if (!client) return;
  const { error } = await client.from("document_revisions").insert({
    document_id: rev.documentId,
    diff: rev.diff,
    payload: rev.payload,
    stat: rev.stat as Json,
  });
  if (error) throw error;
}

export async function loadDocuments(sessionId: string): Promise<PersistedDocument[]> {
  const client = db();
  if (!client) {
    return [...memDocs.values()].filter((m) => m.sessionId === sessionId).map((m) => structuredClone(m.doc));
  }
  const { data: docs, error } = await client
    .from("documents")
    .select(
      "id, kind, parent_document_id, version, original_markdown, baseline_markdown, current_markdown, content_json, status",
    )
    .eq("session_id", sessionId);
  if (error) throw error;
  if (!docs.length) return [];

  const { data: rows, error: cErr } = await client
    .from("comments")
    .select("id, document_id, thread_id, anchor, body, kind, status, created_at")
    .in(
      "document_id",
      docs.map((d) => d.id),
    )
    .order("created_at", { ascending: true });
  if (cErr) throw cErr;

  const byDoc = new Map<string, DocComment[]>();
  const roots = new Map<string, DocComment>();
  for (const r of rows) {
    if (r.id !== r.thread_id) continue;
    const anchor = (r.anchor ?? {}) as { quote?: string; from?: number | null; to?: number | null };
    const c: DocComment = {
      id: r.id,
      documentId: r.document_id,
      kind: r.kind as DocComment["kind"],
      status: r.status as DocComment["status"],
      body: r.body,
      quote: anchor.quote ?? "",
      from: anchor.from ?? undefined,
      to: anchor.to ?? undefined,
      createdAt: r.created_at,
      replies: [],
    };
    roots.set(r.id, c);
    byDoc.set(r.document_id, [...(byDoc.get(r.document_id) ?? []), c]);
  }
  for (const r of rows) {
    if (r.id === r.thread_id) continue;
    roots.get(r.thread_id)?.replies.push({ id: r.id, body: r.body, createdAt: r.created_at });
  }

  return docs.map((d) => ({
    id: d.id,
    kind: d.kind as DocumentKind,
    parentDocumentId: d.parent_document_id,
    version: d.version,
    originalMarkdown: d.original_markdown,
    baselineMarkdown: d.baseline_markdown,
    currentMarkdown: d.current_markdown,
    contentJson: d.content_json,
    status: d.status as DocumentStatus,
    comments: byDoc.get(d.id) ?? [],
  }));
}
