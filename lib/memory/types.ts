// Shared between server and client. Keep free of server-only imports.

export const MEMORY_OPS = ["add", "replace", "remove"] as const;
export type MemoryOp = (typeof MEMORY_OPS)[number];
export const MEMORY_KINDS = ["decision", "workaround"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryProposalStatus = "open" | "applied" | "rejected" | "empty";
export type MemoryProposalOrigin = "harvest" | "upkeep" | "agent";
export type MemoryItemDecision = "pending" | "accepted" | "rejected";

/** What a source id points at. Ids are task, session, note or workspace ids. */
export type MemorySource = { type: "task" | "session" | "note" | "workspace"; id: string; label?: string };

export type MemoryProposalItem = {
  id: string;
  position: number;
  op: MemoryOp;
  /** The exact existing text a replace or remove acts on. */
  target: string | null;
  /** The new text for add and replace. */
  text: string | null;
  kind: MemoryKind | null;
  sources: MemorySource[];
  reason: string;
  /** Workarounds get a date to check whether they are still needed (YYYY-MM-DD). */
  reviewAfter: string | null;
  decision: MemoryItemDecision;
  editedText: string | null;
  /** Why the item could not be applied, e.g. its target is no longer in memory. */
  flag: string | null;
};

export type MemoryProposal = {
  id: string;
  projectId: string;
  workspaceId: string | null;
  sessionId: string | null;
  runId: string | null;
  origin: MemoryProposalOrigin;
  status: MemoryProposalStatus;
  baseHash: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  items: MemoryProposalItem[];
};

/** One sidecar entry in `memory/sources.json`, keyed by the hash of the entry text. */
export type MemorySidecarEntry = {
  kind: MemoryKind | null;
  sources: MemorySource[];
  reason?: string;
  reviewAfter?: string | null;
  proposalId?: string;
  /** The start of the entry, so a person reading the file can tell which line it describes. */
  excerpt?: string;
  updatedAt: string;
};
export type MemorySidecar = Record<string, MemorySidecarEntry>;

/** A person's choice on one item when applying. `text` replaces the proposed text (an edit). */
export type MemoryItemChoice = { id: string; decision: "accepted" | "rejected"; text?: string };

/** Days a workaround stays trusted before upkeep asks whether it is still needed. */
export const WORKAROUND_REVIEW_DAYS = 90;

export const MEMORY_OP_LABELS: Record<MemoryOp, string> = { add: "Add", replace: "Replace", remove: "Remove" };
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = { decision: "Decision", workaround: "Workaround" };

export const memoryProposalPath = (id: string) => `/inbox/memory/${id}`;
