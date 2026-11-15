"use client";

import { projectSectionPath } from "@/lib/routes";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoteList } from "@/components/notes/note-list";
import type { NoteScope } from "@/lib/notes/types";
import { useScopeNotes } from "@/lib/store/notes-store";

/** A short note list (memory first) that opens the note in the town Library panel. */
export function TownNotes({ townHref, scope, limit = 5 }: { townHref: string; scope: NoteScope; limit?: number }) {
  const router = useRouter();
  const { notes } = useScopeNotes(scope);
  const query: Record<string, string> = scope.kind === "workspaces" ? { nws: scope.id } : {};
  const base = projectSectionPath(townHref, "library", query);
  return (
    <div className="-mx-2">
      <NoteList compact notes={notes?.slice(0, limit) ?? null} onSelect={(id) => router.push(projectSectionPath(townHref, "library", { ...query, note: id }), { scroll: false })} />
      <Link href={base} scroll={false} className="text-primary px-2 text-xs hover:underline">
        {notes && notes.length > limit ? `All ${notes.length} notes →` : "Open the library →"}
      </Link>
    </div>
  );
}
