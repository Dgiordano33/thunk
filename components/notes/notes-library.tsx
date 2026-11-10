"use client";

import { PlusIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CivPanel } from "@/components/world/civ-panel";
import { api } from "@/lib/client/api";
import { parseScopeKey, scopeKey, sortNotes, type NoteFolder, type NoteMeta, type NoteScope } from "@/lib/notes/types";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { CollapsiblePane } from "./collapsible-pane";
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

/**
 * The global Library: folders → list → editor, Apple Notes style.
 * URL state: `?scope=p:<id>|w:<id>&note=<id>` so the town and sidebar can deep-link.
 */
export function NotesLibrary() {
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
      window.history.replaceState(null, "", q.size ? `${pathname}?${q}` : pathname);
    },
    [pathname],
  );

  const label = useMemo(() => {
    const names = new Map<string, string>();
    for (const f of folders ?? []) {
      names.set(scopeKey({ kind: "projects", id: f.project.id }), f.project.name);
      for (const r of f.repos) names.set(`r:${r.notebook.id}`, `${f.project.name} / ${r.notebook.label}`);
      for (const w of f.workspaces)
        names.set(scopeKey({ kind: "workspaces", id: w.workspace.id }), `${f.project.name} / ${w.workspace.slug === "main" ? "Local" : w.workspace.name}`);
    }
    return names;
  }, [folders]);

  return (
    <main className="absolute inset-x-4 top-20 z-10 flex" style={{ bottom: process.env.NODE_ENV === "development" ? "4.5rem" : "1rem" }}>
      <CivPanel className="w-full" bodyClassName="flex h-full min-h-0">
        <CollapsiblePane title="Notebooks" defaultOpen={false} className="hidden w-60 md:flex">
          <LibraryFolders folders={folders} selected={scope} onSelect={(s) => navigate({ scope: s, note: null })} />
        </CollapsiblePane>
        {scope ? (
          <ScopeNotes
            key={scopeKey(scope)}
            scope={scope}
            selectedId={noteParam}
            onSelect={(id) => navigate({ scope, note: id })}
            listTitle={label.get(scopeKey(scope)) ?? "Notes"}
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
    () => (folders ? sortNotes(folders.flatMap((f) => [...f.notes, ...f.workspaces.flatMap((w) => w.notes), ...f.repos.flatMap((r) => r.notes)])) : null),
    [folders],
  );
  const keyOf = (n: NoteMeta) => `${scopeKey(n.scope)}/${n.id}`;
  const current = notes?.find((n) => keyOf(n) === selected) ?? null;
  const select = useCallback((key: string | null) => onSelect(null, key), [onSelect]);
  const { remove, create, dialog } = useNoteActions(null, select);

  return (
    <div className="flex min-h-0 flex-1">
      {dialog}
      <CollapsiblePane title="All notes" className="w-72">
        <NoteList
          notes={notes}
          selectedId={selected}
          keyOf={keyOf}
          contextOf={(n) => label.get(scopeKey(n.scope)) ?? ""}
          onSelect={select}
          onDelete={(n) => void remove(n)}
          createControl={<NewNoteMenu folders={folders} onCreate={(s) => void create(s)} />}
          emptyText="No notes yet. Pick a project or workspace to start one."
        />
      </CollapsiblePane>
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

/** "New note" for the mixed list: pick which notebook the note goes in. */
function NewNoteMenu({
  folders,
  onCreate,
}: {
  folders: NoteFolder[] | null;
  onCreate: (scope: NoteScope) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label="New note" title="New note" disabled={!folders?.length}>
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>New note in…</DropdownMenuLabel>
        {folders?.map((f, i) => {
          const pScope: NoteScope = { kind: "projects", id: f.project.id };
          return (
            <div key={f.project.id}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => onCreate(pScope)}>
                <span className="truncate font-medium">{f.project.name}</span>
              </DropdownMenuItem>
              {f.repos.map(({ notebook }) => <DropdownMenuItem key={notebook.id} onSelect={() => onCreate({ kind: "repos", id: notebook.id })}>{notebook.label} · repo</DropdownMenuItem>)}
              {f.workspaces.map(({ workspace }) => {
                const wScope: NoteScope = { kind: "workspaces", id: workspace.id };
                return (
                  <DropdownMenuItem key={workspace.id} className="pl-5" onSelect={() => onCreate(wScope)}>
                    <span className="truncate">{workspace.slug === "main" ? "Local" : workspace.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
