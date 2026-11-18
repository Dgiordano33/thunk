"use client";

import { useIsDesktop } from "@/components/mobile/viewport";
import { useCallback, useState } from "react";
import { EmptyMark } from "@/components/space/orbit-mark";
import { api } from "@/lib/client/api";
import { scopeKey, type NoteMeta, type NoteScope } from "@/lib/notes/types";
import { useNotesFeed, useScopeNotes } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";
import { CollapsiblePane } from "./collapsible-pane";
import { NoteEditor } from "./note-editor";
import { NewRepoNote } from "./new-repo-note";
import { NoteList } from "./note-list";
import { confirm } from "@/components/confirm";

/** Create and delete notes in a scope, keeping every open view in sync. */
export function useNoteActions(scope: NoteScope | null, onSelect: (id: string | null) => void) {
  const [creating, setCreating] = useState<NoteScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const created = useCallback((target: NoteScope, id: string) => {
    useNotesFeed.getState().touch(target);
    onSelect(scope ? id : `${scopeKey(target)}/${id}`);
    setCreating(null);
  }, [scope, onSelect]);
  const create = useCallback(async (target = scope) => {
    if (!target) return;
    if (target.kind === "repos") { setCreating(target); return; }
    try {
    const { note } = await api.createNote(target.kind, target.id, { title: "Untitled" });
    created(target, note.id);
    } catch (err) { setError((err as Error).message); }
  }, [scope, created]);
  const remove = useCallback(
    async (note: NoteMeta) => {
      if (!(await confirm(note.source === "repo"
        ? { title: `Delete ${note.path}?`, description: "This removes the file from the working tree.", action: "Delete", destructive: true }
        : { title: `Delete “${note.title}”?`, description: "This removes the file from disk.", action: "Delete", destructive: true }))) return;
      await api.deleteNote(note.scope.kind, note.scope.id, note.id);
      useNotesFeed.getState().touch(note.scope);
      onSelect(null);
    },
    [onSelect],
  );
  const dialog = <>{error && <p role="alert" className="text-destructive p-2 text-xs">{error}</p>}{creating && <NewRepoNote scope={creating} onClose={() => setCreating(null)} onCreated={(id) => created(creating, id)} />}</>;
  return { create, remove, dialog };
}

/** List + editor for one scope: the body of the town Library panel and the right two panes of /notes. */
export function ScopeNotes({
  scope,
  selectedId,
  onSelect,
  listHeader,
  listTitle,
  className,
  topLevel,
}: {
  scope: NoteScope;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  listHeader?: React.ReactNode;
  /** Render the list as a collapsible pane with this title (replaces listHeader). */
  listTitle?: string;
  className?: string;
  topLevel?: boolean;
}) {
  const desktop = useIsDesktop();
  const { notes } = useScopeNotes(scope);
  const { create, remove, dialog } = useNoteActions(scope, onSelect);
  const selected = selectedId;
  const list = <NoteList notes={notes} selectedId={selected} onSelect={onSelect} onCreate={() => void create()} onDelete={(n) => void remove(n)} />;

  if (!desktop) return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{dialog}{selected ? <><button className="min-h-11 border-b px-4 text-left" onClick={() => onSelect(null)}>← Notes</button><NoteEditor key={selected} scope={scope} noteId={selected} onDeleted={() => onSelect(null)} topLevel={topLevel} /></> : <>{listHeader}{list}</>}</div>;
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      {dialog}
      {listTitle ? (
        <CollapsiblePane title={listTitle} className="w-64">
          {list}
        </CollapsiblePane>
      ) : (
        <div className="flex w-64 shrink-0 flex-col border-r">
          {listHeader}
          {list}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <NoteEditor key={selected} scope={scope} noteId={selected} onDeleted={() => onSelect(null)} topLevel={topLevel} />
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
        <EmptyMark name="quill" className="mb-2" pixelClassName="mb-3 size-10" />
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
