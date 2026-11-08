"use client";

import { useCallback } from "react";
import { PixelIcon } from "@/components/world/pixel-icon";
import { api } from "@/lib/client/api";
import type { NoteMeta, NoteScope } from "@/lib/notes/types";
import { useNotesFeed, useScopeNotes } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";
import { NoteEditor } from "./note-editor";
import { NoteList } from "./note-list";

/** Create and delete notes in a scope, keeping every open view in sync. */
export function useNoteActions(scope: NoteScope | null, onSelect: (id: string | null) => void) {
  const create = useCallback(async () => {
    if (!scope) return;
    const { note } = await api.createNote(scope.kind, scope.id, { title: "Untitled" });
    useNotesFeed.getState().touch(scope);
    onSelect(note.id);
  }, [scope, onSelect]);
  const remove = useCallback(
    async (note: NoteMeta) => {
      if (!window.confirm(`Delete "${note.title}"? This removes the file from disk.`)) return;
      await api.deleteNote(note.scope.kind, note.scope.id, note.id);
      useNotesFeed.getState().touch(note.scope);
      onSelect(null);
    },
    [onSelect],
  );
  return { create, remove };
}

/** List + editor for one scope: the body of the town Library panel and the right two panes of /notes. */
export function ScopeNotes({
  scope,
  selectedId,
  onSelect,
  listHeader,
  className,
}: {
  scope: NoteScope;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  listHeader?: React.ReactNode;
  className?: string;
}) {
  const { notes } = useScopeNotes(scope);
  const { create, remove } = useNoteActions(scope, onSelect);
  const selected = selectedId;

  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div className="flex w-64 shrink-0 flex-col border-r">
        {listHeader}
        <NoteList notes={notes} selectedId={selected} onSelect={onSelect} onCreate={() => void create()} onDelete={(n) => void remove(n)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <NoteEditor key={selected} scope={scope} noteId={selected} onDeleted={() => onSelect(null)} />
        ) : (
          <EmptyNote onCreate={() => void create()} />
        )}
      </div>
    </div>
  );
}

export function EmptyNote({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="is-parchment flex max-w-xs flex-col items-center rounded-sm bg-[var(--w-parchment)] px-6 py-6 text-center text-[var(--w-parchment-ink)]">
        <PixelIcon name="quill" className="mb-3 size-10" />
        <p className="pixel text-base">Pick a note</p>
        <p className="mt-1 text-xs opacity-80">
          Or{" "}
          {onCreate ? (
            <button type="button" onClick={onCreate} className="underline underline-offset-2">
              start a new one
            </button>
          ) : (
            "start a new one"
          )}{" "}
          (⌘N). Notes are markdown files agents read and edit too.
        </p>
      </div>
    </div>
  );
}
