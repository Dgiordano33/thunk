import type { NoteScope } from "./types";

export function repoTaskLink(folderId: string, noteId: string) { return `r:${folderId}:${noteId}`; }
export function parseRepoTaskLink(value: string | null | undefined): { scope: NoteScope; id: string } | null {
  const match = /^r:([0-9a-f-]{36}):([a-z0-9][a-z0-9_-]{0,63})$/i.exec(value ?? "");
  return match ? { scope: { kind: "repos", id: match[1] }, id: match[2] } : null;
}
