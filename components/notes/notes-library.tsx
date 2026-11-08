"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CivPanel } from "@/components/world/civ-panel";
import { api } from "@/lib/client/api";
import { parseScopeKey, scopeKey, sortNotes, type NoteFolder, type NoteMeta, type NoteScope } from "@/lib/notes/types";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";
import { EmptyNote, ScopeNotes, useNoteActions } from "./library";
import { LibraryFolders } from "./library-folders";
import { NoteEditor } from "./note-editor";
import { NoteList } from "./note-list";

/** Every notebook across projects and workspaces, refetched on any note change. */
export function useAllNotes() {
  useNotesEvents();
  const rev = useNotesFeed((s) => s.rev);
  const [folders, setFolders] = useState<NoteFolder[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.listAllNotes().then((r) => !cancelled && setFolders(r.projects)).catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [rev]);
  return folders;
}

const PANE_HEAD = "pixel text-muted-foreground flex h-9 shrink-0 items-center border-b px-3 text-[11px] tracking-widest uppercase";

/**
 * The global Library: folders → list → editor, Apple Notes style.
 * URL state: `?scope=p:<id>|w:<id>&note=<id>` so the town and sidebar can deep-link.
 */
export function NotesLibrary() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = parseScopeKey(params.get("scope"));
  const noteParam = params.get("note");
  const folders = useAllNotes();

  const navigate = useCallback(
    (next: { scope: NoteScope | null; note: string | null }) => {
      const q = new URLSearchParams();
      if (next.scope) q.set("scope", scopeKey(next.scope));
      if (next.note) q.set("note", next.note);
      router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const label = useMemo(() => {
    const names = new Map<string, string>();
    for (const f of folders ?? []) {
      names.set(scopeKey({ kind: "projects", id: f.project.id }), f.project.name);
      for (const w of f.workspaces)
        names.set(scopeKey({ kind: "workspaces", id: w.workspace.id }), `${f.project.name} / ${w.workspace.slug === "main" ? "Local" : w.workspace.name}`);
    }
    return names;
  }, [folders]);

  return (
    <main className="absolute inset-x-4 top-20 z-10 flex" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full" bodyClassName="flex h-full min-h-0">
        <aside className="hidden w-60 shrink-0 flex-col border-r md:flex">
          <h2 className={PANE_HEAD}>Notebooks</h2>
          <LibraryFolders folders={folders} selected={scope} onSelect={(s) => navigate({ scope: s, note: null })} />
        </aside>
        {scope ? (
          <ScopeNotes
            key={scopeKey(scope)}
            scope={scope}
            selectedId={noteParam}
            onSelect={(id) => navigate({ scope, note: id })}
            listHeader={<h2 className={cn(PANE_HEAD, "truncate")}>{label.get(scopeKey(scope)) ?? "Notes"}</h2>}
          />
        ) : (
          <AllNotes folders={folders} selected={noteParam} label={label} onSelect={(s, id) => navigate({ scope: s, note: id })} />
        )}
      </CivPanel>
    </main>
  );
}

/** "All notes": every scope's notes in one list. Selection is `<scopeKey>/<noteId>`. */
function AllNotes({
  folders,
  selected,
  label,
  onSelect,
}: {
  folders: NoteFolder[] | null;
  selected: string | null;
  label: Map<string, string>;
  onSelect: (scope: NoteScope | null, note: string | null) => void;
}) {
  const notes = useMemo<NoteMeta[] | null>(
    () => (folders ? sortNotes(folders.flatMap((f) => [...f.notes, ...f.workspaces.flatMap((w) => w.notes)])) : null),
    [folders],
  );
  const keyOf = (n: NoteMeta) => `${scopeKey(n.scope)}/${n.id}`;
  const current = notes?.find((n) => keyOf(n) === selected) ?? null;
  const select = useCallback((key: string | null) => onSelect(null, key), [onSelect]);
  const { remove } = useNoteActions(null, select);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r">
        <h2 className={PANE_HEAD}>All notes</h2>
        <NoteList
          notes={notes}
          selectedId={selected}
          keyOf={keyOf}
          contextOf={(n) => label.get(scopeKey(n.scope)) ?? ""}
          onSelect={select}
          onDelete={(n) => void remove(n)}
          emptyText="No notes yet. Pick a project or workspace to start one."
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <NoteEditor key={keyOf(current)} scope={current.scope} noteId={current.id} onDeleted={() => select(null)} />
        ) : (
          <EmptyNote />
        )}
      </div>
    </div>
  );
}
