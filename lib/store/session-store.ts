"use client";

import type { PromptImage } from "@/lib/prompts/schema";

import { create } from "zustand";
import type { HarnessEvent, PermissionSuggestion, Question, SessionMeta, SessionState } from "@/lib/agent/types";
import type { ConnectionState } from "@/lib/client/sse";
import type { DocComment, DocumentKind, DocumentStatus, PersistedDocument } from "@/lib/documents/types";

export type TurnPart = { kind: "text"; text: string } | { kind: "tool"; toolUseId: string };

export type Turn = {
  id: string;
  parts: TurnPart[];
  thinking: string;
  status: "streaming" | "complete";
  documentId: string | null;
};

export type ToolCall = {
  id: string;
  turnId: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  status: "running" | "done" | "error";
  approval?: "allow" | "deny" | "cancelled";
};

type RequestBase = { id: string; toolUseId: string; status: "pending" | "resolved" | "expired" };
export type PendingRequest =
  | (RequestBase & {
      kind: "permission";
      toolName: string;
      input: unknown;
      title?: string;
      description?: string;
      decisionReason?: string;
      suggestions?: PermissionSuggestion[];
      decision?: "allow" | "deny" | "cancelled";
    })
  | (RequestBase & { kind: "question"; questions: Question[]; answers?: Record<string, string> | null })
  | (RequestBase & { kind: "plan"; documentId: string; decision?: "approve" | "changes" | "cancelled" });

export type DocState = PersistedDocument & {
  turnId?: string;
  requestId?: string;
};

export type TimelineItem =
  | {
      kind: "user";
      id: string;
      content: string;
      images?: PromptImage[];
      queued?: boolean;
      revision?: { documentId: string; edits: number; comments: number };
    }
  | { kind: "turn"; id: string }
  | { kind: "request"; id: string }
  | { kind: "error"; id: string; message: string };

type SessionData = {
  sessionId: string | null;
  meta: SessionMeta | null;
  status: SessionState;
  connection: ConnectionState;
  lastSeq: number;
  items: TimelineItem[];
  turns: Record<string, Turn>;
  tools: Record<string, ToolCall>;
  requests: Record<string, PendingRequest>;
  /** toolUseId → requestId, so turns can render approvals inline with their tool call. */
  requestByToolUse: Record<string, string>;
  documents: Record<string, DocState>;
  activeDocumentId: string | null;
  activeCommentId: string | null;
  /** Freshly created comment whose composer should take focus. */
  composingCommentId: string | null;
  costUsd: number;
  numTurns: number;
};

type Actions = {
  hydrate: (input: { meta: SessionMeta; events: HarnessEvent[]; documents: PersistedDocument[] }) => void;
  applyEvent: (e: HarnessEvent) => void;
  setConnection: (c: ConnectionState) => void;
  setMeta: (patch: Partial<SessionMeta>) => void;
  setActiveDocument: (id: string | null) => void;
  setActiveComment: (id: string | null, documentId?: string) => void;
  updateDocument: (id: string, patch: Partial<DocState>) => void;
  addComment: (c: DocComment) => void;
  updateComment: (documentId: string, commentId: string, patch: Partial<DocComment>) => void;
  deleteComment: (documentId: string, commentId: string) => void;
  setComposing: (id: string | null) => void;
};

export type SessionStore = SessionData & Actions;

const initial: SessionData = {
  sessionId: null,
  meta: null,
  status: "idle",
  connection: "connecting",
  lastSeq: 0,
  items: [],
  turns: {},
  tools: {},
  requests: {},
  requestByToolUse: {},
  documents: {},
  activeDocumentId: null,
  activeCommentId: null,
  composingCommentId: null,
  costUsd: 0,
  numTurns: 0,
};

function newDoc(
  id: string,
  kind: DocumentKind,
  markdown: string,
  extra: { parentDocumentId?: string; version: number; turnId?: string; requestId?: string },
): DocState {
  return {
    id,
    kind,
    parentDocumentId: extra.parentDocumentId ?? null,
    version: extra.version,
    originalMarkdown: markdown,
    baselineMarkdown: null,
    currentMarkdown: markdown,
    contentJson: null,
    status: "draft",
    comments: [],
    turnId: extra.turnId,
    requestId: extra.requestId,
  };
}

/** Index a new request by tool call; only orphan requests (no rendered tool call) get their own timeline row. */
function addRequest(s: SessionData, req: PendingRequest): Partial<SessionData> {
  const inline = Boolean(s.tools[req.toolUseId]);
  return {
    requests: { ...s.requests, [req.id]: req },
    requestByToolUse: { ...s.requestByToolUse, [req.toolUseId]: req.id },
    items: inline ? s.items : [...s.items, { kind: "request", id: req.id }],
  };
}

function setDocStatus(s: SessionData, id: string | undefined, status: DocumentStatus): Partial<SessionData> {
  if (!id || !s.documents[id]) return {};
  return { documents: { ...s.documents, [id]: { ...s.documents[id], status } } };
}

/** Pure event reducer: (state, event) → patch. Shared by live SSE and Supabase hydration. */
function reduce(s: SessionData, e: HarnessEvent): Partial<SessionData> {
  switch (e.type) {
    case "init":
      return s.meta
        ? { meta: { ...s.meta, sdkSessionId: e.sdkSessionId, model: e.model, permissionMode: e.permissionMode } }
        : {};

    case "status": {
      const patch: Partial<SessionData> = { status: e.state };
      if (s.meta)
        patch.meta = {
          ...s.meta,
          status: e.state,
          model: e.model ?? s.meta.model,
          permissionMode: e.permissionMode ?? s.meta.permissionMode,
          live: e.state === "closed" || e.state === "error" ? false : s.meta.live,
        };
      if (e.resumed) {
        // A new process can't answer requests parked by the previous one.
        const requests = { ...s.requests };
        for (const [id, r] of Object.entries(requests))
          if (r.status === "pending") requests[id] = { ...r, status: "expired" };
        const turns = { ...s.turns };
        for (const [id, t] of Object.entries(turns))
          if (t.status === "streaming") turns[id] = { ...t, status: "complete" };
        patch.requests = requests;
        patch.turns = turns;
      }
      return patch;
    }

    case "message_dequeued":
      return { items: s.items.map((item) => item.kind === "user" && item.id === e.messageId ? { ...item, queued: false } : item) };

    case "user_message":
      return {
        items: [
          ...s.items,
          {
            kind: "user",
            id: e.messageId,
            content: e.content,
            images: e.images,
            queued: e.queued,
            revision:
              e.kind === "revision" && e.documentId
                ? { documentId: e.documentId, edits: e.stat?.edits ?? 0, comments: e.stat?.comments ?? 0 }
                : undefined,
          },
        ],
        ...setDocStatus(s, e.kind === "revision" ? e.documentId : undefined, "sent"),
      };

    case "turn_start":
      if (s.turns[e.turnId]) return {};
      return {
        turns: {
          ...s.turns,
          [e.turnId]: { id: e.turnId, parts: [], thinking: "", status: "streaming", documentId: null },
        },
        items: [...s.items, { kind: "turn", id: e.turnId }],
      };

    case "text_delta": {
      const t = s.turns[e.turnId];
      if (!t) return {};
      const parts = [...t.parts];
      const last = parts[parts.length - 1];
      if (last?.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + e.text };
      else parts.push({ kind: "text", text: e.text });
      return { turns: { ...s.turns, [t.id]: { ...t, parts } } };
    }

    case "thinking_delta": {
      const t = s.turns[e.turnId];
      if (!t) return {};
      return { turns: { ...s.turns, [t.id]: { ...t, thinking: t.thinking + e.text } } };
    }

    case "tool_use": {
      const t = s.turns[e.turnId];
      return {
        tools: {
          ...s.tools,
          [e.toolUseId]: { id: e.toolUseId, turnId: e.turnId, name: e.name, input: e.input, status: "running" },
        },
        turns: t
          ? { ...s.turns, [t.id]: { ...t, parts: [...t.parts, { kind: "tool", toolUseId: e.toolUseId }] } }
          : s.turns,
      };
    }

    case "tool_result": {
      const tool = s.tools[e.toolUseId];
      if (!tool) return {};
      return {
        tools: {
          ...s.tools,
          [e.toolUseId]: { ...tool, output: e.content, isError: e.isError, status: e.isError ? "error" : "done" },
        },
      };
    }

    case "permission_request":
      return addRequest(s, {
        kind: "permission",
        id: e.requestId,
        toolUseId: e.toolUseId,
        status: "pending",
        toolName: e.toolName,
        input: e.input,
        title: e.title,
        description: e.description,
        decisionReason: e.decisionReason,
        suggestions: e.suggestions,
      });

    case "permission_resolved": {
      const r = s.requests[e.requestId];
      if (!r || r.kind !== "permission") return {};
      const tool = s.tools[r.toolUseId];
      return {
        requests: { ...s.requests, [r.id]: { ...r, status: "resolved", decision: e.decision } },
        tools: tool ? { ...s.tools, [tool.id]: { ...tool, approval: e.decision } } : s.tools,
      };
    }

    case "ask_question":
      return addRequest(s, {
        kind: "question",
        id: e.requestId,
        toolUseId: e.toolUseId,
        status: "pending",
        questions: e.questions,
      });

    case "question_resolved": {
      const r = s.requests[e.requestId];
      if (!r || r.kind !== "question") return {};
      return { requests: { ...s.requests, [r.id]: { ...r, status: "resolved", answers: e.answers } } };
    }

    case "plan_proposed":
      return {
        ...addRequest(s, {
          kind: "plan",
          id: e.requestId,
          toolUseId: e.toolUseId,
          status: "pending",
          documentId: e.documentId,
        }),
        documents: {
          ...s.documents,
          // Keep a hydrated doc (with the user's edits) when SSE replays this event, but restore
          // its request linkage — persisted docs don't carry it.
          [e.documentId]: s.documents[e.documentId]
            ? { ...s.documents[e.documentId], requestId: e.requestId }
            : newDoc(e.documentId, "plan", e.plan, {
              parentDocumentId: e.parentDocumentId,
              version: e.version,
              requestId: e.requestId,
            }),
        },
        activeDocumentId: e.documentId,
      };

    case "plan_resolved": {
      const r = s.requests[e.requestId];
      if (!r || r.kind !== "plan") return {};
      const docStatus: DocumentStatus | null =
        e.decision === "approve" ? "approved" : e.decision === "changes" ? "sent" : null;
      return {
        requests: { ...s.requests, [r.id]: { ...r, status: "resolved", decision: e.decision } },
        ...(docStatus ? setDocStatus(s, r.documentId, docStatus) : {}),
      };
    }

    case "turn_complete": {
      const t = s.turns[e.turnId];
      if (!t) return {};
      const patch: Partial<SessionData> = {
        turns: { ...s.turns, [t.id]: { ...t, status: "complete", documentId: e.documentId } },
      };
      if (e.documentId) {
        patch.documents = {
          ...s.documents,
          // Keep a hydrated doc (with the user's edits) when SSE replays this event, but restore
          // its turn linkage — persisted docs don't carry it.
          [e.documentId]: s.documents[e.documentId]
            ? { ...s.documents[e.documentId], turnId: t.id }
            : newDoc(e.documentId, "response", e.markdown, {
              parentDocumentId: e.parentDocumentId,
              version: e.version,
              turnId: t.id,
            }),
        };
        patch.activeDocumentId = e.documentId;
      }
      return patch;
    }

    case "result":
      return { costUsd: s.costUsd + (e.costUsd || 0), numTurns: s.numTurns + (e.numTurns || 0) };

    case "error":
      return { items: [...s.items, { kind: "error", id: `err-${e.seq}`, message: e.message }] };
  }
}

export const useSession = create<SessionStore>()((set, get) => ({
  ...initial,

  hydrate: ({ meta, events, documents }) => {
    let s: SessionData = { ...initial, sessionId: meta.id, meta, status: meta.status };
    for (const e of events) {
      if (e.seq <= s.lastSeq) continue;
      s = { ...s, ...reduce(s, e), lastSeq: e.seq };
    }
    // Overlay persisted editor state (edits, comment marks, comments) on event-derived docs.
    const docs = { ...s.documents };
    for (const d of documents) {
      const base = docs[d.id];
      docs[d.id] = base ? { ...base, ...d, turnId: base.turnId, requestId: base.requestId } : d;
    }
    // A non-live session can't answer anything that was pending.
    const requests = { ...s.requests };
    if (!meta.live)
      for (const [id, r] of Object.entries(requests))
        if (r.status === "pending") requests[id] = { ...r, status: "expired" };
    set({ ...s, documents: docs, requests });
  },

  applyEvent: (e) => {
    const s = get();
    if (e.sessionId !== s.sessionId || e.seq <= s.lastSeq) return;
    set({ ...reduce(s, e), lastSeq: e.seq });
  },

  setConnection: (connection) => set({ connection }),

  setMeta: (patch) => set((s) => ({ meta: s.meta ? { ...s.meta, ...patch } : s.meta })),

  setActiveDocument: (activeDocumentId) => set({ activeDocumentId }),

  setActiveComment: (activeCommentId, documentId) =>
    set((s) => ({ activeCommentId, activeDocumentId: documentId ?? s.activeDocumentId })),

  updateDocument: (id, patch) =>
    set((s) => (s.documents[id] ? { documents: { ...s.documents, [id]: { ...s.documents[id], ...patch } } } : {})),

  addComment: (c) =>
    set((s) => {
      const d = s.documents[c.documentId];
      if (!d) return {};
      return {
        documents: { ...s.documents, [d.id]: { ...d, comments: [...d.comments, c] } },
        activeCommentId: c.id,
        activeDocumentId: d.id,
        composingCommentId: c.id,
      };
    }),

  updateComment: (documentId, commentId, patch) =>
    set((s) => {
      const d = s.documents[documentId];
      if (!d) return {};
      return {
        documents: {
          ...s.documents,
          [d.id]: { ...d, comments: d.comments.map((c) => (c.id === commentId ? { ...c, ...patch } : c)) },
        },
      };
    }),

  deleteComment: (documentId, commentId) =>
    set((s) => {
      const d = s.documents[documentId];
      if (!d) return {};
      return {
        documents: { ...s.documents, [d.id]: { ...d, comments: d.comments.filter((c) => c.id !== commentId) } },
        activeCommentId: s.activeCommentId === commentId ? null : s.activeCommentId,
        composingCommentId: s.composingCommentId === commentId ? null : s.composingCommentId,
      };
    }),

  setComposing: (composingCommentId) => set({ composingCommentId }),
}));
