// Shared between server and client. Keep free of server-only imports.

export const CONTEXT_KINDS = ["memory", "instructions", "note", "task", "vault", "routine"] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/** full: all of it; truncated: cut at a limit; index: only listed (title, id); omitted: not sent. */
export type ContextMode = "full" | "truncated" | "index" | "omitted";
export type ContextOrigin = "prompt" | "fetched" | "attached";

/**
 * One thing a prompt builder put in (or left out of) a session's context. `source` is the whole
 * text the item stands for (not the cut piece), hashed to tell later whether it changed.
 */
export type ContextItemDraft = {
  kind: ContextKind;
  refId: string;
  title: string;
  mode: ContextMode;
  /** Characters actually sent. */
  chars: number;
  reason?: string | null;
  path?: string | null;
  source?: string | null;
  /** Keep the source text so a later update can be sent as a diff (notes). */
  keepContent?: boolean;
};

/** A prompt section and what went into it. */
export type PromptPart = { text: string; items: ContextItemDraft[] };

export type SessionContextItem = {
  id: string;
  sessionId: string;
  kind: ContextKind;
  refId: string;
  title: string;
  path: string | null;
  mode: ContextMode;
  reason: string | null;
  chars: number;
  contentHash: string | null;
  origin: ContextOrigin;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** What the Context view shows per item. */
export type ContextViewItem = SessionContextItem & {
  /** The file or record changed since the session got it; null when there is nothing to compare. */
  changedSince: boolean | null;
  /** Removed after the current prompt was built: it is still in context until the next start or resume. */
  removalPending: boolean;
  /** Send update applies (a note whose text the session holds). */
  canUpdate: boolean;
  /** Remove applies (prompt items Thunk injected). */
  canRemove: boolean;
};

export type ContextGroup = "prompt" | "attached" | "fetched" | "left_out";

export const CONTEXT_GROUP_LABELS: Record<ContextGroup, string> = {
  prompt: "In the prompt",
  attached: "Attached",
  fetched: "Fetched later",
  left_out: "Left out",
};

export const CONTEXT_KIND_LABELS: Record<ContextKind, string> = {
  memory: "Memory",
  instructions: "Instructions",
  note: "Note",
  task: "Task",
  vault: "Vault",
  routine: "Routine",
};

/** Left out: not sent at all, or only listed when its content could have been injected. */
export function contextGroup(item: Pick<SessionContextItem, "mode" | "reason" | "origin" | "removedAt"> & { removalPending?: boolean }): ContextGroup {
  if (item.removedAt && !item.removalPending) return "left_out";
  if (item.mode === "omitted" || (item.mode === "index" && item.reason)) return "left_out";
  if (item.origin === "fetched") return "fetched";
  if (item.origin === "attached") return "attached";
  return "prompt";
}

export const contextKey = (kind: ContextKind, refId: string) => `${kind}:${refId}`;

/** Reasons recorded where the prompt builders decide. */
export const REASONS = {
  overLimit: (limit: number) => `Over the ${limit.toLocaleString("en-US")}-character limit`,
  notInjected: "Not marked to inject; only listed",
  notPinned: "Not pinned; only listed",
  notListed: (limit: number) => `Not listed; only the newest ${limit} are`,
  autoMemory: "Loaded by Claude's auto-memory (first 200 lines)",
  readOnDemand: "Not injected; the agent is told to read it",
  removed: "Removed by you",
  missing: "No longer exists",
};
