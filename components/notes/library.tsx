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
import { ArrowLeftIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { AddContextButton, ContextDropArea } from "@/components/vault/add-context";

/** Create and delete notes in a scope, keeping every open view in sync. */
export function useNoteActions(scope: NoteScope | null, onSelect: (id: string | null) => void) {
  const [creating, setCreating] = useState<NoteScope | null>(null);
  const created = useCallback((target: NoteScope, id: string) => {
    useNotesFeed.getState().touch(target);
    onSelect(scope ? id : `${scopeKey(target)}/${id}`);
    setCreating(null);
  }, [scope, onSelect]);
  const create = useCallback(async (target = scope) => {
    if (!target) return;
    if (target.kind === "repos") { setCreating(target); return; }
    try {
      const { note } = await api.createNote(target.kind, target.id, {});
      created(target, note.id);
    } catch (err) {
      toast.error("Couldn't create the note", { description: (err as Error).message });
    }
  }, [scope, created]);
  const remove = useCallback(
    async (note: NoteMeta) => {
      if (!(await confirm(note.source === "repo"
        ? { title: `Delete ${note.path}?`, description: "This removes the file from the working tree.", action: "Delete", destructive: true }
        : { title: `Delete “${note.title}”?`, description: "This removes the file from disk.", action: "Delete", destructive: true }))) return;
      try {
        await api.deleteNote(note.scope.kind, note.scope.id, note.id);
      } catch (err) {
        toast.error("Couldn't delete the note", { description: (err as Error).message });
        return;
      }
      useNotesFeed.getState().touch(note.scope);
      onSelect(null);
    },
    [onSelect],
  );
  const dialog = <>{creating && <NewRepoNote scope={creating} onClose={() => setCreating(null)} onCreated={(id) => created(creating, id)} />}</>;
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
  projectId,
}: {
  scope: NoteScope;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  listHeader?: React.ReactNode;
  /** Render the list as a collapsible pane with this title (replaces listHeader). */
  listTitle?: string;
  className?: string;
  topLevel?: boolean;
  /** The project this notebook belongs to: enables dropping files in (text → notes here, the rest → its Vault). */
  projectId?: string;
}) {
  const desktop = useIsDesktop();
  const { notes } = useScopeNotes(scope);
  const { create, remove, dialog } = useNoteActions(scope, onSelect);
  const selected = selectedId;
  const target = projectId ? { projectId, noteScope: scope } : null;
  const list = <NoteList notes={notes} selectedId={selected} onSelect={onSelect} onCreate={() => void create()} onDelete={(n) => void remove(n)} extraControl={target && <AddContextButton target={target} />} />;

  if (!desktop) return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{dialog}{selected ? <><BackToNotes onClick={() => onSelect(null)} /><NoteEditor key={selected} scope={scope} noteId={selected} onDeleted={() => onSelect(null)} topLevel={topLevel} /></> : <>{listHeader}{list}</>}</div>;
  const body = (
    <div className={cn("flex min-h-0 flex-1", !target && className)}>
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
          <EmptyNote onCreate={() => void create()} dropHint={Boolean(target)} />
        )}
      </div>
    </div>
  );
  return target ? <ContextDropArea target={target} className={cn("flex min-h-0 flex-1", className)}>{body}</ContextDropArea> : body;
}

/** Mobile: back from the editor to the list. */
export function BackToNotes({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex min-h-11 shrink-0 items-center border-b px-2">
      <Button variant="ghost" size="sm" onClick={onClick}>
        <ArrowLeftIcon /> Notes
      </Button>
    </div>
  );
}

export function EmptyNote({ onCreate, dropHint }: { onCreate?: () => void; dropHint?: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="is-parchment flex max-w-xs flex-col items-center rounded-sm bg-[var(--w-parchment)] px-6 py-6 text-center text-[var(--w-parchment-ink)]">
        <EmptyMark name="quill" className="mb-2" pixelClassName="mb-3 size-10" />
        <p className="pixel text-base">Pick a note</p>
        <p className="mt-1 text-xs opacity-80">
          Or{" "}
          {onCreate ? (
            <>
              <button type="button" onClick={onCreate} className="underline underline-offset-2">
                start a new one
              </button>{" "}
              <Kbd>⌘N</Kbd>
            </>
          ) : (
            "start a new one"
          )}
          . Notes are markdown files agents read and edit too.
        </p>
        {dropHint && <p className="mt-2 text-xs opacity-70">Drop files here: markdown becomes a note, PDFs, images and decks go to the Vault.</p>}
      </div>
    </div>
  );
}
