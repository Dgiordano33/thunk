// Shared between server and client. Keep free of server-only imports.

/** Matches the memory routes: `/api/projects/[id]/…` or `/api/workspaces/[id]/…`. */
export type NoteScopeKind = "projects" | "workspaces";

export type NoteScope = { kind: NoteScopeKind; id: string };

/** The virtual note that wraps a scope's MEMORY.md. */
export const MEMORY_NOTE_ID = "memory";

export type NoteFlags = {
  pinned: boolean;
  /** Full text goes into every session's system prompt for this scope. */
  inject: boolean;
  /** Unchecked `- [ ]` items surface as tasks. */
  actionable: boolean;
  tags: string[];
};

export type NoteMeta = NoteFlags & {
  id: string;
  scope: NoteScope;
  title: string;
  /** Absolute path of the backing file. */
  path: string;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
  openTasks: number;
  doneTasks: number;
};

export type Note = NoteMeta & { markdown: string };

export type NoteTask = {
  noteId: string;
  noteTitle: string;
  notePath: string;
  /** 0-based line in the note body. */
  line: number;
  text: string;
  done: boolean;
};

export type NoteEvent = { scope: NoteScope; noteId: string; kind: "changed" | "removed" };

export type NoteFolder = {
  project: { id: string; name: string };
  notes: NoteMeta[];
  workspaces: { workspace: { id: string; name: string; slug: string }; notes: NoteMeta[] }[];
};

export const scopeKey = (s: NoteScope) => `${s.kind === "projects" ? "p" : "w"}:${s.id}`;

export function parseScopeKey(key: string | null | undefined): NoteScope | null {
  const m = /^([pw]):(.+)$/.exec(key ?? "");
  return m ? { kind: m[1] === "p" ? "projects" : "workspaces", id: m[2] } : null;
}

/** Pinned first (memory before other pins), then most recently updated. */
export function sortNotes<T extends Pick<NoteMeta, "id" | "pinned" | "updatedAt">>(notes: T[]): T[] {
  return [...notes].sort(
    (a, b) =>
      Number(b.id === MEMORY_NOTE_ID) - Number(a.id === MEMORY_NOTE_ID) ||
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}
